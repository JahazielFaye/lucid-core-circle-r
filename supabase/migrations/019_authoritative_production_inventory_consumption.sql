-- Authoritative production-consumption inventory ledger.
-- Receipts remain immutable positive history. Production issues and reversals
-- are additional posted, signed ledger entries linked to genealogy.
begin;

alter table inventory_transactions
  add column if not exists production_run_id uuid references production_runs(id) on delete restrict;

alter table inventory_transaction_lines
  add column if not exists production_consumption_id uuid references production_run_consumptions(id) on delete restrict,
  add column if not exists reversal_of_inventory_line_id uuid references inventory_transaction_lines(id) on delete restrict;

alter table production_run_consumptions
  add column if not exists idempotency_key text,
  add column if not exists reversal_reason text;

create index if not exists inventory_transactions_production_run_idx
  on inventory_transactions (organization_id, production_run_id)
  where production_run_id is not null;
create index if not exists inventory_transaction_lines_consumption_idx
  on inventory_transaction_lines (organization_id, production_consumption_id)
  where production_consumption_id is not null;
create unique index if not exists inventory_transaction_lines_one_issue_per_consumption_idx
  on inventory_transaction_lines (production_consumption_id)
  where production_consumption_id is not null and reversal_of_inventory_line_id is null;
create unique index if not exists inventory_transaction_lines_one_reversal_per_issue_idx
  on inventory_transaction_lines (reversal_of_inventory_line_id)
  where reversal_of_inventory_line_id is not null;
create unique index if not exists production_run_consumptions_one_reversal_idx
  on production_run_consumptions (reversal_of_consumption_id)
  where reversal_of_consumption_id is not null;
create unique index if not exists production_run_consumptions_idempotency_idx
  on production_run_consumptions (organization_id, production_run_id, idempotency_key)
  where idempotency_key is not null and reversal_of_consumption_id is null;

-- Existing role guards permit receiving for office/leadership/Admin. A production
-- operator may write only the inventory rows created inside the authenticated
-- consumption RPC; the transaction-local guard cannot be used by normal UI writes.
create or replace function assert_lucid_inventory_write_role()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor profiles%rowtype;
  target_organization_id uuid;
  ledger_write_enabled boolean := coalesce(current_setting('app.lucid_consumption_ledger_write', true), '') = 'on';
begin
  actor := lucid_operational_actor(array['production','office','leadership','lucid_admin']);
  if tg_op = 'DELETE' then
    target_organization_id := old.organization_id;
  else
    target_organization_id := new.organization_id;
  end if;

  if actor.organization_id is distinct from target_organization_id then
    raise exception 'Inventory records must belong to your organization.';
  end if;

  if actor.role = 'production' then
    if not ledger_write_enabled then
      raise exception 'Production may create inventory movements only through recorded production consumption.';
    end if;
    -- NEW is unavailable for DELETE triggers, so never reference it outside
    -- the explicitly non-DELETE branch.
    if tg_table_name = 'inventory_transactions' and tg_op <> 'DELETE' then
      if new.transaction_type <> 'production_issue' then
        raise exception 'Production may create only production issue inventory movements.';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Dedicated checks use explicit aliases rather than a shared heterogeneous trigger.
create or replace function validate_lucid_consumption_ledger_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  related_organization_id uuid;
  transaction_run_id uuid;
  consumption_run_id uuid;
  consumption_lot_id uuid;
  consumption_item_id text;
  original_organization_id uuid;
  original_transaction_id uuid;
  reversal_parent_transaction_id uuid;
begin
  if tg_table_name = 'inventory_transactions' then
    if new.production_run_id is not null then
      select run_row.organization_id into related_organization_id
      from production_runs as run_row
      where run_row.id = new.production_run_id;
      if related_organization_id is distinct from new.organization_id then
        raise exception 'The production run must belong to the inventory transaction organization.';
      end if;
      if new.transaction_type not in ('production_issue', 'production_consumption_reversal') then
        raise exception 'A production run link requires a production issue or consumption reversal transaction.';
      end if;
    end if;
  elsif tg_table_name = 'inventory_transaction_lines' then
    if new.production_consumption_id is not null then
      select consumption_row.organization_id, consumption_row.production_run_id,
             consumption_row.source_inventory_lot_id, consumption_row.item_id
        into related_organization_id, consumption_run_id, consumption_lot_id, consumption_item_id
      from production_run_consumptions as consumption_row
      where consumption_row.id = new.production_consumption_id;
      if related_organization_id is distinct from new.organization_id then
        raise exception 'The production consumption must belong to the inventory line organization.';
      end if;
      select transaction_row.production_run_id into transaction_run_id
      from inventory_transactions as transaction_row
      where transaction_row.id = new.transaction_id;
      if transaction_run_id is distinct from consumption_run_id then
        raise exception 'The inventory issue must belong to the same production run as its consumption.';
      end if;
      if new.inventory_lot_id is distinct from consumption_lot_id
         or new.item_id is distinct from consumption_item_id then
        raise exception 'The inventory issue line must match the consumed lot and item.';
      end if;
    end if;
    if new.reversal_of_inventory_line_id is not null then
      select original_line.organization_id, original_line.transaction_id
        into original_organization_id, original_transaction_id
      from inventory_transaction_lines as original_line
      where original_line.id = new.reversal_of_inventory_line_id;
      if original_organization_id is distinct from new.organization_id then
        raise exception 'The inventory reversal line must belong to the same organization as its original issue.';
      end if;
      if not exists (
        select 1
        from inventory_transaction_lines as original_line
        where original_line.id = new.reversal_of_inventory_line_id
          and original_line.production_consumption_id is not null
          and original_line.reversal_of_inventory_line_id is null
      ) then
        raise exception 'An inventory reversal must reference an original production issue line.';
      end if;
      select reversal_transaction.reversal_of_transaction_id into reversal_parent_transaction_id
      from inventory_transactions as reversal_transaction
      where reversal_transaction.id = new.transaction_id
        and reversal_transaction.transaction_type = 'production_consumption_reversal';
      if reversal_parent_transaction_id is distinct from original_transaction_id then
        raise exception 'The reversal inventory transaction must link to the original production issue transaction.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_inventory_consumption_ledger_transaction_scope on inventory_transactions;
drop trigger if exists validate_inventory_consumption_ledger_line_scope on inventory_transaction_lines;
create trigger validate_inventory_consumption_ledger_transaction_scope
  before insert or update of organization_id, production_run_id, transaction_type on inventory_transactions
  for each row execute function validate_lucid_consumption_ledger_scope();
create trigger validate_inventory_consumption_ledger_line_scope
  before insert or update of organization_id, transaction_id, inventory_lot_id, item_id, production_consumption_id, reversal_of_inventory_line_id on inventory_transaction_lines
  for each row execute function validate_lucid_consumption_ledger_scope();

create or replace function record_lucid_production_consumption(
  p_production_run_id uuid,
  p_inventory_lot_id uuid,
  p_item_id text,
  p_quantity numeric,
  p_quantity_uom text,
  p_net_weight numeric,
  p_weight_uom text,
  p_idempotency_key text
)
returns table (
  production_consumption_id uuid,
  inventory_transaction_id uuid,
  inventory_transaction_line_id uuid,
  reused boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor profiles%rowtype;
  target_run production_runs%rowtype;
  target_lot inventory_lots%rowtype;
  existing_consumption_id uuid;
  issue_transaction_id uuid;
  issue_line_id uuid;
  available_quantity numeric := 0;
  available_weight numeric := 0;
  requested_item_id text := nullif(btrim(p_item_id), '');
  requested_quantity_uom text := nullif(btrim(p_quantity_uom), '');
  requested_weight_uom text := nullif(btrim(p_weight_uom), '');
  operation_key text := nullif(btrim(p_idempotency_key), '');
begin
  actor := lucid_operational_actor(array['production','office','leadership','lucid_admin']);
  if operation_key is null then
    raise exception 'A consumption operation key is required.';
  end if;
  if requested_item_id is null or p_quantity is null or p_quantity <= 0 or requested_quantity_uom is null then
    raise exception 'Consumed item, quantity, and quantity UOM are required.';
  end if;
  if p_net_weight is not null and (p_net_weight <= 0 or requested_weight_uom is null) then
    raise exception 'A positive consumed weight requires a weight UOM.';
  end if;

  select pr.* into target_run
  from production_runs as pr
  where pr.id = p_production_run_id and pr.organization_id = actor.organization_id
  for update;
  if not found then
    raise exception 'Production run was not found.';
  end if;
  -- Serialize same-run consumption attempts before checking the operation key.
  -- A retry that arrives while the first request is committing reuses its issue.
  select prc.id into existing_consumption_id
  from production_run_consumptions as prc
  where prc.organization_id = actor.organization_id
    and prc.production_run_id = target_run.id
    and prc.idempotency_key = operation_key
    and prc.reversal_of_consumption_id is null
  for update;
  if existing_consumption_id is not null then
    select itl.transaction_id, itl.id into issue_transaction_id, issue_line_id
    from inventory_transaction_lines as itl
    where itl.production_consumption_id = existing_consumption_id
      and itl.reversal_of_inventory_line_id is null;
    if issue_line_id is null then
      raise exception 'The prior production consumption has no authoritative inventory issue.';
    end if;
    return query select existing_consumption_id, issue_transaction_id, issue_line_id, true;
    return;
  end if;
  if target_run.status not in ('planned', 'in_progress') then
    raise exception 'Production run is not available for consumption.';
  end if;
  select il.* into target_lot
  from inventory_lots as il
  where il.id = p_inventory_lot_id and il.organization_id = actor.organization_id
  for update;
  if not found or target_lot.status <> 'active' or target_lot.item_id is distinct from requested_item_id then
    raise exception 'Source inventory lot is not active for the selected item.';
  end if;
  if exists (
    select 1
    from production_run_consumptions as legacy_prc
    left join inventory_transaction_lines as existing_itl
      on existing_itl.production_consumption_id = legacy_prc.id
     and existing_itl.reversal_of_inventory_line_id is null
    where legacy_prc.organization_id = actor.organization_id
      and legacy_prc.source_inventory_lot_id = target_lot.id
      and legacy_prc.reversal_of_consumption_id is null
      and existing_itl.id is null
  ) then
    raise exception 'This lot has legacy consumption without an inventory issue. Reconcile the lot before recording new authoritative consumption.';
  end if;
  if exists (
    select 1
    from inventory_transaction_lines as itl
    join inventory_transactions as it on it.id = itl.transaction_id
    where itl.organization_id = actor.organization_id
      and itl.inventory_lot_id = target_lot.id
      and it.status = 'posted'
      and itl.quantity <> 0
      and itl.quantity_uom is distinct from requested_quantity_uom
  ) then
    raise exception 'Lot quantity UOM conversion is not configured for this consumption.';
  end if;
  if p_net_weight is not null and exists (
    select 1
    from inventory_transaction_lines as itl
    join inventory_transactions as it on it.id = itl.transaction_id
    where itl.organization_id = actor.organization_id
      and itl.inventory_lot_id = target_lot.id
      and it.status = 'posted'
      and coalesce(itl.net_weight, 0) <> 0
      and itl.weight_uom is distinct from requested_weight_uom
  ) then
    raise exception 'Lot weight UOM conversion is not configured for this consumption.';
  end if;
  select coalesce(sum(itl.quantity), 0), coalesce(sum(itl.net_weight), 0)
    into available_quantity, available_weight
  from inventory_transaction_lines as itl
  join inventory_transactions as it on it.id = itl.transaction_id
  where itl.organization_id = actor.organization_id
    and itl.inventory_lot_id = target_lot.id
    and it.status = 'posted';
  if available_quantity < p_quantity then
    raise exception 'Insufficient available quantity in the selected inventory lot.';
  end if;
  if p_net_weight is not null and available_weight < p_net_weight then
    raise exception 'Insufficient available weight in the selected inventory lot.';
  end if;

  perform set_config('app.lucid_consumption_ledger_write', 'on', true);
  insert into production_run_consumptions (
    organization_id, production_run_id, source_inventory_lot_id, item_id,
    quantity, quantity_uom, net_weight, weight_uom, idempotency_key,
    recorded_by, source_system, source_record_id, is_historical, created_by
  ) values (
    actor.organization_id, target_run.id, target_lot.id, requested_item_id,
    p_quantity, requested_quantity_uom, p_net_weight, requested_weight_uom, operation_key,
    actor.id, target_run.source_system, target_run.source_record_id, false, actor.id
  ) returning id into production_consumption_id;

  insert into inventory_transactions (
    organization_id, transaction_number, transaction_type, status, warehouse_id,
    source_system, source_record_id, is_historical, transaction_date, posted_at,
    posted_by, production_run_id, created_by
  ) values (
    actor.organization_id, 'PROD-ISSUE-' || production_consumption_id::text,
    'production_issue', 'draft', null,
    target_run.source_system, target_run.source_record_id, false, now(), null,
    null, target_run.id, actor.id
  ) returning id into inventory_transaction_id;

  insert into inventory_transaction_lines (
    organization_id, transaction_id, item_id, inventory_lot_id, quantity,
    quantity_uom, net_weight, weight_uom, reason, return_flag,
    production_consumption_id, source_system, source_record_id, is_historical, created_by
  ) values (
    actor.organization_id, inventory_transaction_id, requested_item_id, target_lot.id, -p_quantity,
    requested_quantity_uom, case when p_net_weight is null then null else -p_net_weight end,
    requested_weight_uom, 'Production consumption', false,
    production_consumption_id, target_run.source_system, target_run.source_record_id, false, actor.id
  ) returning id into inventory_transaction_line_id;

  update inventory_transactions as issue_transaction
  set status = 'posted', posted_at = now(), posted_by = actor.id
  where issue_transaction.id = inventory_transaction_id
    and issue_transaction.organization_id = actor.organization_id
    and issue_transaction.status = 'draft';

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (
    actor.organization_id, actor.id, 'recorded production consumption', 'production_run_consumption', production_consumption_id::text,
    jsonb_build_object('production_run_id', target_run.id, 'inventory_lot_id', target_lot.id, 'inventory_transaction_id', inventory_transaction_id, 'operation_key', operation_key)
  );
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (
    actor.organization_id, actor.id, 'posted production inventory issue', 'inventory_transaction', inventory_transaction_id::text,
    jsonb_build_object('production_consumption_id', production_consumption_id, 'inventory_lot_id', target_lot.id)
  );
  return query select production_consumption_id, inventory_transaction_id, inventory_transaction_line_id, false;
end;
$$;

-- Preserve the existing seven-argument contract for older callers. New callers
-- use the eight-argument form with a stable operation key for retry idempotency.
create or replace function record_lucid_production_consumption(
  p_production_run_id uuid,
  p_inventory_lot_id uuid,
  p_item_id text,
  p_quantity numeric,
  p_quantity_uom text default null,
  p_net_weight numeric default null,
  p_weight_uom text default null
)
returns table (production_consumption_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare result_row record;
begin
  select * into result_row
  from record_lucid_production_consumption(
    p_production_run_id, p_inventory_lot_id, p_item_id, p_quantity,
    p_quantity_uom, p_net_weight, p_weight_uom, gen_random_uuid()::text
  );
  return query select result_row.production_consumption_id;
end;
$$;

create or replace function reverse_lucid_production_consumption(
  p_production_consumption_id uuid,
  p_reason text
)
returns table (
  reversal_consumption_id uuid,
  reversal_inventory_transaction_id uuid,
  reversal_inventory_transaction_line_id uuid,
  reused boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor profiles%rowtype;
  original_consumption production_run_consumptions%rowtype;
  original_issue_line inventory_transaction_lines%rowtype;
  original_issue_transaction inventory_transactions%rowtype;
  existing_reversal_id uuid;
  requested_reason text := nullif(btrim(p_reason), '');
begin
  actor := lucid_operational_actor(array['office','leadership','lucid_admin']);
  if requested_reason is null then
    raise exception 'A consumption reversal reason is required.';
  end if;
  select * into original_consumption
  from production_run_consumptions as prc
  where prc.id = p_production_consumption_id
    and prc.organization_id = actor.organization_id
  for update;
  if not found or original_consumption.reversal_of_consumption_id is not null then
    raise exception 'An original production consumption was not found.';
  end if;
  select reversal_prc.id into existing_reversal_id
  from production_run_consumptions as reversal_prc
  where reversal_prc.reversal_of_consumption_id = original_consumption.id
    and reversal_prc.organization_id = actor.organization_id;
  if existing_reversal_id is not null then
    select itl.transaction_id, itl.id
      into reversal_inventory_transaction_id, reversal_inventory_transaction_line_id
    from inventory_transaction_lines as itl
    where itl.production_consumption_id = existing_reversal_id;
    return query select existing_reversal_id, reversal_inventory_transaction_id, reversal_inventory_transaction_line_id, true;
    return;
  end if;
  select itl.* into original_issue_line
  from inventory_transaction_lines as itl
  where itl.production_consumption_id = original_consumption.id
    and itl.reversal_of_inventory_line_id is null
  for update;
  if not found then
    raise exception 'This legacy consumption has no authoritative inventory issue to reverse.';
  end if;
  select * into original_issue_transaction
  from inventory_transactions as it
  where it.id = original_issue_line.transaction_id
    and it.organization_id = actor.organization_id
  for update;
  if not found or original_issue_transaction.status <> 'posted' then
    raise exception 'The original production inventory issue is not posted.';
  end if;
  perform set_config('app.lucid_consumption_ledger_write', 'on', true);
  insert into production_run_consumptions (
    organization_id, production_run_id, source_inventory_lot_id, item_id,
    quantity, quantity_uom, net_weight, weight_uom, reversal_of_consumption_id,
    reversal_reason, recorded_by, source_system, source_record_id, is_historical, created_by
  ) values (
    actor.organization_id, original_consumption.production_run_id, original_consumption.source_inventory_lot_id,
    original_consumption.item_id, original_consumption.quantity, original_consumption.quantity_uom,
    original_consumption.net_weight, original_consumption.weight_uom, original_consumption.id,
    requested_reason, actor.id, original_consumption.source_system, original_consumption.source_record_id, false, actor.id
  ) returning id into reversal_consumption_id;
  insert into inventory_transactions (
    organization_id, transaction_number, transaction_type, status, warehouse_id,
    source_system, source_record_id, is_historical, transaction_date, reversal_of_transaction_id,
    production_run_id, created_by
  ) values (
    actor.organization_id, 'PROD-ISSUE-REV-' || reversal_consumption_id::text,
    'production_consumption_reversal', 'draft', original_issue_transaction.warehouse_id,
    original_consumption.source_system, original_consumption.source_record_id, false, now(), original_issue_transaction.id,
    original_consumption.production_run_id, actor.id
  ) returning id into reversal_inventory_transaction_id;
  insert into inventory_transaction_lines (
    organization_id, transaction_id, item_id, inventory_lot_id, quantity,
    quantity_uom, net_weight, weight_uom, reason, return_flag, production_consumption_id,
    reversal_of_inventory_line_id, source_system, source_record_id, is_historical, created_by
  ) values (
    actor.organization_id, reversal_inventory_transaction_id, original_consumption.item_id,
    original_consumption.source_inventory_lot_id, original_consumption.quantity,
    original_consumption.quantity_uom, original_consumption.net_weight, original_consumption.weight_uom,
    requested_reason, true, reversal_consumption_id, original_issue_line.id,
    original_consumption.source_system, original_consumption.source_record_id, false, actor.id
  ) returning id into reversal_inventory_transaction_line_id;
  update inventory_transactions as reversal_transaction
  set status = 'posted', posted_at = now(), posted_by = actor.id
  where reversal_transaction.id = reversal_inventory_transaction_id
    and reversal_transaction.organization_id = actor.organization_id
    and reversal_transaction.status = 'draft';
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (
    actor.organization_id, actor.id, 'reversed production consumption', 'production_run_consumption', reversal_consumption_id::text,
    jsonb_build_object('reversal_of_consumption_id', original_consumption.id, 'reason', requested_reason, 'inventory_transaction_id', reversal_inventory_transaction_id)
  );
  return query select reversal_consumption_id, reversal_inventory_transaction_id, reversal_inventory_transaction_line_id, false;
end;
$$;

grant execute on function record_lucid_production_consumption(uuid,uuid,text,numeric,text,numeric,text,text) to authenticated;
grant execute on function record_lucid_production_consumption(uuid,uuid,text,numeric,text,numeric,text) to authenticated;
grant execute on function reverse_lucid_production_consumption(uuid,text) to authenticated;

commit;

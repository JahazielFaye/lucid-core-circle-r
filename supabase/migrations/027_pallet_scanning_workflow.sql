-- Durable pallet numbering and controlled pallet corrections.
begin;

alter table public.pallets add column if not exists pallet_sequence integer;

with ordered_pallets as (
  select p.id,
    row_number() over (
      partition by p.organization_id, p.order_id
      order by p.created_at asc, p.id asc
    )::integer as assigned_sequence
  from public.pallets as p
  where p.pallet_sequence is null
)
update public.pallets as p
  set pallet_sequence = ordered_pallets.assigned_sequence
  from ordered_pallets
  where p.id = ordered_pallets.id;

alter table public.pallets alter column pallet_sequence set not null;
alter table public.pallets drop constraint if exists pallets_pallet_sequence_positive;
alter table public.pallets add constraint pallets_pallet_sequence_positive check (pallet_sequence > 0);
create unique index if not exists pallets_org_order_sequence_unique
  on public.pallets (organization_id, order_id, pallet_sequence);

create or replace function public.create_lucid_pallet(p_order_id uuid)
returns table (pallet_id uuid, pallet_identifier text, pallet_status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  target_order public.orders%rowtype;
  next_sequence integer;
  next_identifier text;
  created_pallet_id uuid;
begin
  select pr.* into actor from public.profiles as pr
    where pr.id = auth.uid() and pr.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if actor.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot build pallets.';
  end if;

  select o.* into target_order from public.orders as o
    where o.id = p_order_id and o.organization_id = actor.organization_id
    for update;
  if not found then raise exception 'The production order was not found.'; end if;
  if target_order.status not in ('in_production', 'production_complete') then
    raise exception 'Pallets can be created after production has started.';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_order.id::text));
  select coalesce(max(p.pallet_sequence), 0) + 1 into next_sequence
    from public.pallets as p
    where p.organization_id = actor.organization_id and p.order_id = target_order.id;
  next_identifier := 'PAL-' || target_order.external_po || '-' || lpad(next_sequence::text, 2, '0');

  insert into public.pallets (organization_id, order_id, label, pallet_identifier, pallet_sequence, status, created_by)
    values (actor.organization_id, target_order.id, next_identifier, next_identifier, next_sequence, 'building', actor.id)
    returning id into created_pallet_id;
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (actor.organization_id, actor.id, 'pallet created', 'pallet', created_pallet_id::text,
      jsonb_build_object('order_id', target_order.id, 'pallet_identifier', next_identifier, 'pallet_sequence', next_sequence));
  return query select created_pallet_id, next_identifier, 'building'::text;
end;
$$;

create or replace function public.remove_lucid_case_from_pallet(
  p_pallet_id uuid, p_production_case_id uuid, p_reason text
)
returns table (pallet_id uuid, production_case_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  target_pallet public.pallets%rowtype;
  target_case public.production_cases%rowtype;
  safe_reason text := nullif(btrim(p_reason), '');
begin
  select pr.* into actor from public.profiles as pr where pr.id = auth.uid() and pr.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if actor.role not in ('office', 'leadership', 'lucid_admin') then raise exception 'Your role cannot correct pallet contents.'; end if;
  if safe_reason is null then raise exception 'A correction reason is required to remove a case from a pallet.'; end if;
  select p.* into target_pallet from public.pallets as p
    where p.id = p_pallet_id and p.organization_id = actor.organization_id for update;
  if not found then raise exception 'The pallet was not found.'; end if;
  if target_pallet.status <> 'building' then raise exception 'Completed pallets cannot be changed.'; end if;
  select pc.* into target_case from public.production_cases as pc
    where pc.id = p_production_case_id and pc.organization_id = actor.organization_id and pc.pallet_id = target_pallet.id for update;
  if not found then raise exception 'This case is not assigned to the selected pallet.'; end if;
  update public.pallet_case_assignments as pca
    set status = 'removed', removed_at = now(), removed_by = actor.id, removal_reason = safe_reason
    where pca.pallet_id = target_pallet.id and pca.production_case_id = target_case.id and pca.status = 'active';
  delete from public.pallet_cases as legacy_pc where legacy_pc.pallet_id = target_pallet.id and legacy_pc.production_case_id = target_case.id;
  update public.production_cases as pc set pallet_id = null, status = 'produced'
    where pc.id = target_case.id and pc.organization_id = actor.organization_id;
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (actor.organization_id, actor.id, 'case removed from pallet', 'pallet', target_pallet.id::text,
      jsonb_build_object('production_case_id', target_case.id, 'case_identifier', target_case.case_identifier, 'reason', safe_reason));
  return query select target_pallet.id, target_case.id;
end;
$$;

create or replace function public.remove_lucid_case_from_pallet(p_pallet_id uuid, p_production_case_id uuid)
returns table (pallet_id uuid, production_case_id uuid)
language plpgsql security invoker set search_path = public
as $$
begin
  raise exception 'A correction reason is required to remove a case from a pallet.';
end;
$$;

create or replace function public.move_lucid_case_between_pallets(
  p_production_case_id uuid, p_target_pallet_id uuid, p_reason text
)
returns table (source_pallet_id uuid, destination_pallet_id uuid, production_case_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  target_case public.production_cases%rowtype;
  source_pallet public.pallets%rowtype;
  destination_pallet public.pallets%rowtype;
  source_legacy_case public.pallet_cases%rowtype;
  safe_reason text := nullif(btrim(p_reason), '');
begin
  select pr.* into actor from public.profiles as pr where pr.id = auth.uid() and pr.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if actor.role not in ('office', 'leadership', 'lucid_admin') then raise exception 'Your role cannot move cases between pallets.'; end if;
  if safe_reason is null then raise exception 'A correction reason is required to move a case.'; end if;
  select pc.* into target_case from public.production_cases as pc
    where pc.id = p_production_case_id and pc.organization_id = actor.organization_id for update;
  if not found then raise exception 'The production case was not found.'; end if;
  if target_case.pallet_id is null then raise exception 'This case is not currently assigned to a pallet.'; end if;
  if target_case.status = 'voided' then raise exception 'Voided cases cannot be moved.'; end if;
  -- Lock both pallets in a stable order to avoid competing moves deadlocking.
  perform 1 from public.pallets as p
    where p.organization_id = actor.organization_id and p.id in (target_case.pallet_id, p_target_pallet_id)
    order by p.id for update;
  select p.* into source_pallet from public.pallets as p where p.id = target_case.pallet_id and p.organization_id = actor.organization_id;
  select p.* into destination_pallet from public.pallets as p where p.id = p_target_pallet_id and p.organization_id = actor.organization_id;
  if not found then raise exception 'The destination pallet was not found.'; end if;
  if source_pallet.id = destination_pallet.id then raise exception 'This case is already on the selected pallet.'; end if;
  if source_pallet.status <> 'building' or destination_pallet.status <> 'building' then raise exception 'Cases can only be moved between building pallets.'; end if;
  if source_pallet.order_id <> destination_pallet.order_id or target_case.order_id <> destination_pallet.order_id then
    raise exception 'Cases can only be moved between pallets for the same order.';
  end if;
  select lpc.* into source_legacy_case from public.pallet_cases as lpc
    where lpc.pallet_id = source_pallet.id and lpc.production_case_id = target_case.id for update;
  if not found then raise exception 'The active pallet assignment could not be found.'; end if;
  update public.pallet_case_assignments as pca
    set status = 'removed', removed_at = now(), removed_by = actor.id, removal_reason = safe_reason
    where pca.pallet_id = source_pallet.id and pca.production_case_id = target_case.id and pca.status = 'active';
  delete from public.pallet_cases as lpc where lpc.id = source_legacy_case.id;
  insert into public.pallet_cases (pallet_id, production_case_id, scanned_code, item_id, lot_code, weight_lb, scanned_at, added_by)
    values (destination_pallet.id, target_case.id, source_legacy_case.scanned_code, source_legacy_case.item_id,
      source_legacy_case.lot_code, source_legacy_case.weight_lb, now(), actor.id);
  update public.production_cases as pc set pallet_id = destination_pallet.id, status = 'palletized'
    where pc.id = target_case.id and pc.organization_id = actor.organization_id;
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (actor.organization_id, actor.id, 'case moved between pallets', 'pallet', destination_pallet.id::text,
      jsonb_build_object('production_case_id', target_case.id, 'case_identifier', target_case.case_identifier,
        'source_pallet_id', source_pallet.id, 'destination_pallet_id', destination_pallet.id, 'reason', safe_reason));
  return query select source_pallet.id, destination_pallet.id, target_case.id;
end;
$$;

revoke execute on function public.move_lucid_case_between_pallets(uuid, uuid, text) from public, anon;
grant execute on function public.move_lucid_case_between_pallets(uuid, uuid, text) to authenticated;
revoke execute on function public.remove_lucid_case_from_pallet(uuid, uuid, text) from public, anon;
grant execute on function public.remove_lucid_case_from_pallet(uuid, uuid, text) to authenticated;

commit;

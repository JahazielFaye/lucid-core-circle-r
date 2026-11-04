-- Shared scanner, weighing, station, and label-preparation foundation.
-- No hardware transport, scanner command, scale command, or printer command is implemented here.
begin;

alter table item_identifiers
  add column if not exists identifier_class text not null default 'source_alias'
    check (identifier_class in ('source_alias', 'standards_validated')),
  add column if not exists standards_validated boolean not null default false;

-- Existing imported identifiers remain exact source aliases unless explicitly verified later.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'item_identifiers_validation_class_consistent') then
    alter table item_identifiers add constraint item_identifiers_validation_class_consistent
      check (
        (identifier_class = 'standards_validated' and standards_validated = true)
        or (identifier_class = 'source_alias' and standards_validated = false)
      );
  end if;
end $$;

create table if not exists production_stations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  station_code text not null,
  station_name text not null,
  indicator_family text,
  platform_description text,
  capacity_lb numeric,
  marked_interval_lb numeric,
  operational_uom text not null default 'LB' check (operational_uom = 'LB'),
  connection_status text not null default 'UNVERIFIED' check (connection_status in ('UNVERIFIED', 'CONFIGURED', 'DISABLED')),
  active boolean not null default true,
  source_system text not null default 'lucid_core', source_record_id text, is_historical boolean not null default false,
  created_by uuid references profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, station_code), check (capacity_lb is null or capacity_lb > 0), check (marked_interval_lb is null or marked_interval_lb > 0)
);

create table if not exists item_weight_bands (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete restrict,
  item_id uuid not null references items(id) on delete restrict, minimum_weight numeric, maximum_weight numeric, target_weight numeric,
  weight_uom text not null default 'LB' check (weight_uom = 'LB'), policy_mode text not null default 'warning' check (policy_mode in ('warning', 'block')),
  effective_date date, expiration_date date, status text not null default 'active' check (status in ('active', 'inactive')),
  approved_by uuid references profiles(id) on delete set null, created_by uuid references profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (minimum_weight is null or minimum_weight >= 0), check (maximum_weight is null or maximum_weight >= 0),
  check (target_weight is null or target_weight >= 0),
  check (maximum_weight is null or minimum_weight is null or maximum_weight >= minimum_weight),
  check (expiration_date is null or effective_date is null or expiration_date >= effective_date)
);

create unique index if not exists item_weight_bands_active_idx on item_weight_bands (organization_id, item_id, coalesce(effective_date, '-infinity'::date)) where status = 'active';

create table if not exists item_packaging_instructions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete restrict,
  item_id uuid not null references items(id) on delete restrict, container text, liner_or_bag text, setup_notes text, verification_instructions text,
  status text not null default 'active' check (status in ('active', 'inactive')), created_by uuid references profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists item_packaging_instructions_active_idx on item_packaging_instructions (organization_id, item_id) where status = 'active';

alter table production_cases
  add column if not exists production_station_id uuid references production_stations(id) on delete restrict,
  add column if not exists weight_source text check (weight_source in ('station', 'manual', 'future_hid', 'future_serial', 'future_network')),
  add column if not exists weight_captured_at timestamptz,
  add column if not exists weight_zero_state text check (weight_zero_state in ('physical_zero_confirmed', 'unknown')),
  add column if not exists weight_tare_state text check (weight_tare_state in ('packaging_adjusted', 'software_tare', 'unknown'));

alter table production_cases
  add column if not exists weight_operation_key text;
create unique index if not exists production_cases_weight_operation_key_idx
  on production_cases (organization_id, weight_operation_key)
  where weight_operation_key is not null;

create table if not exists production_weight_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  station_id uuid references production_stations(id) on delete restrict,
  source text not null check (source in ('manual','station')),
  weight_value numeric not null check (weight_value > 0), weight_uom text not null default 'LB' check (weight_uom = 'LB'),
  captured_at timestamptz not null default now(), stable_state text not null default 'unknown' check (stable_state in ('stable','unstable','unknown')),
  zero_state text not null default 'unknown' check (zero_state in ('physical_zero_confirmed','unknown')),
  tare_state text not null default 'unknown' check (tare_state in ('packaging_adjusted','software_tare','unknown')),
  source_system text not null default 'lucid_core' check (source_system in ('lucid_core','lucid_qa','food_connex')),
  source_record_id text, consumed_at timestamptz, consumed_by_case_id uuid references production_cases(id) on delete restrict,
  weight_operation_key text not null,
  created_by uuid references profiles(id) on delete set null, created_at timestamptz not null default now(),
  check ((consumed_at is null) = (consumed_by_case_id is null))
);
create unique index if not exists production_weight_readings_operation_key_idx on production_weight_readings (organization_id, weight_operation_key);
create index if not exists production_weight_readings_org_open_idx on production_weight_readings (organization_id, created_at desc) where consumed_at is null;

create table if not exists production_case_weight_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete restrict,
  production_case_id uuid not null references production_cases(id) on delete restrict, weight_reading_id uuid references production_weight_readings(id) on delete restrict, station_id uuid references production_stations(id) on delete restrict,
  event_type text not null check (event_type in ('captured', 'corrected', 'consumed')),
  source text not null check (source in ('station', 'manual', 'future_hid', 'future_serial', 'future_network')),
  original_net_weight numeric, net_weight numeric not null check (net_weight > 0), weight_uom text not null default 'LB' check (weight_uom = 'LB'),
  zero_state text not null default 'unknown' check (zero_state in ('physical_zero_confirmed', 'unknown')),
  tare_state text not null default 'unknown' check (tare_state in ('packaging_adjusted', 'software_tare', 'unknown')),
  stable boolean, captured_at timestamptz not null default now(), correction_reason text,
  source_system text not null default 'lucid_core' check (source_system in ('lucid_core', 'lucid_qa', 'food_connex')),
  source_record_id text,
  created_by uuid references profiles(id) on delete set null, created_at timestamptz not null default now(),
  check ((event_type <> 'corrected') or (original_net_weight is not null and correction_reason is not null and length(btrim(correction_reason)) > 0))
);
create index if not exists production_case_weight_events_case_idx on production_case_weight_events (organization_id, production_case_id, created_at desc);

create or replace function assert_lucid_scanning_scope()
returns trigger language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; payload jsonb := to_jsonb(new); related_org uuid;
begin
  select p.* into actor from profiles p where p.id = auth.uid() and p.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if (payload ->> 'organization_id')::uuid <> actor.organization_id then raise exception 'Scanner and weight data must belong to your organization.'; end if;
  if tg_table_name in ('production_stations','item_weight_bands','item_packaging_instructions') and actor.role not in ('lucid_admin','leadership','office') then raise exception 'Your role cannot change scanning configuration.'; end if;
  if tg_table_name = 'production_case_weight_events' then
    if actor.role not in ('production','office','leadership','lucid_admin') then raise exception 'Your role cannot capture production weight.'; end if;
    if current_setting('lucid.weight_event_rpc', true) is distinct from '1' then raise exception 'Weight history must be recorded through an authorized Lucid workflow.'; end if;
    select c.organization_id into related_org from production_cases c where c.id = new.production_case_id;
    if related_org is distinct from actor.organization_id then raise exception 'Case and weight event must belong to your organization.'; end if;
    if new.station_id is not null then
      select s.organization_id into related_org from production_stations s where s.id = new.station_id;
      if related_org is distinct from actor.organization_id then raise exception 'Weight event station must belong to your organization.'; end if;
    end if;
    if new.event_type = 'corrected' and actor.role not in ('office','leadership','lucid_admin') then raise exception 'Your role cannot correct captured weight.'; end if;
    new.created_by := actor.id;
  end if;
  if tg_table_name = 'item_weight_bands' then select i.organization_id into related_org from items i where i.id = new.item_id; if related_org is distinct from actor.organization_id then raise exception 'Weight band item must belong to your organization.'; end if; end if;
  if tg_table_name = 'item_packaging_instructions' then select i.organization_id into related_org from items i where i.id = new.item_id; if related_org is distinct from actor.organization_id then raise exception 'Packaging item must belong to your organization.'; end if; end if;
  if tg_table_name <> 'production_case_weight_events' then new.created_by := coalesce(new.created_by, actor.id); new.updated_at := now(); end if;
  return new;
end; $$;

create or replace function prevent_lucid_weight_event_mutation()
returns trigger language plpgsql security invoker set search_path = public as $$ begin raise exception 'Weight capture history is immutable. Record a correction event instead.'; end; $$;

drop trigger if exists enforce_lucid_scanning_station_scope on production_stations;
drop trigger if exists enforce_lucid_scanning_band_scope on item_weight_bands;
drop trigger if exists enforce_lucid_scanning_packaging_scope on item_packaging_instructions;
drop trigger if exists enforce_lucid_weight_event_scope on production_case_weight_events;
drop trigger if exists prevent_lucid_weight_event_mutation on production_case_weight_events;
create trigger enforce_lucid_scanning_station_scope before insert or update on production_stations for each row execute function assert_lucid_scanning_scope();
create trigger enforce_lucid_scanning_band_scope before insert or update on item_weight_bands for each row execute function assert_lucid_scanning_scope();
create trigger enforce_lucid_scanning_packaging_scope before insert or update on item_packaging_instructions for each row execute function assert_lucid_scanning_scope();
create trigger enforce_lucid_weight_event_scope before insert on production_case_weight_events for each row execute function assert_lucid_scanning_scope();
create trigger prevent_lucid_weight_event_mutation before update or delete on production_case_weight_events for each row execute function prevent_lucid_weight_event_mutation();
create or replace function prevent_lucid_weight_reading_mutation()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'UPDATE' and current_setting('lucid.weight_reading_consume_rpc', true) = '1'
     and old.consumed_at is null and new.consumed_at is not null and new.consumed_by_case_id is not null then return new; end if;
  raise exception 'Weight readings are immutable once created.';
end; $$;
drop trigger if exists prevent_lucid_weight_reading_mutation on production_weight_readings;
create trigger prevent_lucid_weight_reading_mutation before update or delete on production_weight_readings for each row execute function prevent_lucid_weight_reading_mutation();

create or replace function validate_lucid_case_station_scope()
returns trigger language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; station_org uuid;
begin
  if new.production_station_id is null then return new; end if;
  select p.* into actor from profiles p where p.id = auth.uid() and p.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  select s.organization_id into station_org from production_stations s where s.id = new.production_station_id;
  if station_org is distinct from new.organization_id or station_org is distinct from actor.organization_id then
    raise exception 'Production case station must belong to your organization.';
  end if;
  return new;
end; $$;
drop trigger if exists validate_lucid_case_station_scope on production_cases;
create trigger validate_lucid_case_station_scope before insert or update of production_station_id, organization_id on production_cases for each row execute function validate_lucid_case_station_scope();

create or replace function create_lucid_manual_weight_reading(p_order_id uuid, p_net_weight numeric, p_operation_key text)
returns table (weight_reading_id uuid)
language plpgsql security definer set search_path = public as $$
declare actor profiles%rowtype; reading_id uuid; existing_weight numeric; derived_source_system text;
begin
  select p.* into actor from profiles p where p.id=auth.uid() and p.active=true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if actor.role not in ('production','office','leadership','lucid_admin') then raise exception 'Your role cannot capture production weight.'; end if;
  if nullif(btrim(p_operation_key),'') is null then raise exception 'A fresh weight operation key is required.'; end if;
  if p_net_weight is null or p_net_weight <= 0 or round(p_net_weight,2) <> p_net_weight then raise exception 'A positive net weight with no more than two decimal places is required.'; end if;
  select coalesce(o.source_system, 'lucid_core') into derived_source_system from orders o where o.id=p_order_id and o.organization_id=actor.organization_id;
  if not found or derived_source_system not in ('lucid_core','lucid_qa','food_connex') then raise exception 'Production order was not found.'; end if;
  perform pg_advisory_xact_lock(hashtext(actor.organization_id::text || ':' || btrim(p_operation_key)));
  select r.id, r.weight_value into reading_id, existing_weight from production_weight_readings r where r.organization_id=actor.organization_id and r.weight_operation_key=btrim(p_operation_key) for update;
  if found then
    if existing_weight <> p_net_weight then raise exception 'The existing reading for this operation key has a different weight.'; end if;
    return query select reading_id; return;
  end if;
  insert into production_weight_readings (organization_id,source,weight_value,weight_uom,stable_state,zero_state,tare_state,source_system,weight_operation_key,created_by)
    values (actor.organization_id,'manual',p_net_weight,'LB','unknown','unknown','unknown',derived_source_system,btrim(p_operation_key),actor.id) returning id into reading_id;
  insert into audit_events (organization_id,actor_id,action,entity_type,entity_id,details) values
    (actor.organization_id,actor.id,'manual weight reading created','production_weight_reading',reading_id::text,jsonb_build_object('weight_value',p_net_weight,'weight_uom','LB'));
  return query select reading_id;
end; $$;

create or replace function create_lucid_production_case_from_weight_reading(
  p_order_id uuid, p_order_line_id uuid, p_case_identifier text, p_quantity numeric,
  p_net_weight numeric, p_production_lot_id uuid, p_operation_key text, p_weight_reading_id uuid
)
returns table (production_case_id uuid, case_identifier text, weight_event_id uuid, already_recorded boolean)
language plpgsql security definer set search_path = public as $$
declare actor profiles%rowtype; existing_case production_cases%rowtype; created_case record;
  captured_event_id uuid; case_source text; band item_weight_bands%rowtype; reading production_weight_readings%rowtype;
begin
  perform set_config('lucid.weight_event_rpc', '1', true);
  select p.* into actor from profiles p where p.id = auth.uid() and p.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if actor.role not in ('production','office','leadership','lucid_admin') then raise exception 'Your role cannot record production cases.'; end if;
  if nullif(btrim(p_operation_key), '') is null then raise exception 'A fresh weight operation key is required.'; end if;
  -- Serialize same-key retries so concurrent requests return the same durable result.
  perform pg_advisory_xact_lock(hashtext(actor.organization_id::text || ':' || btrim(p_operation_key)));
  select c.* into existing_case from production_cases c where c.organization_id = actor.organization_id and c.weight_operation_key = btrim(p_operation_key) for update;
  if found then
    select e.id into captured_event_id from production_case_weight_events e where e.production_case_id = existing_case.id and e.event_type = 'captured' order by e.created_at asc limit 1;
    return query select existing_case.id, existing_case.case_identifier, captured_event_id, true; return;
  end if;
  select r.* into reading from production_weight_readings r where r.id=p_weight_reading_id and r.organization_id=actor.organization_id for update;
  if not found then raise exception 'Weight reading was not found.'; end if;
  if reading.consumed_at is not null then raise exception 'Weight reading has already been used for another case.'; end if;
  if reading.captured_at < now() - interval '5 minutes' or reading.captured_at > now() + interval '1 minute' then raise exception 'Weight reading is no longer fresh.'; end if;
  if reading.source <> 'manual' or reading.station_id is not null or reading.stable_state <> 'unknown' or reading.zero_state <> 'unknown' or reading.tare_state <> 'unknown' then raise exception 'This workflow accepts only an authoritative manual reading.'; end if;
  if reading.weight_value <> p_net_weight then raise exception 'Weight does not match the captured reading.'; end if;
  select b.* into band from item_weight_bands b join order_lines ol on ol.item_id = b.item_id
    where ol.id = p_order_line_id and b.organization_id = actor.organization_id and b.status = 'active'
      and (b.effective_date is null or b.effective_date <= current_date)
      and (b.expiration_date is null or b.expiration_date >= current_date)
    order by b.effective_date desc nulls last limit 1;
  if found and ((band.minimum_weight is not null and p_net_weight < band.minimum_weight) or (band.maximum_weight is not null and p_net_weight > band.maximum_weight)) and band.policy_mode = 'block' then
    raise exception 'Weight outside allowed range.';
  end if;
  select * into created_case from add_lucid_production_case(p_order_id, p_order_line_id, p_case_identifier, p_quantity, p_net_weight, p_production_lot_id);
  select c.source_system into case_source from production_cases c where c.id = created_case.production_case_id;
  update production_cases c set weight_operation_key = btrim(p_operation_key), weight_source = 'manual', weight_captured_at = now(), weight_zero_state = 'unknown', weight_tare_state = 'unknown'
    where c.id = created_case.production_case_id and c.organization_id = actor.organization_id;
  insert into production_case_weight_events (organization_id, production_case_id, weight_reading_id, station_id, event_type, source, net_weight, weight_uom, zero_state, tare_state, stable, source_system, source_record_id, created_by)
    values (actor.organization_id, created_case.production_case_id, reading.id, null, 'captured', 'manual', p_net_weight, 'LB', 'unknown', 'unknown', null, case_source, null, actor.id)
    returning id into captured_event_id;
  perform set_config('lucid.weight_reading_consume_rpc', '1', true);
  update production_weight_readings r set consumed_at=now(), consumed_by_case_id=created_case.production_case_id where r.id=reading.id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (actor.organization_id, actor.id, 'production case weight captured', 'production_case_weight_event', captured_event_id::text,
      jsonb_build_object('production_case_id', created_case.production_case_id, 'weight_reading_id', reading.id, 'source', 'manual', 'net_weight', p_net_weight, 'weight_uom', 'LB', 'operation_key', btrim(p_operation_key)));
  return query select created_case.production_case_id, created_case.case_identifier, captured_event_id, false;
end; $$;

create or replace function record_lucid_case_weight_correction(p_production_case_id uuid, p_net_weight numeric, p_reason text)
returns table (weight_event_id uuid)
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; target_case production_cases%rowtype; original_weight numeric; original_source text; event_id uuid;
begin
  perform set_config('lucid.weight_event_rpc', '1', true);
  select p.* into actor from profiles p where p.id = auth.uid() and p.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if actor.role not in ('office','leadership','lucid_admin') then raise exception 'Your role cannot correct captured weight.'; end if;
  if p_net_weight is null or p_net_weight <= 0 or round(p_net_weight, 2) <> p_net_weight then raise exception 'A positive corrected weight with no more than two decimal places is required.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'A correction reason is required.'; end if;
  select c.* into target_case from production_cases c where c.id = p_production_case_id and c.organization_id = actor.organization_id for update;
  if not found then raise exception 'Production case not found.'; end if;
  select e.net_weight, e.source into original_weight, original_source from production_case_weight_events e where e.production_case_id = target_case.id order by e.created_at desc limit 1;
  if original_weight is null then raise exception 'The original captured weight was not found.'; end if;
  insert into production_case_weight_events (organization_id, production_case_id, event_type, source, original_net_weight, net_weight, weight_uom, zero_state, tare_state, correction_reason, source_system, created_by)
    values (actor.organization_id, target_case.id, 'corrected', original_source, original_weight, p_net_weight, 'LB', coalesce(target_case.weight_zero_state, 'unknown'), coalesce(target_case.weight_tare_state, 'unknown'), btrim(p_reason), target_case.source_system, actor.id)
    returning id into event_id;
  update production_cases c set net_weight=p_net_weight where c.id=target_case.id and c.organization_id=actor.organization_id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (actor.organization_id, actor.id, 'production case weight corrected', 'production_case_weight_event', event_id::text,
      jsonb_build_object('production_case_id', target_case.id, 'original_net_weight', original_weight, 'corrected_net_weight', p_net_weight, 'reason', btrim(p_reason)));
  return query select event_id;
end; $$;

revoke all on function create_lucid_production_case_from_weight_reading(uuid,uuid,text,numeric,numeric,uuid,text,uuid) from public;
grant execute on function create_lucid_production_case_from_weight_reading(uuid,uuid,text,numeric,numeric,uuid,text,uuid) to authenticated;
revoke all on function create_lucid_manual_weight_reading(uuid,numeric,text) from public;
grant execute on function create_lucid_manual_weight_reading(uuid,numeric,text) to authenticated;
revoke execute on function add_lucid_production_case(uuid,uuid,text,numeric,numeric,uuid) from authenticated;
revoke all on function record_lucid_case_weight_correction(uuid,numeric,text) from public;
grant execute on function record_lucid_case_weight_correction(uuid,numeric,text) to authenticated;

alter table production_stations enable row level security;
alter table item_weight_bands enable row level security;
alter table item_packaging_instructions enable row level security;
alter table production_case_weight_events enable row level security;
alter table production_weight_readings enable row level security;
drop policy if exists "scanning stations same org" on production_stations; create policy "scanning stations same org" on production_stations for all using (organization_id = current_org_id()) with check (organization_id = current_org_id());
drop policy if exists "scanning bands same org" on item_weight_bands; create policy "scanning bands same org" on item_weight_bands for all using (organization_id = current_org_id()) with check (organization_id = current_org_id());
drop policy if exists "scanning packaging same org" on item_packaging_instructions; create policy "scanning packaging same org" on item_packaging_instructions for all using (organization_id = current_org_id()) with check (organization_id = current_org_id());
drop policy if exists "scanning weight events same org" on production_case_weight_events; create policy "scanning weight events same org" on production_case_weight_events for all using (organization_id = current_org_id()) with check (organization_id = current_org_id());
drop policy if exists "scanning readings same org" on production_weight_readings; create policy "scanning readings same org" on production_weight_readings for select using (organization_id = current_org_id());

commit;

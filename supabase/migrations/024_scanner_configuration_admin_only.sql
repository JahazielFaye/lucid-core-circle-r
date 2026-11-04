-- Restrict scanner/weighing configuration writes to the authenticated Lucid Admin.
-- Existing configuration is preserved; operational weight and case workflows are untouched.
begin;

create or replace function public.assert_lucid_scanning_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  payload jsonb := to_jsonb(new);
  related_org uuid;
begin
  select p.* into actor from public.profiles p where p.id = auth.uid() and p.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if (payload ->> 'organization_id')::uuid <> actor.organization_id then
    raise exception 'Scanner and weight data must belong to your organization.';
  end if;

  -- Configuration is intentionally different from production capture and correction authority.
  if tg_table_name in ('production_stations', 'item_weight_bands', 'item_packaging_instructions')
     and actor.role <> 'lucid_admin' then
    raise exception 'Only Lucid Admin can change scanner and weighing configuration.';
  end if;

  if tg_table_name = 'production_case_weight_events' then
    if actor.role not in ('production','office','leadership','lucid_admin') then raise exception 'Your role cannot capture production weight.'; end if;
    if current_setting('lucid.weight_event_rpc', true) is distinct from '1' then raise exception 'Weight history must be recorded through an authorized Lucid workflow.'; end if;
    select c.organization_id into related_org from public.production_cases c where c.id = new.production_case_id;
    if related_org is distinct from actor.organization_id then raise exception 'Case and weight event must belong to your organization.'; end if;
    if new.station_id is not null then
      select s.organization_id into related_org from public.production_stations s where s.id = new.station_id;
      if related_org is distinct from actor.organization_id then raise exception 'Weight event station must belong to your organization.'; end if;
    end if;
    if new.event_type = 'corrected' and actor.role not in ('office','leadership','lucid_admin') then raise exception 'Your role cannot correct captured weight.'; end if;
    new.created_by := actor.id;
  end if;
  if tg_table_name = 'item_weight_bands' then
    select i.organization_id into related_org from public.items i where i.id = new.item_id;
    if related_org is distinct from actor.organization_id then raise exception 'Weight band item must belong to your organization.'; end if;
  end if;
  if tg_table_name = 'item_packaging_instructions' then
    select i.organization_id into related_org from public.items i where i.id = new.item_id;
    if related_org is distinct from actor.organization_id then raise exception 'Packaging item must belong to your organization.'; end if;
  end if;
  if tg_table_name <> 'production_case_weight_events' then
    new.created_by := coalesce(new.created_by, actor.id);
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- 022 used same-org FOR ALL policies. Replace only those three configuration policies.
drop policy if exists "scanning stations same org" on public.production_stations;
drop policy if exists "scanning bands same org" on public.item_weight_bands;
drop policy if exists "scanning packaging same org" on public.item_packaging_instructions;
drop policy if exists "scanner stations read same org" on public.production_stations;
drop policy if exists "scanner stations admin insert" on public.production_stations;
drop policy if exists "scanner stations admin update" on public.production_stations;
drop policy if exists "scanner stations admin delete" on public.production_stations;
drop policy if exists "scanner bands read same org" on public.item_weight_bands;
drop policy if exists "scanner bands admin insert" on public.item_weight_bands;
drop policy if exists "scanner bands admin update" on public.item_weight_bands;
drop policy if exists "scanner bands admin delete" on public.item_weight_bands;
drop policy if exists "scanner packaging read same org" on public.item_packaging_instructions;
drop policy if exists "scanner packaging admin insert" on public.item_packaging_instructions;
drop policy if exists "scanner packaging admin update" on public.item_packaging_instructions;
drop policy if exists "scanner packaging admin delete" on public.item_packaging_instructions;

create policy "scanner stations read same org" on public.production_stations
  for select using (organization_id = public.current_org_id());
create policy "scanner stations admin insert" on public.production_stations
  for insert with check (organization_id = public.current_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.organization_id = public.current_org_id() and p.role = 'lucid_admin'));
create policy "scanner stations admin update" on public.production_stations
  for update using (organization_id = public.current_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.organization_id = public.current_org_id() and p.role = 'lucid_admin'))
  with check (organization_id = public.current_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.organization_id = public.current_org_id() and p.role = 'lucid_admin'));
create policy "scanner stations admin delete" on public.production_stations
  for delete using (organization_id = public.current_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.organization_id = public.current_org_id() and p.role = 'lucid_admin'));

create policy "scanner bands read same org" on public.item_weight_bands
  for select using (organization_id = public.current_org_id());
create policy "scanner bands admin insert" on public.item_weight_bands
  for insert with check (organization_id = public.current_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.organization_id = public.current_org_id() and p.role = 'lucid_admin'));
create policy "scanner bands admin update" on public.item_weight_bands
  for update using (organization_id = public.current_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.organization_id = public.current_org_id() and p.role = 'lucid_admin'))
  with check (organization_id = public.current_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.organization_id = public.current_org_id() and p.role = 'lucid_admin'));
create policy "scanner bands admin delete" on public.item_weight_bands
  for delete using (organization_id = public.current_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.organization_id = public.current_org_id() and p.role = 'lucid_admin'));

create policy "scanner packaging read same org" on public.item_packaging_instructions
  for select using (organization_id = public.current_org_id());
create policy "scanner packaging admin insert" on public.item_packaging_instructions
  for insert with check (organization_id = public.current_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.organization_id = public.current_org_id() and p.role = 'lucid_admin'));
create policy "scanner packaging admin update" on public.item_packaging_instructions
  for update using (organization_id = public.current_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.organization_id = public.current_org_id() and p.role = 'lucid_admin'))
  with check (organization_id = public.current_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.organization_id = public.current_org_id() and p.role = 'lucid_admin'));
create policy "scanner packaging admin delete" on public.item_packaging_instructions
  for delete using (organization_id = public.current_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.organization_id = public.current_org_id() and p.role = 'lucid_admin'));

commit;

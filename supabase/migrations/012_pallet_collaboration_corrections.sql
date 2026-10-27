-- Milestone 4B: auditable collaboration and authorized pallet corrections.
begin;

alter table pallets
  add column if not exists original_completed_at timestamptz,
  add column if not exists original_completed_by uuid references profiles(id) on delete set null,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by uuid references profiles(id) on delete set null,
  add column if not exists reopen_reason text;

update pallets
  set original_completed_at = coalesce(original_completed_at, completed_at),
      original_completed_by = coalesce(original_completed_by, completed_by)
  where completed_at is not null;

create or replace function complete_lucid_pallet(p_pallet_id uuid)
returns table (pallet_id uuid, pallet_status text, completed_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_profile profiles%rowtype;
  target_pallet pallets%rowtype;
  assigned_case_count integer;
  completion_time timestamptz := now();
begin
  select profile_row.* into current_profile
    from profiles as profile_row
    where profile_row.id = auth.uid() and profile_row.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot complete pallets.';
  end if;
  select pallet_row.* into target_pallet
    from pallets as pallet_row
    where pallet_row.id = p_pallet_id
      and pallet_row.organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The pallet was not found.'; end if;
  if target_pallet.status = 'complete' then
    return query select target_pallet.id, target_pallet.status, target_pallet.completed_at;
    return;
  end if;
  if target_pallet.status <> 'building' then raise exception 'This pallet cannot be completed.'; end if;

  select count(*) into assigned_case_count
    from production_cases as case_row
    where case_row.pallet_id = target_pallet.id
      and case_row.organization_id = current_profile.organization_id
      and case_row.status = 'palletized';
  if assigned_case_count = 0 then raise exception 'Add at least one case before completing this pallet.'; end if;

  update pallets as pallet_row
    set status = 'complete',
      completed_by = current_profile.id,
      completed_at = completion_time,
      original_completed_by = coalesce(pallet_row.original_completed_by, current_profile.id),
      original_completed_at = coalesce(pallet_row.original_completed_at, completion_time),
      updated_at = completion_time
    where pallet_row.id = target_pallet.id
      and pallet_row.organization_id = current_profile.organization_id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id, 'pallet completed', 'pallet', target_pallet.id::text,
      jsonb_build_object('pallet_identifier', target_pallet.pallet_identifier, 'case_count', assigned_case_count));
  return query select target_pallet.id, 'complete'::text, completion_time;
end;
$$;

create or replace function reopen_lucid_pallet(p_pallet_id uuid, p_reason text)
returns table (pallet_id uuid, pallet_status text, reopened_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_profile profiles%rowtype;
  target_pallet pallets%rowtype;
  safe_reason text;
  correction_time timestamptz := now();
begin
  select profile_row.* into current_profile
    from profiles as profile_row
    where profile_row.id = auth.uid() and profile_row.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot reopen completed pallets.';
  end if;
  safe_reason := nullif(btrim(p_reason), '');
  if safe_reason is null then raise exception 'A correction reason is required to reopen this pallet.'; end if;

  select pallet_row.* into target_pallet
    from pallets as pallet_row
    where pallet_row.id = p_pallet_id
      and pallet_row.organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The pallet was not found.'; end if;
  if target_pallet.status <> 'complete' then raise exception 'Only completed pallets can be reopened for correction.'; end if;

  update pallets as pallet_row
    set status = 'building',
      reopened_by = current_profile.id,
      reopened_at = correction_time,
      reopen_reason = safe_reason,
      updated_at = correction_time
    where pallet_row.id = target_pallet.id
      and pallet_row.organization_id = current_profile.organization_id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id, 'pallet reopened for correction', 'pallet', target_pallet.id::text,
      jsonb_build_object('pallet_identifier', target_pallet.pallet_identifier, 'reason', safe_reason,
        'original_completed_at', target_pallet.original_completed_at, 'original_completed_by', target_pallet.original_completed_by));
  return query select target_pallet.id, 'building'::text, correction_time;
end;
$$;

revoke execute on function reopen_lucid_pallet(uuid, text) from public;
grant execute on function reopen_lucid_pallet(uuid, text) to authenticated;

commit;

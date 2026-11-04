-- User and organization administration foundation.
-- Normal Lucid Admins manage profiles only in their own organization.
begin;

alter table public.organizations
  add column if not exists active boolean not null default true;
alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();

-- Earlier privileged workflow RPCs correctly reject inactive profiles but some
-- predate organization activation.  Until each has been individually revised,
-- do not permit an organization to be disabled while it still has active
-- profiles.  This preserves the invariant that an active profile always
-- belongs to an active organization and prevents an inactive organization
-- becoming a bypass around older SECURITY DEFINER actor checks.
create or replace function public.prevent_inactive_organization_with_active_profiles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.active is true and new.active is false
     and exists (
       select 1
       from public.profiles as p
       where p.organization_id = new.id
         and p.active = true
     ) then
    raise exception 'Deactivate all organization profiles through the controlled administration process before disabling the organization.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_inactive_organization_with_active_profiles on public.organizations;
create trigger prevent_inactive_organization_with_active_profiles
before update of active on public.organizations
for each row execute function public.prevent_inactive_organization_with_active_profiles();

-- Never silently translate a historical role vocabulary. Stop for an explicit review instead.
do $$
declare unexpected_roles text; role_constraint record;
begin
  select string_agg(distinct p.role, ', ' order by p.role) into unexpected_roles
  from public.profiles p
  where p.role not in ('lucid_admin','leadership','office','production');
  if unexpected_roles is not null then
    raise exception 'Profiles contain unsupported legacy role values: %. Review and explicitly migrate them before applying 025.', unexpected_roles;
  end if;
  for role_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~* 'role'
  loop
    execute format('alter table public.profiles drop constraint %I', role_constraint.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'profiles_supported_role_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_supported_role_check
      check (role in ('lucid_admin','leadership','office','production'));
  end if;
end $$;

-- Inactive profiles resolve no organization, closing all policies based on this helper.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.organization_id
  from public.profiles p
  join public.organizations o on o.id = p.organization_id and o.active = true
  where p.id = auth.uid() and p.active = true
$$;
revoke all on function public.current_org_id() from public;
revoke all on function public.current_org_id() from anon;
grant execute on function public.current_org_id() to authenticated;

alter table public.organizations enable row level security;
drop policy if exists "organizations active current org read" on public.organizations;
create policy "organizations active current org read" on public.organizations
  for select using (id = public.current_org_id() and active = true);

-- Profiles remain visible only to active peers in the same organization. No generic writes.
drop policy if exists "profiles same org" on public.profiles;
drop policy if exists "profiles active same org read" on public.profiles;
create policy "profiles active same org read" on public.profiles
  for select using (organization_id = public.current_org_id());

create or replace function public.require_lucid_admin_actor()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare actor public.profiles%rowtype;
begin
  select p.* into actor from public.profiles p
  join public.organizations o on o.id = p.organization_id and o.active = true
  where p.id = auth.uid() and p.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if actor.role <> 'lucid_admin' then raise exception 'Only Lucid Admin can manage users.'; end if;
  return actor;
end;
$$;

create or replace function public.admin_create_lucid_profile(
  p_user_id uuid,
  p_display_name text,
  p_role text
)
returns table (profile_id uuid, organization_id uuid, role text, active boolean)
language plpgsql
security definer
set search_path = public
as $$
declare actor public.profiles%rowtype; target public.profiles%rowtype; clean_role text := nullif(btrim(p_role), ''); clean_name text := nullif(btrim(p_display_name), '');
begin
  actor := public.require_lucid_admin_actor();
  if p_user_id is null or clean_name is null or clean_role not in ('lucid_admin','leadership','office','production') then
    raise exception 'A user, display name, and supported role are required.';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then raise exception 'The invited Auth user was not found.'; end if;
  select p.* into target from public.profiles p where p.id = p_user_id for update;
  if found then
    if target.organization_id <> actor.organization_id then raise exception 'This Auth user already belongs to another organization.'; end if;
    raise exception 'This Auth user already has a Lucid profile.';
  end if;
  insert into public.profiles (id, organization_id, display_name, role, active, created_at, updated_at)
  values (p_user_id, actor.organization_id, clean_name, clean_role, true, now(), now());
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (actor.organization_id, actor.id, 'user invited and profile created', 'profile', p_user_id::text,
    jsonb_build_object('target_profile_id',p_user_id,'prior_role',null,'new_role',clean_role,'prior_active',null,'new_active',true));
  return query select p_user_id, actor.organization_id, clean_role, true;
end;
$$;

create or replace function public.admin_change_lucid_profile_role(p_target_profile_id uuid, p_role text)
returns table (profile_id uuid, role text, active boolean)
language plpgsql security definer set search_path = public as $$
declare actor public.profiles%rowtype; target public.profiles%rowtype; clean_role text := nullif(btrim(p_role), ''); active_admin_count integer;
begin
  actor := public.require_lucid_admin_actor();
  -- Serialize coverage changes so two administrators cannot concurrently
  -- remove the final active Lucid Admin from the same organization.
  perform pg_advisory_xact_lock(hashtext('lucid-admin-coverage:' || actor.organization_id::text));
  if p_target_profile_id is null or clean_role not in ('lucid_admin','leadership','office','production') then raise exception 'A target user and supported role are required.'; end if;
  if p_target_profile_id = actor.id then raise exception 'You cannot change your own role.'; end if;
  select p.* into target from public.profiles p where p.id = p_target_profile_id and p.organization_id = actor.organization_id for update;
  if not found then raise exception 'User was not found in your organization.'; end if;
  if target.role = 'lucid_admin' and clean_role <> 'lucid_admin' then
    select count(*) into active_admin_count from public.profiles p where p.organization_id=actor.organization_id and p.active=true and p.role='lucid_admin';
    if active_admin_count <= 1 then raise exception 'Your organization must retain at least one active Lucid Admin.'; end if;
  end if;
  if target.role is distinct from clean_role then
    update public.profiles p set role=clean_role, updated_at=now() where p.id=target.id;
    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (actor.organization_id, actor.id, 'user role changed', 'profile', target.id::text,
      jsonb_build_object('target_profile_id',target.id,'prior_role',target.role,'new_role',clean_role,'prior_active',target.active,'new_active',target.active));
  end if;
  return query select target.id, clean_role, target.active;
end;
$$;

create or replace function public.admin_set_lucid_profile_active(p_target_profile_id uuid, p_active boolean)
returns table (profile_id uuid, role text, active boolean)
language plpgsql security definer set search_path = public as $$
declare actor public.profiles%rowtype; target public.profiles%rowtype; active_admin_count integer;
begin
  actor := public.require_lucid_admin_actor();
  -- See admin_change_lucid_profile_role: this shared transaction lock closes
  -- the concurrent last-admin deactivation race.
  perform pg_advisory_xact_lock(hashtext('lucid-admin-coverage:' || actor.organization_id::text));
  if p_target_profile_id is null then raise exception 'A target user is required.'; end if;
  if p_target_profile_id = actor.id then raise exception 'You cannot change your own active state.'; end if;
  select p.* into target from public.profiles p where p.id=p_target_profile_id and p.organization_id=actor.organization_id for update;
  if not found then raise exception 'User was not found in your organization.'; end if;
  if target.active and not p_active and target.role='lucid_admin' then
    select count(*) into active_admin_count from public.profiles p where p.organization_id=actor.organization_id and p.active=true and p.role='lucid_admin';
    if active_admin_count <= 1 then raise exception 'Your organization must retain at least one active Lucid Admin.'; end if;
  end if;
  if target.active is distinct from p_active then
    update public.profiles p set active=p_active, updated_at=now() where p.id=target.id;
    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (actor.organization_id, actor.id, case when p_active then 'user reactivated' else 'user deactivated' end, 'profile', target.id::text,
      jsonb_build_object('target_profile_id',target.id,'prior_role',target.role,'new_role',target.role,'prior_active',target.active,'new_active',p_active));
  end if;
  return query select target.id, target.role, p_active;
end;
$$;

revoke all on function public.require_lucid_admin_actor() from public;
revoke all on function public.require_lucid_admin_actor() from anon;
revoke all on function public.prevent_inactive_organization_with_active_profiles() from public;
revoke all on function public.prevent_inactive_organization_with_active_profiles() from anon;
revoke all on function public.admin_create_lucid_profile(uuid,text,text) from public;
revoke all on function public.admin_create_lucid_profile(uuid,text,text) from anon;
revoke all on function public.admin_change_lucid_profile_role(uuid,text) from public;
revoke all on function public.admin_change_lucid_profile_role(uuid,text) from anon;
revoke all on function public.admin_set_lucid_profile_active(uuid,boolean) from public;
revoke all on function public.admin_set_lucid_profile_active(uuid,boolean) from anon;
grant execute on function public.admin_create_lucid_profile(uuid,text,text) to authenticated;
grant execute on function public.admin_change_lucid_profile_role(uuid,text) to authenticated;
grant execute on function public.admin_set_lucid_profile_active(uuid,boolean) to authenticated;

commit;

-- Rollback-only authorization validation for Leadership user-management denial.
-- Run in Supabase SQL Editor. It changes no durable user or profile data.
begin;

create temporary table qa_025_leadership_authorization_fixture (
  leadership_id uuid,
  organization_id uuid
) on commit drop;
grant select, insert, update, delete on table qa_025_leadership_authorization_fixture to authenticated;

-- Resolve the active Leadership QA actor before assuming the authenticated role.
insert into qa_025_leadership_authorization_fixture (leadership_id, organization_id)
select p.id, p.organization_id
from public.profiles p
join public.organizations o on o.id = p.organization_id and o.active = true
where p.active = true and p.role = 'leadership'
order by p.created_at
limit 1;

set local role authenticated;

do $$
declare
  fixture qa_025_leadership_authorization_fixture%rowtype;
  denied boolean;
begin
  select * into fixture from qa_025_leadership_authorization_fixture;
  if fixture.leadership_id is null then
    raise notice 'SKIPPED: an active Leadership QA profile is required.';
    return;
  end if;

  perform set_config('request.jwt.claim.sub', fixture.leadership_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- Every public Admin RPC must fail at the internal Lucid Admin actor gate,
  -- before validating or changing its synthetic target arguments.
  denied := false;
  begin
    perform public.admin_create_lucid_profile(
      '00000000-0000-0000-0000-000000000026'::uuid,
      'QA Leadership denied mutation',
      'production'
    );
  exception when others then
    denied := position('Only Lucid Admin can manage users.' in sqlerrm) > 0;
  end;
  if not denied then raise exception 'Leadership was allowed to invoke profile creation.'; end if;

  denied := false;
  begin
    perform public.admin_change_lucid_profile_role(fixture.leadership_id, 'office');
  exception when others then
    denied := position('Only Lucid Admin can manage users.' in sqlerrm) > 0;
  end;
  if not denied then raise exception 'Leadership was allowed to invoke role change.'; end if;

  denied := false;
  begin
    perform public.admin_set_lucid_profile_active(fixture.leadership_id, false);
  exception when others then
    denied := position('Only Lucid Admin can manage users.' in sqlerrm) > 0;
  end;
  if not denied then raise exception 'Leadership was allowed to invoke active-state change.'; end if;
end;
$$;

rollback;

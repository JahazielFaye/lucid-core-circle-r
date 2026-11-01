-- Immutable registry and authenticated approval ledger for Customer Master
-- migration review manifests.  This migration intentionally has no Customer,
-- Ship-To, Contact, or Customer Item operational write path.
begin;

create table if not exists customer_review_manifests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  entity_family text not null default 'customer_master' check (entity_family = 'customer_master'),
  source_system text not null check (source_system = 'food_connex'),
  source_dataset_identifier text not null check (length(btrim(source_dataset_identifier)) > 0),
  lineage_id text not null check (lineage_id ~ '^[a-f0-9]{64}$'),
  manifest_id text not null check (manifest_id ~ '^[a-f0-9]{64}$'),
  manifest_version integer not null check (manifest_version > 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  plan_hash text not null check (plan_hash ~ '^[a-f0-9]{64}$'),
  planner_version text not null check (length(btrim(planner_version)) > 0),
  generated_at timestamptz not null,
  generated_by uuid not null references profiles(id) on delete restrict,
  environment text not null check (length(btrim(environment)) > 0),
  canonical_manifest jsonb not null,
  counts jsonb not null,
  previous_manifest_registry_id uuid references customer_review_manifests(id) on delete restrict,
  previous_manifest_version integer,
  status text not null default 'READY_FOR_REVIEW' check (status in ('DRAFT','READY_FOR_REVIEW','UNDER_REVIEW','APPROVED','REJECTED','SUPERSEDED','INVALIDATED')),
  registered_at timestamptz not null default now(),
  check ((previous_manifest_registry_id is null and previous_manifest_version is null) or (previous_manifest_registry_id is not null and previous_manifest_version is not null)),
  unique (organization_id, manifest_id),
  unique (organization_id, lineage_id, manifest_version)
);

create table if not exists customer_review_manifest_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  manifest_registry_id uuid not null references customer_review_manifests(id) on delete restrict,
  manifest_id text not null check (manifest_id ~ '^[a-f0-9]{64}$'),
  manifest_version integer not null check (manifest_version > 0),
  reviewer_id uuid not null references profiles(id) on delete restrict,
  reviewer_role text not null check (reviewer_role in ('lucid_admin','leadership','office')),
  decision text not null check (decision in ('APPROVE','REJECT','NEEDS_REVIEW')),
  comment text,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  plan_hash text not null check (plan_hash ~ '^[a-f0-9]{64}$'),
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists customer_review_manifests_registry_lookup_idx
  on customer_review_manifests (organization_id, entity_family, source_system, source_dataset_identifier, manifest_version desc);
create index if not exists customer_review_manifests_status_idx
  on customer_review_manifests (organization_id, status, registered_at desc);
create index if not exists customer_review_manifest_approvals_manifest_idx
  on customer_review_manifest_approvals (organization_id, manifest_registry_id, decided_at desc);

-- Canonical payload/hash/version fields may never be edited.  Status transitions
-- are performed only by the authenticated functions below; delete is never a
-- valid correction mechanism.
create or replace function prevent_customer_review_manifest_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Registered review manifests are immutable and cannot be deleted.';
  end if;
  if old.organization_id is distinct from new.organization_id
     or old.entity_family is distinct from new.entity_family
     or old.source_system is distinct from new.source_system
     or old.source_dataset_identifier is distinct from new.source_dataset_identifier
     or old.lineage_id is distinct from new.lineage_id
     or old.manifest_id is distinct from new.manifest_id
     or old.manifest_version is distinct from new.manifest_version
     or old.source_hash is distinct from new.source_hash
     or old.plan_hash is distinct from new.plan_hash
     or old.planner_version is distinct from new.planner_version
     or old.generated_at is distinct from new.generated_at
     or old.generated_by is distinct from new.generated_by
     or old.environment is distinct from new.environment
     or old.canonical_manifest is distinct from new.canonical_manifest
     or old.counts is distinct from new.counts
     or old.previous_manifest_registry_id is distinct from new.previous_manifest_registry_id
     or old.previous_manifest_version is distinct from new.previous_manifest_version then
    raise exception 'Registered review manifest content is immutable; register a new version instead.';
  end if;
  return new;
end;
$$;

create or replace function prevent_customer_review_approval_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'Approval ledger events are append-only and cannot be changed or deleted.';
end;
$$;

drop trigger if exists customer_review_manifests_immutable on customer_review_manifests;
drop trigger if exists customer_review_manifest_approvals_immutable on customer_review_manifest_approvals;

create trigger customer_review_manifests_immutable
  before update or delete on customer_review_manifests
  for each row execute function prevent_customer_review_manifest_mutation();
create trigger customer_review_manifest_approvals_immutable
  before update or delete on customer_review_manifest_approvals
  for each row execute function prevent_customer_review_approval_mutation();

alter table customer_review_manifests enable row level security;
alter table customer_review_manifest_approvals enable row level security;
drop policy if exists "customer review manifests select same org" on customer_review_manifests;
drop policy if exists "customer review approvals select same org" on customer_review_manifest_approvals;
create policy "customer review manifests select same org" on customer_review_manifests
  for select using (organization_id = current_org_id());
create policy "customer review approvals select same org" on customer_review_manifest_approvals
  for select using (organization_id = current_org_id());

create or replace function register_customer_review_manifest(p_manifest jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor profiles%rowtype;
  existing_row customer_review_manifests%rowtype;
  previous_row customer_review_manifests%rowtype;
  inserted_row customer_review_manifests%rowtype;
  manifest_org uuid;
  manifest_identifier text;
  source_identifier text;
  manifest_lineage text;
  manifest_version_value integer;
  source_hash_value text;
  plan_hash_value text;
  manifest_generated_by uuid;
  has_previous boolean := false;
begin
  select p.* into actor from profiles as p where p.id = auth.uid() and p.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if actor.role <> 'lucid_admin' then raise exception 'Only Lucid Admin can register a Customer review manifest.'; end if;
  if p_manifest is null or p_manifest ->> 'schema_version' <> 'customer-review-manifest-v1'
     or p_manifest ->> 'source_system' <> 'food_connex'
     or p_manifest ->> 'planner_version' is null
     or p_manifest -> 'counts' is null then
    raise exception 'A valid Customer review manifest is required.';
  end if;

  manifest_org := (p_manifest ->> 'organization_id')::uuid;
  manifest_identifier := p_manifest ->> 'manifest_id';
  manifest_lineage := p_manifest ->> 'lineage_id';
  manifest_version_value := (p_manifest ->> 'manifest_version')::integer;
  source_identifier := p_manifest #>> '{source_dataset,reference}';
  source_hash_value := p_manifest #>> '{integrity,source_hash}';
  plan_hash_value := p_manifest #>> '{integrity,plan_hash}';
  manifest_generated_by := (p_manifest #>> '{generated_by,actor_id}')::uuid;
  if manifest_org is distinct from actor.organization_id or manifest_generated_by is distinct from actor.id then
    raise exception 'A review manifest must be registered by its authenticated organization and generator.';
  end if;
  if manifest_identifier !~ '^[a-f0-9]{64}$' or manifest_lineage !~ '^[a-f0-9]{64}$'
     or source_hash_value !~ '^[a-f0-9]{64}$' or plan_hash_value !~ '^[a-f0-9]{64}$'
     or source_identifier is null or length(btrim(source_identifier)) = 0
     or p_manifest #>> '{source_dataset,hash}' is distinct from source_hash_value
     or p_manifest ->> 'plan_hash' is distinct from plan_hash_value then
    raise exception 'Manifest integrity metadata is invalid.';
  end if;

  select m.* into existing_row from customer_review_manifests as m
    where m.organization_id = actor.organization_id and m.manifest_id = manifest_identifier;
  if found then
    -- generated_at/generated_by are display/audit metadata, not part of the
    -- deterministic review artifact.  The first registry row retains them for
    -- audit; all substantive canonical fields remain exact-match protected.
    if existing_row.source_hash is distinct from source_hash_value or existing_row.plan_hash is distinct from plan_hash_value
       or (existing_row.canonical_manifest - 'generated_at' - 'generated_by') is distinct from (p_manifest - 'generated_at' - 'generated_by') then
      raise exception 'Manifest ID collision with different immutable content.';
    end if;
    return jsonb_build_object('registry_id', existing_row.id, 'manifest_id', existing_row.manifest_id, 'manifest_version', existing_row.manifest_version, 'status', existing_row.status, 'registered', false);
  end if;

  select m.* into previous_row from customer_review_manifests as m
    where m.organization_id = actor.organization_id and m.lineage_id = manifest_lineage
    order by m.manifest_version desc limit 1 for update;
  if found then
    has_previous := true;
    if manifest_version_value <> previous_row.manifest_version + 1
       or p_manifest ->> 'previous_manifest_id' is distinct from previous_row.manifest_id then
      raise exception 'Manifest version must directly follow the registered predecessor.';
    end if;
  elsif manifest_version_value <> 1 or (p_manifest ->> 'previous_manifest_id') is not null then
    raise exception 'The first registered manifest version must be version 1 without a predecessor.';
  end if;

  insert into customer_review_manifests (
    organization_id, entity_family, source_system, source_dataset_identifier, lineage_id, manifest_id, manifest_version,
    source_hash, plan_hash, planner_version, generated_at, generated_by, environment, canonical_manifest, counts,
    previous_manifest_registry_id, previous_manifest_version, status
  ) values (
    actor.organization_id, 'customer_master', 'food_connex', source_identifier, manifest_lineage, manifest_identifier, manifest_version_value,
    source_hash_value, plan_hash_value, p_manifest ->> 'planner_version', (p_manifest ->> 'generated_at')::timestamptz,
    actor.id, p_manifest ->> 'environment', p_manifest, coalesce(p_manifest -> 'counts', '{}'::jsonb),
    case when has_previous then previous_row.id else null end, case when has_previous then previous_row.manifest_version else null end, 'READY_FOR_REVIEW'
  ) returning * into inserted_row;

  if previous_row.id is not null then
    update customer_review_manifests as m set status = 'SUPERSEDED' where m.id = previous_row.id;
    insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
      values (actor.organization_id, actor.id, 'customer review manifest superseded', 'customer_review_manifest', previous_row.id::text, jsonb_build_object('superseded_by', inserted_row.id, 'manifest_version', previous_row.manifest_version));
  end if;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (actor.organization_id, actor.id, 'customer review manifest registered', 'customer_review_manifest', inserted_row.id::text, jsonb_build_object('manifest_id', inserted_row.manifest_id, 'manifest_version', inserted_row.manifest_version, 'source_hash', inserted_row.source_hash, 'plan_hash', inserted_row.plan_hash));
  return jsonb_build_object('registry_id', inserted_row.id, 'manifest_id', inserted_row.manifest_id, 'manifest_version', inserted_row.manifest_version, 'status', inserted_row.status, 'registered', true);
end;
$$;

create or replace function record_customer_review_manifest_decision(
  p_registry_id uuid, p_manifest_id text, p_manifest_version integer, p_source_hash text, p_plan_hash text,
  p_decision text, p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor profiles%rowtype;
  manifest_row customer_review_manifests%rowtype;
  approval_row customer_review_manifest_approvals%rowtype;
  next_status text;
  has_conflicts boolean;
begin
  select p.* into actor from profiles as p where p.id = auth.uid() and p.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if p_decision not in ('APPROVE','REJECT','NEEDS_REVIEW') then raise exception 'Unsupported review decision.'; end if;
  if (p_decision in ('APPROVE','REJECT') and actor.role <> 'lucid_admin')
     or (p_decision = 'NEEDS_REVIEW' and actor.role not in ('lucid_admin','leadership','office')) then
    raise exception 'Your role cannot record this formal review decision.';
  end if;
  select m.* into manifest_row from customer_review_manifests as m
    where m.id = p_registry_id and m.organization_id = actor.organization_id for update;
  if not found then raise exception 'Review manifest is unavailable for your organization.'; end if;
  if manifest_row.status in ('SUPERSEDED','INVALIDATED') then raise exception 'A superseded or invalidated manifest cannot receive a decision.'; end if;
  if manifest_row.manifest_id is distinct from p_manifest_id or manifest_row.manifest_version is distinct from p_manifest_version
     or manifest_row.source_hash is distinct from p_source_hash or manifest_row.plan_hash is distinct from p_plan_hash then
    raise exception 'Formal decisions must bind to the exact registered manifest hashes and version.';
  end if;
  insert into customer_review_manifest_approvals (organization_id, manifest_registry_id, manifest_id, manifest_version, reviewer_id, reviewer_role, decision, comment, source_hash, plan_hash)
    values (actor.organization_id, manifest_row.id, manifest_row.manifest_id, manifest_row.manifest_version, actor.id, actor.role, p_decision, nullif(btrim(p_comment), ''), manifest_row.source_hash, manifest_row.plan_hash)
    returning * into approval_row;
  has_conflicts := coalesce(manifest_row.counts #>> '{by_action,CONFLICT}', '0')::integer > 0;
  next_status := case when p_decision = 'APPROVE' then 'APPROVED' when p_decision = 'REJECT' then 'REJECTED' else 'UNDER_REVIEW' end;
  update customer_review_manifests as m set status = next_status where m.id = manifest_row.id;
  if manifest_row.status = 'READY_FOR_REVIEW' then
    insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
      values (actor.organization_id, actor.id, 'customer review started', 'customer_review_manifest', manifest_row.id::text, '{}'::jsonb);
  end if;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (actor.organization_id, actor.id, 'customer review decision recorded', 'customer_review_manifest', manifest_row.id::text, jsonb_build_object('decision', p_decision, 'approval_id', approval_row.id, 'conflicts_remain', has_conflicts));
  return jsonb_build_object('approval_id', approval_row.id, 'status', next_status, 'decision', p_decision, 'commit_eligible', p_decision = 'APPROVE' and not has_conflicts);
end;
$$;

create or replace function invalidate_customer_review_manifest(p_registry_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare actor profiles%rowtype; manifest_row customer_review_manifests%rowtype;
begin
  select p.* into actor from profiles as p where p.id = auth.uid() and p.active = true;
  if not found or actor.role <> 'lucid_admin' then raise exception 'Only Lucid Admin can invalidate a review manifest.'; end if;
  select m.* into manifest_row from customer_review_manifests as m where m.id = p_registry_id and m.organization_id = actor.organization_id for update;
  if not found then raise exception 'Review manifest is unavailable for your organization.'; end if;
  if manifest_row.status = 'SUPERSEDED' then raise exception 'A superseded manifest is already ineligible.'; end if;
  update customer_review_manifests as m set status = 'INVALIDATED' where m.id = manifest_row.id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (actor.organization_id, actor.id, 'customer review manifest invalidated', 'customer_review_manifest', manifest_row.id::text, jsonb_build_object('reason', nullif(btrim(p_reason), '')));
  return jsonb_build_object('registry_id', manifest_row.id, 'status', 'INVALIDATED');
end;
$$;

revoke all on function register_customer_review_manifest(jsonb) from public;
revoke all on function record_customer_review_manifest_decision(uuid, text, integer, text, text, text, text) from public;
revoke all on function invalidate_customer_review_manifest(uuid, text) from public;
grant execute on function register_customer_review_manifest(jsonb) to authenticated;
grant execute on function record_customer_review_manifest_decision(uuid, text, integer, text, text, text, text) to authenticated;
grant execute on function invalidate_customer_review_manifest(uuid, text) to authenticated;

commit;

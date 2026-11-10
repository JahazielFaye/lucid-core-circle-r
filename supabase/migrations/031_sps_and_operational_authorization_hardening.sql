-- 031: explicit application ACLs and bounded, RLS-subject order RPC owners.
-- LOCAL AUTHORING ONLY. Apply only after the 031 read-only preflight passes.
-- Owner/schema default ACL correction: postgres / public / future TABLES only.
begin;
set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

-- Fail before ownership/bootstrap changes. Existing private names are not adopted.
do $preconditions$
declare actual pg_catalog.text[];
begin
  if current_user <> 'postgres' then raise exception '031 requires the reviewed postgres migration executor.'; end if;
  if not (select r.rolcreaterole from pg_catalog.pg_roles r where r.rolname=current_user) then
    raise exception '031 requires CREATEROLE; no ownership workaround is permitted.';
  end if;
  if not pg_catalog.has_schema_privilege(current_user,'public','CREATE WITH GRANT OPTION') then
    raise exception '031 ownership bootstrap requires grantable CREATE on public.';
  end if;
  if not pg_catalog.has_schema_privilege(current_user,'auth','USAGE')
     or not pg_catalog.has_function_privilege(current_user,'auth.uid()','EXECUTE') then
    raise exception '031 actor-only helper owner cannot resolve the request subject.';
  end if;
  if exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='lucid_request_actor_id') then
    raise exception '031 actor helper name already exists; inspect rather than replace.';
  end if;
  if not exists(select 1 from pg_catalog.pg_policy p where p.polrelid='public.audit_events'::pg_catalog.regclass
    and p.polname='audit insert own actor' and p.polcmd='a' and p.polroles=ARRAY[0]::pg_catalog.oid[]) then
    raise exception '031 existing actor-bound audit INSERT policy is missing or changed.';
  end if;
  if not exists(select 1 from pg_catalog.pg_roles where oid=10 and rolname='supabase_admin' and rolsuper)
    or (select rolsuper from pg_catalog.pg_roles where rolname=current_user) then
    raise exception '031 requires reviewed Supabase non-superuser creator-admin membership semantics.';
  end if;
  select pg_catalog.array_agg(c.relname::pg_catalog.text order by c.relname) into actual
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r';
  if actual is distinct from ARRAY['audit_events','case_pick_allocations','conversation_members','conversations','customer_contacts','customer_items','customer_review_manifest_approvals','customer_review_manifests','customer_ship_tos','customers','documents','exceptions','integration_customer_mappings','integration_import_batches','integration_item_mappings','integration_ship_to_mappings','inventory_lots','inventory_transaction_lines','inventory_transactions','item_identifiers','item_packaging_instructions','item_weight_bands','items','message_reads','messages','order_lines','orders','organizations','pallet_case_assignments','pallet_cases','pallets','production_case_weight_events','production_cases','production_lots','production_run_consumptions','production_run_outputs','production_runs','production_stations','production_weight_readings','profiles','shipment_contents','shipments','sps_order_exceptions','sps_staged_order_lines','sps_staged_orders','vendor_items','vendors','warehouses']::pg_catalog.text[] then raise exception '031 reviewed 48-table inventory mismatch.'; end if;
  if exists(select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
    and a.attacl is not null and exists(select 1 from pg_catalog.aclexplode(a.attacl) x
      where x.grantee=0 or x.grantee in (select oid from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role')))) then
    raise exception '031 unexpected browser/service column ACL; review before applying.';
  end if;
  if exists(select 1 from pg_catalog.pg_default_acl d,lateral pg_catalog.aclexplode(d.defaclacl) a
    where d.defaclrole=(select oid from pg_catalog.pg_roles where rolname='postgres') and d.defaclnamespace=0 and d.defaclobjtype='r'
    and (a.grantee=0 or a.grantee in (select oid from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role')))) then
    raise exception '031 global table defaults are outside reviewed scope; inspect before applying.';
  end if;
  if exists(select 1 from pg_catalog.pg_roles where rolname in ('lucid_sps_promoter','lucid_order_operator')) then
    raise exception '031 private role name already exists; inspect rather than reuse it.';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_trigger where not tgisinternal and tgname in (
    'enforce_lucid_sps_customer_mapping_write_role','enforce_lucid_sps_ship_to_mapping_write_role','enforce_lucid_sps_item_mapping_write_role',
    'enforce_lucid_sps_staged_order_write_role','enforce_lucid_sps_staged_line_write_role','enforce_lucid_sps_exception_write_role')) <> 6 then
    raise exception '031 requires all six 030 write-role gates.';
  end if;
  if pg_catalog.to_regprocedure('public.promote_sps_staged_order(uuid)') is null
     or pg_catalog.to_regprocedure('public.start_lucid_production(uuid)') is null
     or pg_catalog.to_regprocedure('public.complete_lucid_production(uuid)') is null
     or pg_catalog.to_regprocedure('public.create_lucid_qa_order(text,text,text,text,text,numeric,text)') is null then
    raise exception '031 required operational RPC signature missing.';
  end if;
  if exists(select 1 from pg_catalog.pg_proc p where p.oid in (
    'public.promote_sps_staged_order(uuid)'::pg_catalog.regprocedure,'public.start_lucid_production(uuid)'::pg_catalog.regprocedure,
    'public.complete_lucid_production(uuid)'::pg_catalog.regprocedure,
    'public.create_lucid_qa_order(text,text,text,text,text,numeric,text)'::pg_catalog.regprocedure)
    and p.proowner <> (select oid from pg_catalog.pg_roles where rolname=current_user)) then
    raise exception '031 executor must own every transferred RPC.';
  end if;
  if not exists(select 1 from pg_catalog.pg_attribute where attrelid='public.sps_staged_orders'::pg_catalog.regclass and attname='source_document_key' and not attisdropped) then
    raise exception '031 requires the 030 source-document foundation.';
  end if;
end;
$preconditions$;

-- No row-DML grants are introduced by this reviewed inventory cleanup.
revoke truncate, references, trigger, maintain on table
  public.audit_events,
  public.case_pick_allocations,
  public.conversation_members,
  public.conversations,
  public.customer_contacts,
  public.customer_items,
  public.customer_review_manifest_approvals,
  public.customer_review_manifests,
  public.customer_ship_tos,
  public.customers,
  public.documents,
  public.exceptions,
  public.integration_customer_mappings,
  public.integration_import_batches,
  public.integration_item_mappings,
  public.integration_ship_to_mappings,
  public.inventory_lots,
  public.inventory_transaction_lines,
  public.inventory_transactions,
  public.item_identifiers,
  public.item_packaging_instructions,
  public.item_weight_bands,
  public.items,
  public.message_reads,
  public.messages,
  public.order_lines,
  public.orders,
  public.organizations,
  public.pallet_case_assignments,
  public.pallet_cases,
  public.pallets,
  public.production_case_weight_events,
  public.production_cases,
  public.production_lots,
  public.production_run_consumptions,
  public.production_run_outputs,
  public.production_runs,
  public.production_stations,
  public.production_weight_readings,
  public.profiles,
  public.shipment_contents,
  public.shipments,
  public.sps_order_exceptions,
  public.sps_staged_order_lines,
  public.sps_staged_orders,
  public.vendor_items,
  public.vendors,
  public.warehouses
from public, anon, authenticated;

-- Inspect effective CREATE first; do not change any managed schema or admin role.
do $schema_create$
begin
  if exists(select 1 from pg_catalog.pg_namespace n,
      lateral pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
      where n.nspname='public' and a.grantee=0 and a.privilege_type='CREATE') then
    execute 'revoke create on schema public from public';
  end if;
  if pg_catalog.has_schema_privilege('anon','public','CREATE') then execute 'revoke create on schema public from anon'; end if;
  if pg_catalog.has_schema_privilege('authenticated','public','CREATE') then execute 'revoke create on schema public from authenticated'; end if;
  if pg_catalog.has_schema_privilege('anon','public','CREATE') or pg_catalog.has_schema_privilege('authenticated','public','CREATE') then
    raise exception '031 cannot safely remove inherited browser CREATE; inspect role memberships.';
  end if;
end;
$schema_create$;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated, service_role;

revoke all privileges on table
  public.sps_staged_orders,
  public.sps_staged_order_lines,
  public.sps_order_exceptions,
  public.integration_customer_mappings,
  public.integration_ship_to_mappings,
  public.integration_item_mappings
from public, anon, authenticated, service_role;
grant select, insert, update, delete on table
  public.sps_staged_orders,
  public.sps_staged_order_lines,
  public.sps_order_exceptions,
  public.integration_customer_mappings,
  public.integration_ship_to_mappings,
  public.integration_item_mappings
to authenticated;

revoke all privileges on table public.orders, public.order_lines, public.audit_events
  from public, anon, authenticated, service_role;
grant select on table public.orders, public.order_lines, public.audit_events to authenticated;
grant select on table public.profiles, public.customers, public.customer_ship_tos,
  public.items, public.customer_items, public.item_identifiers to authenticated;

create role lucid_sps_promoter nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create role lucid_order_operator nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
-- Bootstrap only the already privileged executor; revoke before commit.
grant lucid_sps_promoter, lucid_order_operator to postgres;
grant usage, create on schema public to lucid_sps_promoter, lucid_order_operator;
grant execute on function public.current_org_id() to lucid_sps_promoter, lucid_order_operator;

-- Option A: a zero-argument actor-only wrapper, NOT a privileged promotion owner.
-- postgres already has auth USAGE/uid EXECUTE; nothing is delegated on schema auth.
-- PostgREST validates the request JWT and supplies its transaction context to auth.uid().
create function public.lucid_request_actor_id()
returns pg_catalog.uuid language plpgsql stable security definer set search_path = '' as $fn$
declare request_actor pg_catalog.uuid;
begin
  request_actor:=auth.uid();
  if request_actor is null then
    raise exception using errcode='42501',message='An authenticated request actor is required.';
  end if;
  return request_actor;
end;
$fn$;
alter function public.lucid_request_actor_id() owner to postgres;
revoke all on function public.lucid_request_actor_id() from public,anon,authenticated,service_role;
-- authenticated needs only its own subject for the shared invoker trigger/policy.
grant execute on function public.lucid_request_actor_id() to authenticated,lucid_sps_promoter,lucid_order_operator;

-- The existing six SPS role triggers also run as the private promotion owner.
-- Preserve their role/org gate while removing that invoker's direct auth dependency.
create or replace function public.assert_lucid_sps_write_role()
returns trigger language plpgsql security invoker set search_path = '' as $fn$
declare actor public.profiles%rowtype; target_organization_id pg_catalog.uuid;
begin
  if TG_OP='DELETE' then target_organization_id:=OLD.organization_id;
  else target_organization_id:=NEW.organization_id; end if;
  select p.* into actor from public.profiles p
    where p.id=public.lucid_request_actor_id() and p.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if actor.role not in ('office','leadership','lucid_admin') then
    raise exception 'Your role cannot change incoming SPS orders or mappings.';
  end if;
  if actor.organization_id is distinct from target_organization_id then
    raise exception 'Incoming SPS records must belong to your organization.';
  end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end;
$fn$;

-- Same RLS predicate, same roles/command; only the actor lookup changes.
-- current_org_id() remains the existing postgres-owned SECDEF RLS boundary.
alter policy "audit insert own actor" on public.audit_events
  with check (organization_id=public.current_org_id() and actor_id=public.lucid_request_actor_id());
grant select on table public.profiles, public.organizations, public.orders to lucid_sps_promoter, lucid_order_operator;
grant select on table public.customers, public.customer_ship_tos, public.items,
  public.sps_staged_orders, public.sps_staged_order_lines, public.sps_order_exceptions,
  public.integration_customer_mappings, public.integration_ship_to_mappings, public.integration_item_mappings to lucid_sps_promoter;
grant insert on table public.orders, public.order_lines, public.audit_events to lucid_sps_promoter;
grant update(review_status,promoted_order_id,approved_by,approved_at) on public.sps_staged_orders to lucid_sps_promoter;
grant select on table public.order_lines to lucid_sps_promoter;
grant select on table public.order_lines, public.production_cases, public.customers, public.customer_ship_tos to lucid_order_operator;
grant update(status) on public.orders to lucid_order_operator;
grant insert on public.audit_events to lucid_order_operator;
-- Identity defaults, not explicit nextval/currval/setval: no sequence grants.

-- Protect BOTH source parents; child reparenting must not escape a promoted source.
create or replace function public.protect_lucid_promoted_sps_source()
returns trigger language plpgsql security invoker set search_path = '' as $fn$
declare old_parent pg_catalog.uuid; new_parent pg_catalog.uuid;
begin
  if TG_TABLE_NAME='sps_staged_orders' then
    if TG_OP<>'INSERT' and (OLD.review_status='promoted' or OLD.promoted_order_id is not null) then
      raise exception 'Promoted SPS source documents are immutable.';
    end if;
  else
    if TG_OP<>'INSERT' then old_parent:=OLD.staged_order_id; end if;
    if TG_OP<>'DELETE' then new_parent:=NEW.staged_order_id; end if;
    if exists(select 1 from public.sps_staged_orders s where s.id in (old_parent,new_parent)
      and (s.review_status='promoted' or s.promoted_order_id is not null)) then
      raise exception 'Promoted SPS source documents are immutable.';
    end if;
  end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end;
$fn$;

create function public.protect_lucid_sps_promotion_metadata()
returns trigger language plpgsql security invoker set search_path = '' as $fn$
begin
  if current_user <> 'lucid_sps_promoter' then
    if TG_OP='INSERT' then
      if NEW.review_status='promoted' or NEW.promoted_order_id is not null or NEW.approved_by is not null or NEW.approved_at is not null then
        raise exception 'Promotion metadata is controlled by the promotion RPC.';
      end if;
    elsif NEW.review_status='promoted' or NEW.promoted_order_id is distinct from OLD.promoted_order_id
      or NEW.approved_by is distinct from OLD.approved_by or NEW.approved_at is distinct from OLD.approved_at then
      raise exception 'Promotion metadata is controlled by the promotion RPC.';
    end if;
  end if;
  return NEW;
end;
$fn$;
create trigger protect_lucid_sps_promotion_metadata before insert or update on public.sps_staged_orders
  for each row execute function public.protect_lucid_sps_promotion_metadata();

-- Price authority is enforced below the HTTP layer; direct REST DML cannot bypass it.
create function public.protect_lucid_sps_price_authority()
returns trigger language plpgsql security invoker set search_path = '' as $fn$
declare actor public.profiles%rowtype; oldj pg_catalog.jsonb; newj pg_catalog.jsonb; approved pg_catalog.numeric; source_price pg_catalog.numeric; proposed_price pg_catalog.numeric;
begin
  select p.* into actor from public.profiles p
    where p.id=public.lucid_request_actor_id() and p.active and p.organization_id=public.current_org_id();
  if not found or actor.role not in ('office','leadership','lucid_admin') then
    raise exception using errcode='42501',message='Only authorized SPS reviewers can change pricing evidence.';
  end if;
  if TG_OP<>'INSERT' then oldj:=pg_catalog.to_jsonb(OLD); end if;
  if TG_OP<>'DELETE' then newj:=pg_catalog.to_jsonb(NEW); end if;
  if TG_TABLE_NAME='sps_order_exceptions' then
    if coalesce(oldj->>'exception_code',newj->>'exception_code')='PRICE_MISMATCH'
      or newj->>'exception_code'='PRICE_MISMATCH' then
      if TG_OP='INSERT' then
        if NEW.status<>'open' or NEW.resolution_action is not null or NEW.resolved_by is not null or NEW.resolved_at is not null then
          raise exception 'Price decisions must resolve an existing open exception.';
        end if;
      elsif actor.role='office' then
        if TG_OP='DELETE' then raise exception 'Only leadership or Lucid Admin can finalize a price resolution.'; end if;
        if (newj-'details') is distinct from (oldj-'details')
          or (NEW.details-'leadership_review_requested_by'-'leadership_review_requested_at')
             is distinct from (OLD.details-'leadership_review_requested_by'-'leadership_review_requested_at')
          or NEW.details->>'leadership_review_requested_by' is distinct from actor.id::pg_catalog.text then
          raise exception 'Only leadership or Lucid Admin can finalize a price resolution.';
        end if;
        NEW.details:=NEW.details || pg_catalog.jsonb_build_object('leadership_review_requested_at',pg_catalog.now());
      elsif TG_OP='UPDATE' and NEW.status in ('resolved','dismissed') then
        if OLD.status<>'open' or NEW.status<>'resolved'
          or NEW.resolution_action not in ('use_sps_price','use_approved_circle_r_price')
          or NEW.resolution_action is null or NEW.exception_code<>'PRICE_MISMATCH' then
          raise exception 'A price decision requires one explicit permitted resolution.';
        end if;
        select l.sps_purchase_price,l.approved_circle_r_price into source_price,proposed_price
          from public.sps_staged_order_lines l where l.id=NEW.staged_order_line_id
           and l.staged_order_id=NEW.staged_order_id and l.organization_id=actor.organization_id;
        if not found or (NEW.resolution_action='use_sps_price' and source_price is null)
          or (NEW.resolution_action='use_approved_circle_r_price' and proposed_price is null) then
          raise exception 'The selected price must exist on the same-organization source line.';
        end if;
        NEW.resolved_by:=actor.id; NEW.resolved_at:=pg_catalog.now();
      end if;
    elsif TG_OP<>'DELETE' and NEW.resolution_action in ('use_sps_price','use_approved_circle_r_price') then
      raise exception 'Price actions require a PRICE_MISMATCH exception.';
    end if;
  elsif actor.role='office' and TG_TABLE_NAME='integration_item_mappings' then
    if (TG_OP='INSERT' and NEW.approved_price is not null)
      or (TG_OP='UPDATE' and NEW.approved_price is distinct from OLD.approved_price) then
      raise exception 'Only leadership or Lucid Admin can approve a mapping price.';
    end if;
  elsif actor.role='office' and TG_TABLE_NAME='sps_staged_order_lines' and TG_OP<>'DELETE' then
    if TG_OP='UPDATE' and NEW.sps_purchase_price is distinct from OLD.sps_purchase_price then
      raise exception 'Office cannot rewrite the source purchase price.';
    end if;
    if NEW.approved_circle_r_price is not null then
      select m.approved_price into approved from public.integration_item_mappings m
       where m.id=NEW.item_mapping_id and m.organization_id=actor.organization_id and m.status='active';
      if approved is null or NEW.approved_circle_r_price is distinct from approved then
        raise exception 'Office may only reuse an already approved mapping price.';
      end if;
    end if;
    if TG_OP='UPDATE' and OLD.approved_circle_r_price is not null and NEW.approved_circle_r_price is null then
      raise exception 'Office cannot remove an approved price to bypass review.';
    end if;
  end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end;
$fn$;
create trigger protect_lucid_sps_exception_price_authority before insert or update or delete on public.sps_order_exceptions
  for each row execute function public.protect_lucid_sps_price_authority();
create trigger protect_lucid_sps_mapping_price_authority before insert or update on public.integration_item_mappings
  for each row execute function public.protect_lucid_sps_price_authority();
create trigger protect_lucid_sps_line_price_authority before insert or update on public.sps_staged_order_lines
  for each row execute function public.protect_lucid_sps_price_authority();

create or replace function public.promote_sps_staged_order(p_staged_order_id pg_catalog.uuid)
returns table(operational_order_id pg_catalog.uuid,already_promoted pg_catalog.bool,operational_status pg_catalog.text)
language plpgsql security definer set search_path = '' as $fn$
declare staged public.sps_staged_orders%rowtype; actor public.profiles%rowtype;
  customer_map public.integration_customer_mappings%rowtype; ship_map public.integration_ship_to_mappings%rowtype;
  existing_id pg_catalog.uuid; inserted_id pg_catalog.uuid;
begin
  select p.* into actor from public.profiles p join public.organizations o on o.id=p.organization_id
   where p.id=public.lucid_request_actor_id() and p.active and o.active;
  if not found then raise exception 'An active Lucid Core profile and organization are required.'; end if;
  if actor.role not in ('office','leadership','lucid_admin') then raise exception using errcode='42501',message='Your role cannot send incoming orders to production.'; end if;
  select s.* into staged from public.sps_staged_orders s
   where s.id=p_staged_order_id and s.organization_id=actor.organization_id for update;
  if not found then raise exception 'The incoming SPS order was not found.'; end if;
  if staged.document_type='860' then raise exception 'Purchase Order Change requires review and cannot be promoted as a new order.'; end if;
  if staged.document_type is distinct from '850' then raise exception 'Only an explicit 850 can be promoted.'; end if;
  -- Retry returns the original order before inspecting mutable configuration.
  select o.id into existing_id from public.orders o
   where o.sps_staged_order_id=staged.id and o.organization_id=actor.organization_id;
  if found then return query select existing_id,true,o.status from public.orders o where o.id=existing_id and o.organization_id=actor.organization_id; return; end if;
  if staged.review_status<>'ready' then raise exception 'This order is not ready for production.'; end if;
  select m.* into customer_map from public.integration_customer_mappings m
   where m.id=staged.customer_mapping_id and m.organization_id=actor.organization_id and m.status='active'
     and m.source_system=staged.source_system and m.source_trading_partner_id=staged.trading_partner_id;
  if not found or customer_map.customer_id is null then raise exception 'An active same-organization native customer mapping is required.'; end if;
  select m.* into ship_map from public.integration_ship_to_mappings m
   where m.id=staged.ship_to_mapping_id and m.organization_id=actor.organization_id and m.status='active'
     and m.source_system=staged.source_system and (m.source_trading_partner_id=staged.trading_partner_id or m.source_trading_partner_id is null);
  if not found or ship_map.ship_to_id is null then raise exception 'An active same-organization native ship-to mapping is required.'; end if;
  if exists(select 1 from public.customers c where c.id=customer_map.customer_id and c.organization_id=actor.organization_id and c.status<>'active')
    or exists(select 1 from public.customer_ship_tos st where st.id=ship_map.ship_to_id and st.organization_id=actor.organization_id and st.status<>'active') then
    raise exception 'An incoming mapping points to inactive Lucid master data.';
  end if;
  if customer_map.customer_id is not null and not exists(select 1 from public.customers c where c.id=customer_map.customer_id and c.organization_id=actor.organization_id and c.status='active') then raise exception 'Customer target was not found in your organization.'; end if;
  if ship_map.ship_to_id is not null and not exists(select 1 from public.customer_ship_tos st where st.id=ship_map.ship_to_id and st.organization_id=actor.organization_id and st.status='active' and (customer_map.customer_id is null or st.customer_id=customer_map.customer_id)) then raise exception 'Ship-To target must belong to the selected customer in your organization.'; end if;
  if not exists(select 1 from public.sps_staged_order_lines l where l.staged_order_id=staged.id and l.organization_id=actor.organization_id) then raise exception 'At least one reconciled line is required.'; end if;
  if exists(select 1 from public.sps_staged_order_lines l
    where l.staged_order_id=staged.id and l.organization_id=actor.organization_id and
    (select pg_catalog.count(distinct coalesce(m.item_id::pg_catalog.text,m.food_connex_item_number))
     from public.integration_item_mappings m
     where m.organization_id=actor.organization_id and m.source_system=staged.source_system and m.status='active'
       and ((l.buyer_part_number is not null and m.buyer_part_number=l.buyer_part_number)
         or (l.vendor_item is not null and m.vendor_item=l.vendor_item)
         or (l.gtin is not null and m.gtin=l.gtin))
       and (m.source_trading_partner_id=staged.trading_partner_id
         or (m.source_trading_partner_id is null and not exists(
           select 1 from public.integration_item_mappings scoped
            where scoped.organization_id=actor.organization_id and scoped.source_system=staged.source_system
             and scoped.status='active' and scoped.source_trading_partner_id=staged.trading_partner_id
             and ((l.buyer_part_number is not null and scoped.buyer_part_number=l.buyer_part_number)
               or (l.vendor_item is not null and scoped.vendor_item=l.vendor_item)
               or (l.gtin is not null and scoped.gtin=l.gtin))))))>1) then
    raise exception 'Ambiguous exact item identifiers require review; no first match is used.';
  end if;
  -- Do not trust browser-written match flags: validate current mappings and actual UOMs.
  if exists(select 1 from public.sps_staged_order_lines l
    left join public.integration_item_mappings m on m.id=l.item_mapping_id and m.organization_id=actor.organization_id
    left join public.items i on i.id=m.item_id and i.organization_id=actor.organization_id
    where l.staged_order_id=staged.id and l.organization_id=actor.organization_id
      and (l.item_mapping_status<>'mapped' or l.quantity is null or l.quantity<=0
        or nullif(pg_catalog.btrim(l.sps_uom),'') is null or l.uom_status<>'match'
        or m.id is null or m.item_id is null or m.status<>'active'
        or m.source_system is distinct from staged.source_system
        or (m.source_trading_partner_id is not null and m.source_trading_partner_id is distinct from staged.trading_partner_id)
        or (m.sps_uom is not null and l.sps_uom is distinct from m.sps_uom)
        or not coalesce((l.buyer_part_number is not null and l.buyer_part_number=m.buyer_part_number)
          or (l.vendor_item is not null and l.vendor_item=m.vendor_item)
          or (l.gtin is not null and l.gtin=m.gtin),false)
        or (m.item_id is not null and (i.id is null or i.status<>'active'))
        or l.sps_uom is distinct from coalesce(i.stock_uom,i.sell_uom,m.food_connex_uom)
        or (m.food_connex_uom is not null and l.sps_uom is distinct from m.food_connex_uom))) then
    raise exception 'Every incoming line needs an active exact item, positive quantity, and matching UOM before production.';
  end if;
  if exists(select 1 from public.sps_order_exceptions e where e.staged_order_id=staged.id and e.organization_id=actor.organization_id and e.status='open' and e.severity in ('warning','blocking')) then raise exception 'Open order checks must be resolved before production.'; end if;
  if exists(select 1 from public.sps_staged_order_lines l where l.staged_order_id=staged.id and l.organization_id=actor.organization_id
    and l.sps_purchase_price is not null and l.approved_circle_r_price is not null and l.sps_purchase_price<>l.approved_circle_r_price
    and not exists(select 1 from public.sps_order_exceptions e join public.profiles reviewer on reviewer.id=e.resolved_by and reviewer.organization_id=actor.organization_id
      where e.staged_order_line_id=l.id and e.staged_order_id=staged.id and e.organization_id=actor.organization_id
       and e.exception_code='PRICE_MISMATCH' and e.status='resolved' and reviewer.role in ('leadership','lucid_admin')
       and e.resolution_action in ('use_sps_price','use_approved_circle_r_price'))) then
    raise exception 'A differing price requires a Leadership/Admin final decision.';
  end if;
  if exists(select 1 from public.sps_order_exceptions e where e.staged_order_id=staged.id and e.organization_id=actor.organization_id and e.exception_code='PRICE_MISMATCH' and e.status='resolved'
    group by e.staged_order_line_id having pg_catalog.count(distinct e.resolution_action)>1) then raise exception 'Conflicting final price decisions require review.'; end if;
  insert into public.orders(organization_id,external_po,customer,ship_to,customer_id,ship_to_id,source,requested_ship_date,requested_delivery_date,status,raw_payload,sps_staged_order_id,trading_partner_id,po_date,created_by,promoted_at)
  select actor.organization_id,staged.external_po,coalesce(c.name,customer_map.food_connex_customer_name,staged.source_customer_name),
    coalesce(st.name,ship_map.food_connex_ship_to_name,staged.source_ship_to_name),customer_map.customer_id,ship_map.ship_to_id,'sps',
    staged.requested_ship_date,staged.requested_delivery_date,'ready_for_production',staged.normalized_payload,staged.id,staged.trading_partner_id,staged.po_date,actor.id,pg_catalog.now()
  from (values(1)) singleton(x) left join public.customers c on c.id=customer_map.customer_id and c.organization_id=actor.organization_id
    left join public.customer_ship_tos st on st.id=ship_map.ship_to_id and st.organization_id=actor.organization_id
  returning id into inserted_id;
  insert into public.order_lines(order_id,item_id,external_sku,vendor_item,internal_item_id,description,quantity_cases,unit_price,uom,sps_staged_order_line_id,source_line_number,gtin,sps_source_unit_price,price_resolution_action)
  select inserted_id,m.item_id,l.buyer_part_number,l.vendor_item,coalesce(i.item_code,l.mapped_food_connex_item_id),coalesce(i.description,l.description,'SPS item'),l.quantity,
    case when price.resolution_action='use_sps_price' then l.sps_purchase_price else coalesce(l.approved_circle_r_price,l.sps_purchase_price) end,
    coalesce(i.stock_uom,i.sell_uom,l.sps_uom),l.id,l.line_number,l.gtin,l.sps_purchase_price,price.resolution_action
  from public.sps_staged_order_lines l join public.integration_item_mappings m on m.id=l.item_mapping_id and m.organization_id=actor.organization_id
    left join public.items i on i.id=m.item_id and i.organization_id=actor.organization_id
    left join lateral(select e.resolution_action from public.sps_order_exceptions e
      where e.staged_order_id=staged.id and e.staged_order_line_id=l.id and e.organization_id=actor.organization_id
       and e.exception_code='PRICE_MISMATCH' and e.status='resolved' and e.resolution_action in ('use_sps_price','use_approved_circle_r_price')
      order by e.resolved_at desc,e.id limit 1) price on true
  where l.staged_order_id=staged.id and l.organization_id=actor.organization_id;
  update public.sps_staged_orders s set review_status='promoted',promoted_order_id=inserted_id,approved_by=actor.id,approved_at=pg_catalog.now()
    where s.id=staged.id and s.organization_id=actor.organization_id;
  insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,details)
  values(actor.organization_id,actor.id,'promoted SPS order to Lucid operational order','order',inserted_id::pg_catalog.text,
    pg_catalog.jsonb_build_object('staged_sps_order_id',staged.id,'operational_order_id',inserted_id,'business_po_number',coalesce(staged.business_po_number,staged.external_po),'document_type',staged.document_type,'sps_id',staged.sps_id));
  return query select inserted_id,false,'ready_for_production'::pg_catalog.text;
end;
$fn$;

create or replace function public.start_lucid_production(p_order_id pg_catalog.uuid)
returns table(order_id pg_catalog.uuid, operational_status pg_catalog.text, already_started pg_catalog.bool) language plpgsql security definer set search_path = '' as $fn$
declare actor public.profiles%rowtype; target public.orders%rowtype;
begin
  select p.* into actor from public.profiles p join public.organizations o on o.id=p.organization_id where p.id=public.lucid_request_actor_id() and p.active and o.active;
  if not found then raise exception 'An active Lucid Core profile and organization are required.'; end if;
  if actor.role not in ('production','office','leadership','lucid_admin') then raise exception 'Your role cannot manage production orders.'; end if;
  select o.* into target from public.orders o where o.id=p_order_id and o.organization_id=actor.organization_id for update;
  if not found then raise exception 'The production order was not found.'; end if;
  if target.status='in_production' then return query select target.id,target.status,true; return; end if;
  if target.status<>'ready_for_production' then raise exception 'This order is not ready to start production.'; end if;
  update public.orders o set status='in_production' where o.id=target.id and o.organization_id=actor.organization_id;
  insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,details)
  values(actor.organization_id,actor.id,'production started','order',target.id::pg_catalog.text,pg_catalog.jsonb_build_object('po_number',target.external_po));
  return query select target.id,'in_production'::pg_catalog.text,false;
end;
$fn$;

create or replace function public.complete_lucid_production(p_order_id pg_catalog.uuid)
returns table(order_id pg_catalog.uuid, operational_status pg_catalog.text) language plpgsql security definer set search_path = '' as $fn$
declare actor public.profiles%rowtype; target public.orders%rowtype;
begin
  select p.* into actor from public.profiles p join public.organizations o on o.id=p.organization_id where p.id=public.lucid_request_actor_id() and p.active and o.active;
  if not found then raise exception 'An active Lucid Core profile and organization are required.'; end if;
  if actor.role not in ('production','office','leadership','lucid_admin') then raise exception 'Your role cannot manage production orders.'; end if;
  select o.* into target from public.orders o where o.id=p_order_id and o.organization_id=actor.organization_id for update;
  if not found then raise exception 'The production order was not found.'; end if;
  if target.status='production_complete' then return query select target.id,target.status; return; end if;
  if target.status<>'in_production' then raise exception 'Start production before completing this order.'; end if;
  if exists(select 1 from public.order_lines l where l.order_id=target.id
    and coalesce((select pg_catalog.sum(pc.quantity) from public.production_cases pc where pc.order_line_id=l.id and pc.organization_id=actor.organization_id and pc.status<>'voided'),0)<l.quantity_cases) then
    raise exception 'All ordered quantities must be produced before completion.';
  end if;
  update public.orders o set status='production_complete' where o.id=target.id and o.organization_id=actor.organization_id;
  insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,details)
  values(actor.organization_id,actor.id,'production completed','order',target.id::pg_catalog.text,pg_catalog.jsonb_build_object('po_number',target.external_po));
  return query select target.id,'production_complete'::pg_catalog.text;
end;
$fn$;

create or replace function public.create_lucid_qa_order(
 p_qa_reference pg_catalog.text,p_customer pg_catalog.text,p_ship_to pg_catalog.text,
 p_item_code pg_catalog.text,p_description pg_catalog.text,p_quantity_cases pg_catalog.numeric,p_uom pg_catalog.text default 'CS')
returns table(order_id pg_catalog.uuid,order_line_id pg_catalog.uuid)
language plpgsql security definer set search_path = '' as $fn$
declare actor public.profiles%rowtype; oid pg_catalog.uuid; lid pg_catalog.uuid; ref pg_catalog.text;
begin
 select p.* into actor from public.profiles p join public.organizations o on o.id=p.organization_id where p.id=public.lucid_request_actor_id() and p.active and o.active;
 if not found then raise exception 'An active Lucid Core profile and organization are required.'; end if;
 if actor.role<>'lucid_admin' then raise exception using errcode='42501',message='Only Lucid Admin can create a controlled QA order.'; end if;
 ref:=nullif(pg_catalog.btrim(p_qa_reference),'');
 if ref is null or pg_catalog.upper(ref) not like 'QA-%' then raise exception 'QA references must begin with QA-.'; end if;
 if nullif(pg_catalog.btrim(p_customer),'') is null or nullif(pg_catalog.btrim(p_item_code),'') is null or nullif(pg_catalog.btrim(p_description),'') is null or p_quantity_cases is null or p_quantity_cases<=0 then
   raise exception 'QA customer, item, description, and positive quantity are required.';
 end if;
 insert into public.orders(organization_id,external_po,customer,ship_to,source,status,source_system,source_record_id,created_by)
 values(actor.organization_id,ref,pg_catalog.btrim(p_customer),nullif(pg_catalog.btrim(p_ship_to),''),'qa','ready_for_production','lucid_qa',ref,actor.id) returning id into oid;
 insert into public.order_lines(order_id,external_sku,internal_item_id,description,quantity_cases,uom,source_system,source_record_id)
 values(oid,pg_catalog.btrim(p_item_code),pg_catalog.btrim(p_item_code),pg_catalog.btrim(p_description),p_quantity_cases,coalesce(nullif(pg_catalog.btrim(p_uom),''),'CS'),'lucid_qa',ref) returning id into lid;
 insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,details)
 values(actor.organization_id,actor.id,'created controlled QA order','order',oid::pg_catalog.text,pg_catalog.jsonb_build_object('qa_reference',ref,'order_line_id',lid));
 return query select oid,lid;
end;
$fn$;

alter function public.promote_sps_staged_order(pg_catalog.uuid) owner to lucid_sps_promoter;
alter function public.create_lucid_qa_order(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.numeric,pg_catalog.text) owner to lucid_sps_promoter;
alter function public.start_lucid_production(pg_catalog.uuid) owner to lucid_order_operator;
alter function public.complete_lucid_production(pg_catalog.uuid) owner to lucid_order_operator;
revoke all on function public.promote_sps_staged_order(pg_catalog.uuid),
 public.create_lucid_qa_order(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.numeric,pg_catalog.text),
 public.start_lucid_production(pg_catalog.uuid),public.complete_lucid_production(pg_catalog.uuid)
 from public, anon, service_role;
grant execute on function public.promote_sps_staged_order(pg_catalog.uuid),
 public.create_lucid_qa_order(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.numeric,pg_catalog.text),
 public.start_lucid_production(pg_catalog.uuid),public.complete_lucid_production(pg_catalog.uuid)
 to authenticated;
revoke all on function public.protect_lucid_sps_price_authority(),public.protect_lucid_sps_promotion_metadata(),public.protect_lucid_promoted_sps_source()
 from public,anon,authenticated,service_role;

-- No temporary membership or CREATE grant survives the transaction.
revoke create on schema public from lucid_sps_promoter,lucid_order_operator;
revoke lucid_sps_promoter,lucid_order_operator from postgres granted by postgres;
do $bootstrap_cleanup$
begin
 if pg_catalog.has_schema_privilege('lucid_sps_promoter','auth','USAGE')
   or pg_catalog.has_schema_privilege('lucid_order_operator','auth','USAGE') then
   raise exception '031 private owners must not have auth schema USAGE.';
 end if;
 if not pg_catalog.has_function_privilege('lucid_sps_promoter','public.lucid_request_actor_id()','EXECUTE')
   or not pg_catalog.has_function_privilege('lucid_order_operator','public.lucid_request_actor_id()','EXECUTE') then
   raise exception '031 private-role actor helper EXECUTE was not established.';
 end if;
 if pg_catalog.has_schema_privilege('lucid_sps_promoter','public','CREATE')
   or pg_catalog.has_schema_privilege('lucid_order_operator','public','CREATE') then
   raise exception '031 private-role CREATE privilege remains.';
 end if;
 -- PostgreSQL 16+ creates a mandatory bootstrap-superuser ADMIN-only grant
 -- to the non-superuser role creator. postgres cannot revoke that grant.
 -- Permit only that exact platform row, never an application or self grant.
 if exists(select 1 from pg_catalog.pg_auth_members m
   join pg_catalog.pg_roles r on r.oid=m.roleid or r.oid=m.member
   where r.rolname in ('lucid_sps_promoter','lucid_order_operator')
   and not coalesce((m.roleid=r.oid
     and m.member=(select oid from pg_catalog.pg_roles where rolname='postgres')
     and m.grantor=(select oid from pg_catalog.pg_roles where oid=10 and rolname='supabase_admin' and rolsuper)
     and m.admin_option and not m.inherit_option and not m.set_option),false)) then
   raise exception '031 unexpected private role membership remains; rollback required.';
 end if;
 if exists(select 1 from pg_catalog.pg_roles r
   where r.rolname in ('lucid_sps_promoter','lucid_order_operator')
    and (pg_catalog.pg_has_role('postgres',r.oid,'SET') or pg_catalog.pg_has_role('postgres',r.oid,'USAGE'))) then
   raise exception '031 temporary bootstrap execution access remains; rollback required.';
 end if;
end;
$bootstrap_cleanup$;
commit;

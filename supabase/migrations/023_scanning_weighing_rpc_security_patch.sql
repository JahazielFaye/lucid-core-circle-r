-- Security-only hardening for already-applied migration 022 scanning/weighing RPCs.
-- No operational rows, tables, policies, or business rules are changed.
begin;

-- These functions derive actor, organization, provenance, and role from auth.uid()
-- internally. SECURITY DEFINER is required so their bounded multi-row workflows can
-- write immutable readings/events while direct table mutations remain unavailable.
alter function public.create_lucid_manual_weight_reading(uuid, numeric, text)
  security definer
  set search_path to public;

alter function public.create_lucid_production_case_from_weight_reading(uuid, uuid, text, numeric, numeric, uuid, text, uuid)
  security definer
  set search_path to public;

alter function public.record_lucid_case_weight_correction(uuid, numeric, text)
  security definer
  set search_path to public;

-- PostgreSQL grants EXECUTE to PUBLIC by default. Revoke both PUBLIC and anon
-- explicitly, then allow only authenticated callers; each RPC still checks roles.
revoke all on function public.create_lucid_manual_weight_reading(uuid, numeric, text) from public;
revoke all on function public.create_lucid_manual_weight_reading(uuid, numeric, text) from anon;
grant execute on function public.create_lucid_manual_weight_reading(uuid, numeric, text) to authenticated;

revoke all on function public.create_lucid_production_case_from_weight_reading(uuid, uuid, text, numeric, numeric, uuid, text, uuid) from public;
revoke all on function public.create_lucid_production_case_from_weight_reading(uuid, uuid, text, numeric, numeric, uuid, text, uuid) from anon;
grant execute on function public.create_lucid_production_case_from_weight_reading(uuid, uuid, text, numeric, numeric, uuid, text, uuid) to authenticated;

revoke all on function public.record_lucid_case_weight_correction(uuid, numeric, text) from public;
revoke all on function public.record_lucid_case_weight_correction(uuid, numeric, text) from anon;
grant execute on function public.record_lucid_case_weight_correction(uuid, numeric, text) to authenticated;

commit;

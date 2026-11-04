-- Migration 025 created the helper as an internal SECURITY DEFINER boundary.
-- Remove an inherited/direct authenticated execute grant without changing any
-- function definition, RLS policy, or public administration RPC grant.
begin;

revoke all on function public.require_lucid_admin_actor() from public;
revoke all on function public.require_lucid_admin_actor() from anon;
revoke all on function public.require_lucid_admin_actor() from authenticated;

commit;

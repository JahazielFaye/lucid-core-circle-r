-- Revoke default PUBLIC execution left on the legacy pallet-remove overload.
begin;

revoke execute on function public.create_lucid_pallet(uuid) from public, anon;
grant execute on function public.create_lucid_pallet(uuid) to authenticated;

revoke execute on function public.add_lucid_case_to_pallet(uuid, text) from public, anon;
grant execute on function public.add_lucid_case_to_pallet(uuid, text) to authenticated;

revoke execute on function public.remove_lucid_case_from_pallet(uuid, uuid) from public, anon;
grant execute on function public.remove_lucid_case_from_pallet(uuid, uuid) to authenticated;

revoke execute on function public.remove_lucid_case_from_pallet(uuid, uuid, text) from public, anon;
grant execute on function public.remove_lucid_case_from_pallet(uuid, uuid, text) to authenticated;

revoke execute on function public.move_lucid_case_between_pallets(uuid, uuid, text) from public, anon;
grant execute on function public.move_lucid_case_between_pallets(uuid, uuid, text) to authenticated;

revoke execute on function public.complete_lucid_pallet(uuid) from public, anon;
grant execute on function public.complete_lucid_pallet(uuid) to authenticated;

revoke execute on function public.reopen_lucid_pallet(uuid, text) from public, anon;
grant execute on function public.reopen_lucid_pallet(uuid, text) to authenticated;

commit;

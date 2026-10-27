-- Correct the already-applied Milestone 3 label-print RPC.
begin;

create or replace function record_lucid_case_label_print(p_production_case_id uuid)
returns table (production_case_id uuid, label_print_count integer, reprint boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_profile profiles%rowtype;
  target_production_case production_cases%rowtype;
  next_print_count integer;
begin
  select * into current_profile from profiles where id = auth.uid() and active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot print case labels.';
  end if;

  select * into target_production_case from production_cases
    where id = p_production_case_id and organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The production case was not found.'; end if;
  if target_production_case.status = 'voided' then
    raise exception 'Voided production cases cannot be printed.';
  end if;

  update production_cases as case_row
    set label_printed_at = now(),
      label_printed_by = current_profile.id,
      label_print_count = case_row.label_print_count + 1
    where case_row.id = target_production_case.id
      and case_row.organization_id = current_profile.organization_id
    returning case_row.label_print_count into next_print_count;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id,
      case when next_print_count = 1 then 'case label printed' else 'case label reprinted' end,
      'production_case', target_production_case.id::text,
      jsonb_build_object('order_id', target_production_case.order_id,
        'case_identifier', target_production_case.case_identifier,
        'print_count', next_print_count));

  return query select target_production_case.id, next_print_count, next_print_count > 1;
end;
$$;

grant execute on function record_lucid_case_label_print(uuid) to authenticated;

commit;

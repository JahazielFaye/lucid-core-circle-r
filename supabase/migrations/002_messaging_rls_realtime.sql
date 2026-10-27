-- Shared messaging:
-- membership-scoped access, safe thread creation, and Realtime.

alter table public.conversations
add column if not exists direct_key text;

create unique index if not exists conversations_direct_key_unique
  on public.conversations (direct_key)
  where kind = 'direct';

create unique index if not exists conversations_team_unique
  on public.conversations (organization_id, kind, name)
  where kind = 'group' and name = 'Circle R Team';


-- =========================================================
-- SECURITY HELPER
-- Avoids recursive RLS on conversation_members
-- =========================================================

create or replace function public.is_conversation_member(
  target_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = target_conversation_id
      and cm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;


-- =========================================================
-- REPLACE OLD POLICIES
-- =========================================================

drop policy if exists "conversations same org"
  on public.conversations;

drop policy if exists "conversation members permitted"
  on public.conversation_members;

drop policy if exists "messages conversation members"
  on public.messages;

drop policy if exists "message reads conversation members"
  on public.message_reads;

drop policy if exists "conversation members can view conversations"
  on public.conversations;

drop policy if exists "conversation members can view memberships"
  on public.conversation_members;

drop policy if exists "conversation members can view messages"
  on public.messages;

drop policy if exists "members can send messages"
  on public.messages;

drop policy if exists "conversation members can view message reads"
  on public.message_reads;

drop policy if exists "users can add their own message reads"
  on public.message_reads;

drop policy if exists "users can update their own message reads"
  on public.message_reads;


-- =========================================================
-- CONVERSATIONS
-- =========================================================

create policy "conversation members can view conversations"
  on public.conversations
  for select
  using (
    public.is_conversation_member(id)
  );


-- =========================================================
-- CONVERSATION MEMBERS
-- =========================================================

create policy "conversation members can view memberships"
  on public.conversation_members
  for select
  using (
    public.is_conversation_member(conversation_id)
  );


-- =========================================================
-- MESSAGES
-- =========================================================

create policy "conversation members can view messages"
  on public.messages
  for select
  using (
    public.is_conversation_member(conversation_id)
  );

create policy "members can send messages"
  on public.messages
  for insert
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );


-- =========================================================
-- MESSAGE READ RECEIPTS
-- =========================================================

create policy "conversation members can view message reads"
  on public.message_reads
  for select
  using (
    exists (
      select 1
      from public.messages m
      where m.id = message_reads.message_id
        and public.is_conversation_member(m.conversation_id)
    )
  );

create policy "users can add their own message reads"
  on public.message_reads
  for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.messages m
      where m.id = message_reads.message_id
        and public.is_conversation_member(m.conversation_id)
    )
  );

create policy "users can update their own message reads"
  on public.message_reads
  for update
  using (
    user_id = auth.uid()
  )
  with check (
    user_id = auth.uid()
  );


-- =========================================================
-- DIRECT CONVERSATION RPC
-- =========================================================

create or replace function public.get_or_create_direct_conversation(
  target_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_org_id uuid;
  conversation_id uuid;
  thread_key text;
begin
  select organization_id
  into actor_org_id
  from public.profiles
  where id = actor_id
    and active = true;

  if actor_org_id is null or target_user_id = actor_id then
    raise exception 'Invalid conversation participant';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = target_user_id
      and organization_id = actor_org_id
      and active = true
  ) then
    raise exception 'Invalid conversation participant';
  end if;

  thread_key :=
    least(actor_id::text, target_user_id::text)
    || ':' ||
    greatest(actor_id::text, target_user_id::text);

  insert into public.conversations (
    organization_id,
    kind,
    name,
    created_by,
    direct_key
  )
  values (
    actor_org_id,
    'direct',
    '',
    actor_id,
    thread_key
  )
  on conflict (direct_key)
    where kind = 'direct'
  do update
    set updated_at = public.conversations.updated_at
  returning id into conversation_id;

  insert into public.conversation_members (
    conversation_id,
    user_id
  )
  values
    (conversation_id, actor_id),
    (conversation_id, target_user_id)
  on conflict do nothing;

  return conversation_id;
end;
$$;


-- =========================================================
-- CIRCLE R TEAM GROUP RPC
-- =========================================================

create or replace function public.ensure_circle_r_team_conversation()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_org_id uuid;
  conversation_id uuid;
begin
  select organization_id
  into actor_org_id
  from public.profiles
  where id = actor_id
    and active = true;

  if actor_org_id is null then
    raise exception 'Inactive account';
  end if;

  insert into public.conversations (
    organization_id,
    kind,
    name,
    created_by
  )
  values (
    actor_org_id,
    'group',
    'Circle R Team',
    actor_id
  )
  on conflict (organization_id, kind, name)
    where kind = 'group'
      and name = 'Circle R Team'
  do update
    set updated_at = public.conversations.updated_at
  returning id into conversation_id;

  insert into public.conversation_members (
    conversation_id,
    user_id
  )
  select
    conversation_id,
    id
  from public.profiles
  where organization_id = actor_org_id
    and active = true
  on conflict do nothing;

  return conversation_id;
end;
$$;


-- =========================================================
-- KEEP THREAD ORDER CURRENT
-- =========================================================

create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set updated_at = new.created_at
  where id = new.conversation_id;

  return new;
end;
$$;

drop trigger if exists messages_touch_conversation
  on public.messages;

create trigger messages_touch_conversation
  after insert on public.messages
  for each row
  execute function public.touch_conversation_on_message();


-- =========================================================
-- RPC PERMISSIONS
-- =========================================================

revoke all
  on function public.get_or_create_direct_conversation(uuid)
  from public;

revoke all
  on function public.ensure_circle_r_team_conversation()
  from public;

grant execute
  on function public.get_or_create_direct_conversation(uuid)
  to authenticated;

grant execute
  on function public.ensure_circle_r_team_conversation()
  to authenticated;


-- =========================================================
-- REALTIME
-- =========================================================

do $$
begin
  alter publication supabase_realtime
    add table public.messages;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime
    add table public.message_reads;
exception
  when duplicate_object then null;
end $$;
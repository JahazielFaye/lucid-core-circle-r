import type { SupabaseClient } from '@supabase/supabase-js';

export type SharedConversation = {
  id: string;
  kind: 'direct' | 'group';
  name: string;
  participantIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type SharedMessage = {
  id: string;
  threadId: string;
  fromUserId: string;
  body: string;
  createdAt: string;
  readBy: string[];
  forwardedFromId?: string;
};

export type SharedMessagingUser = { id: string; name: string; active: boolean };

export type SharedMessagingSnapshot = {
  conversations: SharedConversation[];
  messages: SharedMessage[];
  users: SharedMessagingUser[];
};

type ConversationRow = { id: string; kind: 'direct' | 'group'; name: string; created_at: string; updated_at: string };
type MembershipRow = { conversation_id: string; user_id: string };
type MessageRow = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string; forwarded_from_id: string | null };
type ReadRow = { message_id: string; user_id: string };
type ProfileRow = { id: string; display_name: string; active: boolean };

export async function ensureTeamConversation(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc('ensure_circle_r_team_conversation');
  if (error || !data) throw error || new Error('Unable to load the team conversation.');
  return data as string;
}

export async function loadSharedMessaging(supabase: SupabaseClient, organizationId: string): Promise<SharedMessagingSnapshot> {
  await ensureTeamConversation(supabase);
  const { data: memberships, error: membershipError } = await supabase
    .from('conversation_members')
    .select('conversation_id, user_id');
  if (membershipError) throw membershipError;

  const membershipRows = (memberships || []) as MembershipRow[];
  const conversationIds = [...new Set(membershipRows.map(member => member.conversation_id))];
  if (!conversationIds.length) return { conversations: [], messages: [], users: [] };

  const [{ data: conversations, error: conversationError }, { data: profiles, error: profileError }] = await Promise.all([
    supabase.from('conversations').select('id, kind, name, created_at, updated_at').in('id', conversationIds),
    supabase.from('profiles').select('id, display_name, active').eq('organization_id', organizationId).eq('active', true),
  ]);
  if (conversationError) throw conversationError;
  if (profileError) throw profileError;

  const conversationRows = (conversations || []) as ConversationRow[];
  const { data: messages, error: messageError } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, created_at, forwarded_from_id')
    .in('conversation_id', conversationRows.map(conversation => conversation.id))
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (messageError) throw messageError;

  const messageRows = (messages || []) as MessageRow[];
  const messageIds = messageRows.map(message => message.id);
  const { data: reads, error: readError } = messageIds.length
    ? await supabase.from('message_reads').select('message_id, user_id').in('message_id', messageIds)
    : { data: [], error: null };
  if (readError) throw readError;

  const readByMessage = new Map<string, string[]>();
  for (const read of (reads || []) as ReadRow[]) {
    readByMessage.set(read.message_id, [...(readByMessage.get(read.message_id) || []), read.user_id]);
  }
  const membersByConversation = new Map<string, string[]>();
  for (const member of membershipRows) {
    membersByConversation.set(member.conversation_id, [...(membersByConversation.get(member.conversation_id) || []), member.user_id]);
  }

  return {
    conversations: conversationRows.map(conversation => ({
      id: conversation.id,
      kind: conversation.kind,
      name: conversation.name,
      participantIds: membersByConversation.get(conversation.id) || [],
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
    })),
    messages: messageRows.map(message => ({
      id: message.id,
      threadId: message.conversation_id,
      fromUserId: message.sender_id,
      body: message.body,
      createdAt: message.created_at,
      readBy: readByMessage.get(message.id) || [],
      forwardedFromId: message.forwarded_from_id || undefined,
    })),
    users: ((profiles || []) as ProfileRow[]).map(profile => ({ id: profile.id, name: profile.display_name, active: profile.active })),
  };
}

export async function createDirectConversation(supabase: SupabaseClient, targetUserId: string) {
  const { data, error } = await supabase.rpc('get_or_create_direct_conversation', { target_user_id: targetUserId });
  if (error || !data) throw error || new Error('Unable to start a conversation.');
  return data as string;
}

export async function sendSharedMessage(supabase: SupabaseClient, conversationId: string, senderId: string, body: string, forwardedFromId?: string) {
  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: senderId,
    body,
    forwarded_from_id: forwardedFromId || null,
  });
  if (error) throw error;
}

export async function markSharedMessagesRead(supabase: SupabaseClient, messages: SharedMessage[], userId: string) {
  const unread = messages.filter(message => message.fromUserId !== userId && !message.readBy.includes(userId));
  if (!unread.length) return;
  const { error } = await supabase.from('message_reads').upsert(
    unread.map(message => ({ message_id: message.id, user_id: userId })),
    { onConflict: 'message_id,user_id' },
  );
  if (error) throw error;
}

import type { SupabaseClient } from '@supabase/supabase-js';

export type WorkspaceProfile = {
  id: string;
  organization_id: string;
  display_name: string;
  role: 'lucid_admin' | 'leadership' | 'office' | 'production';
  active: boolean;
};
export type BootstrapResult = { profile: WorkspaceProfile | null; error: string };
const sessionError = "We couldn't restore your session. Please sign in again.";
const profileError = 'Your Lucid Core account is not active. Contact an administrator.';
const roles = ['lucid_admin', 'leadership', 'office', 'production'];

export async function withAuthTimeout<T>(request: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(request),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Session check took too long. Please try signing in again.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function verifiedProfile(client: SupabaseClient, expectedUserId: string): Promise<BootstrapResult> {
  // Storage alone is not sufficient: verify the authenticated subject before its profile.
  const user = await client.auth.getUser();
  if (user.error || !user.data.user || user.data.user.id !== expectedUserId) return { profile: null, error: sessionError };
  const { data, error } = await client.from('profiles')
    .select('id, organization_id, display_name, role, active').eq('id', user.data.user.id).maybeSingle();
  if (error) return { profile: null, error: 'Unable to load your workspace. Please try signing in again.' };
  // The existing RLS also requires an active organization; no client-supplied org is used.
  if (!data || data.id !== expectedUserId || !data.active || !roles.includes(data.role) || !data.organization_id) {
    return { profile: null, error: profileError };
  }
  return { profile: data as WorkspaceProfile, error: '' };
}

async function boundedBootstrap(request: () => Promise<BootstrapResult>, timeoutMs: number): Promise<BootstrapResult> {
  try {
    return await withAuthTimeout(request, timeoutMs);
  } catch {
    return { profile: null, error: 'Unable to check your session. Please try signing in again.' };
  }
}

export function resolveWorkspaceProfile(client: SupabaseClient, userId: string, timeoutMs = 10_000): Promise<BootstrapResult> {
  return boundedBootstrap(() => verifiedProfile(client, userId), timeoutMs);
}

export function restoreWorkspaceSession(client: SupabaseClient, timeoutMs = 10_000): Promise<BootstrapResult> {
  return boundedBootstrap(async () => {
    const session = await client.auth.getSession();
    if (session.error) return { profile: null, error: sessionError };
    if (!session.data.session) return { profile: null, error: '' };
    return verifiedProfile(client, session.data.session.user.id);
  }, timeoutMs);
}

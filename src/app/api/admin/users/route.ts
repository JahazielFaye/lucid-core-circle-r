import { NextResponse } from 'next/server';

import { createSupabaseAdminClient, isSupabaseAdminConfigured } from '@/lib/supabase/admin';
import { classifyInvitationFailure } from '@/lib/security/invitation-diagnostics';
import { requireActiveLucidRouteUser, RouteAuthorizationError } from '@/lib/security/route-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const roles = ['lucid_admin', 'leadership', 'office', 'production'] as const;
type ManagedRole = typeof roles[number];
const safeMessage = (error: unknown) => error instanceof Error ? error.message : 'Unable to manage users.';

export async function GET() {
  try {
    const { supabase, organizationId } = await requireActiveLucidRouteUser(['lucid_admin']);
    const { data: profiles, error } = await supabase.from('profiles')
      .select('id,display_name,role,active,created_at,updated_at').eq('organization_id', organizationId).order('display_name');
    if (error) throw new Error(error.message);
    const emailById = new Map<string, string>();
    if (isSupabaseAdminConfigured()) {
      const admin = createSupabaseAdminClient();
      const { data, error: userError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (!userError) for (const user of data.users) emailById.set(user.id, user.email || '');
    }
    return NextResponse.json({ success: true, invitationConfigured: isSupabaseAdminConfigured(), users: (profiles || []).map(profile => ({ ...profile, email: emailById.get(profile.id) || null })) });
  } catch (error) {
    const status = error instanceof RouteAuthorizationError ? error.status : 400;
    return NextResponse.json({ success: false, error: safeMessage(error) }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, organizationId, userId } = await requireActiveLucidRouteUser(['lucid_admin']);
    const body = await request.json() as { email?: unknown; displayName?: unknown; role?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    const role = typeof body.role === 'string' ? body.role : '';
    if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ success: false, error: 'Enter a valid email address.' }, { status: 400 });
    if (!displayName || !roles.includes(role as ManagedRole)) return NextResponse.json({ success: false, error: 'A display name and supported role are required.' }, { status: 400 });
    const admin = createSupabaseAdminClient();
    const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { data: { display_name: displayName } });
    if (inviteError || !invite.user) {
      const failure = classifyInvitationFailure(inviteError, Boolean(invite.user));
      console.warn('[user-invitation] auth invite rejected', {
        actorId: userId,
        organizationId,
        category: failure.kind,
        authCode: failure.code,
        authStatus: failure.status,
        receivedUser: failure.receivedUser,
      });
      return NextResponse.json({ success: false, error: failure.publicMessage }, { status: failure.responseStatus });
    }
    const { data: profile, error: profileError } = await supabase.rpc('admin_create_lucid_profile', { p_user_id: invite.user.id, p_display_name: displayName, p_role: role });
    if (profileError) {
      // Do not leave a usable Auth invite without a Lucid profile. If cleanup
      // itself fails, avoid falsely claiming that no access exists and keep the
      // recovery path limited to a Lucid Admin.
      const { error: cleanupError } = await admin.auth.admin.deleteUser(invite.user.id);
      if (cleanupError) {
        console.error('[user-invitation] profile finalization and invite cleanup failed', { userId: invite.user.id, code: cleanupError.code ?? null });
        return NextResponse.json({ success: false, error: 'The invitation could not be finalized. A Lucid Admin must review the pending invitation before retrying.' }, { status: 400 });
      }
      return NextResponse.json({ success: false, error: 'The invitation could not be finalized and was cancelled. No Lucid access was created.' }, { status: 400 });
    }
    return NextResponse.json({ success: true, user: Array.isArray(profile) ? profile[0] : profile, organizationId });
  } catch (error) {
    const status = error instanceof RouteAuthorizationError ? error.status : 400;
    return NextResponse.json({ success: false, error: safeMessage(error) }, { status });
  }
}

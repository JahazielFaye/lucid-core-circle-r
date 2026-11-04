import { NextResponse } from 'next/server';

import { requireActiveLucidRouteUser, RouteAuthorizationError } from '@/lib/security/route-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const roles = ['lucid_admin', 'leadership', 'office', 'production'];

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireActiveLucidRouteUser(['lucid_admin']);
    const { id } = await context.params;
    const body = await request.json() as { role?: unknown; active?: unknown };
    if (!id || (typeof body.role !== 'string' && typeof body.active !== 'boolean')) return NextResponse.json({ success: false, error: 'A supported profile change is required.' }, { status: 400 });
    if (typeof body.role === 'string' && !roles.includes(body.role)) return NextResponse.json({ success: false, error: 'That role is not supported.' }, { status: 400 });
    if (typeof body.role === 'string' && typeof body.active === 'boolean') return NextResponse.json({ success: false, error: 'Change the role or active state in separate actions.' }, { status: 400 });
    const rpc = typeof body.role === 'string'
      ? supabase.rpc('admin_change_lucid_profile_role', { p_target_profile_id: id, p_role: body.role })
      : supabase.rpc('admin_set_lucid_profile_active', { p_target_profile_id: id, p_active: body.active });
    const { data, error } = await rpc;
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, user: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    const status = error instanceof RouteAuthorizationError ? error.status : 400;
    const message = error instanceof Error ? error.message : 'Unable to update the user.';
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

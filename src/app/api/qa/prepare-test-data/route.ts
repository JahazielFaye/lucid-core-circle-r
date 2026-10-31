import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('An authenticated Lucid Core session is required.');
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('active, role')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError || !profile?.active || profile.role !== 'lucid_admin') {
      return NextResponse.json({ success: false, error: 'Only Lucid Admin can prepare controlled QA test data.' }, { status: 403 });
    }
    const { data, error } = await supabase.rpc('prepare_lucid_qa_master_data');
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, data: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to prepare controlled QA test data.' }, { status: 400 });
  }
}

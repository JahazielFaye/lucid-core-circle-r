'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

const minimumPasswordLength = 8;

export default function UpdatePasswordPage() {
  const supabase = useMemo(() => createClient(), []);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sessionReady, setSessionReady] = useState<boolean | null>(null);
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function checkRecoverySession() {
      const { data } = await supabase.auth.getSession();
      if (mounted) setSessionReady(Boolean(data.session));
    }

    void checkRecoverySession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && mounted) setSessionReady(Boolean(session));
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < minimumPasswordLength) {
      setStatus(`Use at least ${minimumPasswordLength} characters for your password.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus('Your passwords do not match.');
      return;
    }

    setPending(true);
    setStatus('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setStatus('Unable to update your password. Please request a new reset link and try again.');
      setPending(false);
      return;
    }

    setStatus('Password updated. Redirecting you to sign in…');
    await supabase.auth.signOut();
    window.setTimeout(() => window.location.assign('/'), 1000);
  }

  return <main className="login-shell">
    <section className="login-card">
      <div className="login-brand"><span>LC</span><div><strong>Lucid Core</strong><small>Circle R Beef</small></div></div>
      <span className="kicker">Secure password update</span>
      <h1>Set a new password.</h1>
      <p>Choose a new password for your Lucid Core account.</p>
      {sessionReady === null ? <p>Verifying your reset link…</p> : sessionReady ? <form onSubmit={updatePassword}>
        <label className="login-field"><span>New password</span><input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={minimumPasswordLength} required /></label>
        <label className="login-field"><span>Confirm password</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={minimumPasswordLength} required /></label>
        {status && <div className="prototype-note" role="status">{status}</div>}
        <button className="primary login-button" type="submit" disabled={pending}>{pending ? 'Updating…' : 'Update password'}</button>
      </form> : <div className="prototype-note" role="alert">This password reset link is invalid or has expired. Return to sign in and request a new one.</div>}
    </section>
  </main>;
}

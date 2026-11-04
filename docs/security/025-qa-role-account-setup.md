# QA role and organization setup

Migration 025 does not create users or organizations. This preserves production tenant boundaries.

1. Add `SUPABASE_SERVICE_ROLE_KEY` only to server-side local and Vercel environment settings. Never use a `NEXT_PUBLIC_` name and never place a real value in source control.
2. Sign in as the existing Lucid Admin and open **Admin / Users**.
3. Invite one controlled QA account for each primary-organization role: Leadership, Office, and Production. Use clearly labelled QA email addresses owned by the test team. The inviting Admin may also be the primary QA Admin.
4. Each invited person sets their own password using the Supabase invitation email. Lucid never displays or stores a password or invitation link.
5. Verify each account sees only its permitted navigation and actions. Deactivate/reactivate a QA account only through **Admin / Users** to test inactive-user denial.

## Second QA organization

This is deliberately a higher-trust manual setup, not an organization-admin UI action:

1. In an approved Supabase setup session, create an organization with a clear QA-only name and a unique QA slug.
2. Use the Supabase Auth dashboard to invite a QA-only email address.
3. Insert exactly one active profile for that Auth user using the new organization ID and one supported role. Record the setup actor through `audit_events` using the normal operational audit format.
4. Do not add the second organization or its profile through a normal Lucid organization Admin account.
5. Validate Org A cannot list, update, deactivate, or access Org B data using separate browser sessions.

An organization cannot be disabled while it has active profiles. A controlled
organization shutdown must first deactivate every profile through the approved
administration process, then disable the organization from the higher-trust
setup path. Reactivation is likewise a controlled setup action; it does not
silently reactivate people.

If an invitation succeeds but profile finalization fails, the route attempts to remove the newly invited Auth user and returns no invitation token. If cleanup itself fails, stop and reconcile that identity in the Supabase Auth dashboard before retrying; do not create another profile manually.

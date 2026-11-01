// Test-only replacement for the authenticated Supabase context. No credentials/network.
import assert from 'node:assert/strict';
import { org, customer } from './customer-import-planner.fixtures.mjs';
export const stats = { contexts: 0, reads: 0, writes: 0 };
let rows = [customer()]; let failure = false; let actorRole='lucid_admin';
export function resetContext(next = [customer()], fail = false, role = 'lucid_admin') { rows = next; failure = fail; actorRole=role; stats.contexts = stats.reads = stats.writes = 0; }
const forbidden = () => { stats.writes++; throw new Error('A planning operation attempted a write'); };
export async function createClient() {
  stats.contexts++;
  return {
    auth: { async getUser() { return { data: { user: { id: 'synthetic-admin' } } }; } },
    from(table) {
      assert.ok(['profiles', 'customers', 'customer_review_manifests'].includes(table));
      const query = {
        select() { return query; }, eq(field, value) { if (field === 'organization_id') assert.equal(value, org); return query; },
        order() { return query; },
        limit() { return query; },
        async maybeSingle() {
          if (table === 'profiles') return { data: { id: 'synthetic-admin', organization_id: org, active: true, role: actorRole }, error: null };
          if (table === 'customer_review_manifests') return { data: null, error: null };
          throw new Error('Unexpected maybeSingle query');
        },
        async range(start, end) { assert.equal(table, 'customers'); stats.reads++; return { data: failure ? null : rows.slice(start, end + 1), error: failure ? { message: 'synthetic read failure' } : null }; },
        insert: forbidden, update: forbidden, delete: forbidden, upsert: forbidden,
      };
      return query;
    },
    rpc: forbidden,
  };
}

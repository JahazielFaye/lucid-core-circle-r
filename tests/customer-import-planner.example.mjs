// Synthetic data only. Produces a plan, never executes it.
import { planCustomerImport } from '../src/lib/integrations/customer-import-planner.ts';
import { proposed, customer, request, snapshot } from './customer-import-planner.fixtures.mjs';
const plan = planCustomerImport(request([
  proposed({ source_record_id: '0000001', customer_code: '0000001', name: 'Synthetic New Customer' }),
  proposed({ phone: '555-0100' }),
  proposed({ source_record_id: 'QA-INACTIVE', customer_code: 'QA-INACTIVE', status: 'inactive' }),
  proposed({ source_record_id: 'QA-CONFLICT', customer_code: 'QA-NATIVE' }),
]), snapshot([customer(), customer({ id: 'native-synthetic-id', customer_code: 'QA-NATIVE', source_record_id: null, source_system: 'lucid_core' })]));
console.log(JSON.stringify(plan, null, 2));

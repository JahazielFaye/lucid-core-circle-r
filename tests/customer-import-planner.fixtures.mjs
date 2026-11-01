export const org = 'synthetic-org';
export function proposed(overrides = {}) {
  return { source_record_id: '0000123', customer_code: '0000123', name: 'Synthetic Customer', status: 'active', ...overrides };
}
export function customer(overrides = {}) {
  return {
    id: 'synthetic-customer-id', organization_id: org, source_system: 'food_connex',
    source_record_id: '0000123', customer_code: '0000123', name: 'Synthetic Customer',
    status: 'active', is_historical: false, updated_at: '2026-01-01T00:00:00Z',
    legal_name: null, address_line_1: null, address_line_2: null, city: null,
    state: null, postal_code: null, country: null, phone: null, general_email: null,
    default_warehouse_id: null, customer_type: null, customer_group: null,
    payment_terms_reference: null, invoice_preferences: null, delivery_preferences: null,
    operational_notes: null, po_required: false, order_guide_enabled: false,
    order_guide_retention_days: null, ...overrides,
  };
}
export function request(rows = [proposed()]) { return { organizationId: org, sourceReference: 'SYNTHETIC-QA-CUSTOMERS-v1', rows }; }
export function snapshot(records = [], overrides = {}) { return { organizationId: org, complete: true, records, ...overrides }; }

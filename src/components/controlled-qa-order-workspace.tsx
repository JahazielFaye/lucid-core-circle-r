'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

type Role = 'lucid_admin' | 'leadership' | 'office' | 'production';

type QaFixtures = {
  customer: boolean;
  shipTo: boolean;
  item: boolean;
  customerItem: boolean;
};

const initialFixtures: QaFixtures = { customer: false, shipTo: false, item: false, customerItem: false };

export function ControlledQaOrderWorkspace({ organizationId, role, qaOrders, onCreated, onOpenProduction }: {
  organizationId: string;
  role: Role;
  qaOrders: Array<{ id: string; externalPo: string; operationalStatus: string }>;
  onCreated: () => Promise<void>;
  onOpenProduction: (orderId: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [fixtures, setFixtures] = useState<QaFixtures>(initialFixtures);
  const [qaReference, setQaReference] = useState('QA-ORDER-WORK-001');
  const [quantity, setQuantity] = useState('2');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ orderId: string; po: string } | null>(null);

  const ready = fixtures.customer && fixtures.shipTo && fixtures.item && fixtures.customerItem;
  const loadFixtures = async () => {
    const [customer, shipTo, item, customerItem] = await Promise.all([
      supabase.from('customers').select('id').eq('organization_id', organizationId).eq('source_system', 'lucid_qa').eq('customer_code', 'QA-CUSTOMER-WORK-001').eq('name', 'QA Test Customer').eq('status', 'active').eq('is_historical', false).maybeSingle(),
      supabase.from('customer_ship_tos').select('id').eq('organization_id', organizationId).eq('source_system', 'lucid_qa').eq('location_code', 'QA-SHIP-TO-WORK-001').eq('name', 'QA Test Ship-To').eq('status', 'active').eq('is_historical', false).maybeSingle(),
      supabase.from('items').select('id').eq('organization_id', organizationId).eq('source_system', 'lucid_qa').eq('item_code', 'QA-ITEM-WORK-001').eq('description', 'QA Validation Item').eq('status', 'active').eq('is_historical', false).maybeSingle(),
      supabase.from('customer_items').select('id').eq('organization_id', organizationId).eq('source_system', 'lucid_qa').eq('customer_sku', 'QA-SKU-WORK-001').eq('status', 'active').eq('is_historical', false).maybeSingle(),
    ]);
    setFixtures({
      customer: Boolean(customer.data),
      shipTo: Boolean(shipTo.data),
      item: Boolean(item.data),
      customerItem: Boolean(customerItem.data),
    });
  };

  useEffect(() => { void loadFixtures(); }, [organizationId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !ready) return;
    if (!qaReference.trim().toUpperCase().startsWith('QA-')) {
      setError('QA Order / PO must begin with QA-.');
      return;
    }
    setSaving(true);
    setError(null);
    setCreated(null);
    try {
      const response = await fetch('/api/qa/create-order', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qaReference, quantity, uom: 'CS' }),
      });
      const result = await response.json().catch(() => null) as { success?: boolean; error?: string; data?: { order_id?: string } } | null;
      if (!response.ok || !result?.success || !result.data?.order_id) {
        throw new Error(result?.error || 'Could not create the controlled QA order.');
      }
      await onCreated();
      setCreated({ orderId: result.data.order_id, po: qaReference.trim() });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the controlled QA order.');
    } finally {
      setSaving(false);
    }
  };

  if (role !== 'lucid_admin') return null;

  return <section className="surface qa-order-panel" aria-label="Controlled QA Order">
    <div className="qa-order-heading"><div><span className="status-chip progress">TEST / QA</span><h2>Create Controlled QA Order</h2><p>Creates a separate test-only production order. It cannot use real Circle R customer, ship-to, or item records.</p></div></div>
    <div className="qa-order-fixtures"><span>Customer <strong>{fixtures.customer ? 'QA Test Customer' : 'Missing'}</strong></span><span>Ship-To <strong>{fixtures.shipTo ? 'QA Test Ship-To' : 'Missing'}</strong></span><span>Item <strong>{fixtures.item ? 'QA-ITEM-WORK-001 — QA Validation Item' : 'Missing'}</strong></span><span>Customer SKU <strong>{fixtures.customerItem ? 'QA-SKU-WORK-001' : 'Missing'}</strong></span></div>
    {!ready && <p className="master-data-error">Prepare QA Test Data first in Inventory → Receiving. QA order creation stays disabled until all four fixtures are ready.</p>}
    {error && <p className="master-data-error" role="alert">{error}</p>}
    <form className="master-form qa-order-form" onSubmit={submit}>
      <label><span>QA Order / PO</span><input value={qaReference} onChange={event => setQaReference(event.target.value)} placeholder="QA-ORDER-WORK-001" disabled={saving || !ready} required /></label>
      <label><span>Quantity</span><input inputMode="decimal" value={quantity} onChange={event => setQuantity(event.target.value)} disabled={saving || !ready} required /></label>
      <label><span>UOM</span><input value="CS" disabled aria-label="UOM" /></label>
      <button className="primary" type="submit" disabled={saving || !ready}>{saving ? 'Creating…' : 'Create Controlled QA Order'}</button>
    </form>
    {created && <div className="master-data-message"><strong>TEST / QA</strong> PO {created.po} is ready for production. <small>Order ID {created.orderId}</small> <button type="button" className="text-button" onClick={() => onOpenProduction(created.orderId)}>Open in Picking / Production</button></div>}
    {qaOrders.length > 0 && <div className="qa-order-existing"><span className="kicker">Controlled QA orders</span>{qaOrders.map(order => <div key={order.id}><span><span className="status-chip progress">TEST / QA</span><strong>PO {order.externalPo}</strong><small>{order.operationalStatus.replaceAll('_', ' ')}</small></span><button type="button" className="secondary" onClick={() => onOpenProduction(order.id)}>Open Production</button></div>)}</div>}
  </section>;
}

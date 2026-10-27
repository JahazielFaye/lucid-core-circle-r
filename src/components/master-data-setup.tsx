'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

type Role = 'lucid_admin' | 'leadership' | 'office' | 'production';
type Customer = { id: string; customer_code: string | null; name: string; status: 'active' | 'inactive'; city: string | null; state: string | null; phone: string | null };
type ShipTo = { id: string; customer_id: string; location_code: string | null; name: string; status: 'active' | 'inactive'; city: string | null; state: string | null };
type Item = { id: string; item_code: string; description: string; status: 'active' | 'inactive'; stock_uom: string | null; sell_uom: string | null; catch_weight: boolean };
type CustomerItem = { id: string; customer_id: string; ship_to_id: string | null; item_id: string; customer_sku: string | null; customer_uom: string | null; status: 'active' | 'inactive' };
type CustomerContact = { id: string; customer_id: string; contact_type: string; name: string; email: string | null; phone: string | null; is_primary: boolean; status: 'active' | 'inactive' };
type ItemIdentifier = { id: string; item_id: string; identifier_type: string; identifier_value: string; uom: string | null; is_primary: boolean; verified: boolean; status: 'active' | 'inactive' };

export function MasterDataSetup({ organizationId, role }: { organizationId: string; role: Role }) {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<'customers' | 'shipTos' | 'contacts' | 'items' | 'identifiers' | 'customerItems'>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [shipTos, setShipTos] = useState<ShipTo[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [customerItems, setCustomerItems] = useState<CustomerItem[]>([]);
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [identifiers, setIdentifiers] = useState<ItemIdentifier[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const editable = role === 'lucid_admin' || role === 'leadership' || role === 'office';

  const load = async () => {
    setLoading(true); setLoadError(null);
    const [customerResult, shipToResult, itemResult, customerItemResult, contactResult, identifierResult] = await Promise.all([
      supabase.from('customers').select('id, customer_code, name, status, city, state, phone').eq('organization_id', organizationId).order('name'),
      supabase.from('customer_ship_tos').select('id, customer_id, location_code, name, status, city, state').eq('organization_id', organizationId).order('name'),
      supabase.from('items').select('id, item_code, description, status, stock_uom, sell_uom, catch_weight').eq('organization_id', organizationId).order('item_code'),
      supabase.from('customer_items').select('id, customer_id, ship_to_id, item_id, customer_sku, customer_uom, status').eq('organization_id', organizationId).order('created_at', { ascending: false }),
      supabase.from('customer_contacts').select('id, customer_id, contact_type, name, email, phone, is_primary, status').eq('organization_id', organizationId).order('name'),
      supabase.from('item_identifiers').select('id, item_id, identifier_type, identifier_value, uom, is_primary, verified, status').eq('organization_id', organizationId).order('created_at', { ascending: false }),
    ]);
    if (!customerResult.error) setCustomers((customerResult.data || []) as Customer[]);
    else setLoadError('Customer records could not be loaded.');
    if (!shipToResult.error) setShipTos((shipToResult.data || []) as ShipTo[]);
    else setLoadError('Ship-to records could not be loaded.');
    if (!itemResult.error) setItems((itemResult.data || []) as Item[]);
    else setLoadError('Item records could not be loaded.');
    if (!customerItemResult.error) setCustomerItems((customerItemResult.data || []) as CustomerItem[]);
    else setLoadError('Customer item records could not be loaded.');
    if (!contactResult.error) setContacts((contactResult.data || []) as CustomerContact[]);
    else setLoadError('Customer contacts could not be loaded.');
    if (!identifierResult.error) setIdentifiers((identifierResult.data || []) as ItemIdentifier[]);
    else setLoadError('Item identifiers could not be loaded.');
    setLoading(false);
  };
  useEffect(() => { void load(); }, [organizationId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editable || saving) return;
    const form = new FormData(event.currentTarget);
    setSaving(true); setMessage(null);
    const text = (name: string) => String(form.get(name) || '').trim();
    let error: { message?: string } | null = null;
    if (tab === 'customers') {
      ({ error } = await supabase.from('customers').insert({ organization_id: organizationId, customer_code: text('customerCode') || null, name: text('name'), city: text('city') || null, state: text('state') || null, phone: text('phone') || null }));
    } else if (tab === 'shipTos') {
      ({ error } = await supabase.from('customer_ship_tos').insert({ organization_id: organizationId, customer_id: text('customerId'), location_code: text('locationCode') || null, name: text('name'), city: text('city') || null, state: text('state') || null }));
    } else if (tab === 'items') {
      ({ error } = await supabase.from('items').insert({ organization_id: organizationId, item_code: text('itemCode'), description: text('description'), stock_uom: text('stockUom') || null, sell_uom: text('sellUom') || null, catch_weight: form.get('catchWeight') === 'on' }));
    } else if (tab === 'contacts') {
      ({ error } = await supabase.from('customer_contacts').insert({ organization_id: organizationId, customer_id: text('customerId'), contact_type: text('contactType'), name: text('name'), email: text('email') || null, phone: text('phone') || null, is_primary: form.get('isPrimary') === 'on' }));
    } else if (tab === 'identifiers') {
      ({ error } = await supabase.from('item_identifiers').insert({ organization_id: organizationId, item_id: text('itemId'), identifier_type: text('identifierType'), identifier_value: text('identifierValue'), uom: text('uom') || null, is_primary: form.get('isPrimary') === 'on', verified: form.get('verified') === 'on' }));
    } else {
      ({ error } = await supabase.from('customer_items').insert({ organization_id: organizationId, customer_id: text('customerId'), ship_to_id: text('shipToId') || null, item_id: text('itemId'), customer_sku: text('customerSku') || null, customer_uom: text('customerUom') || null }));
    }
    if (error) setMessage(error.message || 'Could not save this record.');
    else { event.currentTarget.reset(); setMessage('Saved. Lucid will use this master record on future work.'); await load(); }
    setSaving(false);
  };

  const normalizedQuery = query.toLowerCase().trim();
  const matches = (values: Array<string | null | undefined>) => !normalizedQuery || values.some(value => value?.toLowerCase().includes(normalizedQuery));
  const customerName = (id: string) => customers.find(customer => customer.id === id)?.name || 'Customer unavailable';
  const itemName = (id: string) => items.find(item => item.id === id)?.description || 'Item unavailable';

  return <section className="master-data-workspace">
    <header className="page-heading compact-heading"><div><span className="kicker">Admin / Setup</span><h1>Customers & items</h1><p>Keep the operational records Lucid uses for orders, production, labels, and traceability accurate.</p></div></header>
    <div className="master-tabs" role="tablist" aria-label="Master data areas">
      {([['customers', 'Customers'], ['shipTos', 'Ship-Tos'], ['contacts', 'Contacts'], ['items', 'Items'], ['identifiers', 'GTIN / UPC'], ['customerItems', 'Customer Items']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    <section className="surface master-data-surface">
      <div className="master-data-toolbar"><label><span className="sr-only">Search records</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by code, name, or description" /></label><small>{editable ? 'New records are organization-scoped and saved with an audit entry.' : 'Your role can view master data but cannot change it.'}</small></div>
      {loading && <p className="master-data-message" role="status">Loading master data…</p>}
      {loadError && <p className="master-data-error" role="alert">{loadError}</p>}
      {message && <p className="master-data-message" role="status">{message}</p>}
      {tab === 'customers' && <><MasterTable headings={['Customer code', 'Customer', 'Location', 'Phone', 'Status']} rows={customers.filter(row => matches([row.customer_code, row.name, row.city, row.state])).map(row => [row.customer_code || '—', row.name, [row.city, row.state].filter(Boolean).join(', ') || '—', row.phone || '—', prettyStatus(row.status)])} empty="No customers yet." /><MasterForm disabled={!editable || saving} onSubmit={submit}><Field name="customerCode" label="Customer code" /><Field name="name" label="Customer name" required /><Field name="city" label="City" /><Field name="state" label="State" /><Field name="phone" label="Phone" /><SaveButton saving={saving} label="Add customer" /></MasterForm></>}
      {tab === 'shipTos' && <><MasterTable headings={['Customer', 'Location code', 'Ship-to', 'Location', 'Status']} rows={shipTos.filter(row => matches([customerName(row.customer_id), row.location_code, row.name, row.city])).map(row => [customerName(row.customer_id), row.location_code || '—', row.name, [row.city, row.state].filter(Boolean).join(', ') || '—', prettyStatus(row.status)])} empty="No ship-tos yet." /><MasterForm disabled={!editable || saving} onSubmit={submit}><Select name="customerId" label="Customer" options={customers.map(customer => [customer.id, customer.name])} required /><Field name="locationCode" label="Location code" /><Field name="name" label="Ship-to name" required /><Field name="city" label="City" /><Field name="state" label="State" /><SaveButton saving={saving} label="Add ship-to" /></MasterForm></>}
      {tab === 'contacts' && <><MasterTable headings={['Customer', 'Contact', 'Type', 'Email / phone', 'Primary', 'Status']} rows={contacts.filter(row => matches([customerName(row.customer_id), row.name, row.email, row.phone])).map(row => [customerName(row.customer_id), row.name, row.contact_type, [row.email, row.phone].filter(Boolean).join(' · ') || '—', row.is_primary ? 'Yes' : '—', prettyStatus(row.status)])} empty="No customer contacts yet." /><MasterForm disabled={!editable || saving} onSubmit={submit}><Select name="customerId" label="Customer" options={customers.map(customer => [customer.id, customer.name])} required /><Select name="contactType" label="Contact type" options={['office', 'accounting', 'sales', 'invoice', 'operations', 'other'].map(value => [value, value.charAt(0).toUpperCase() + value.slice(1)])} required /><Field name="name" label="Contact name" required /><Field name="email" label="Email" /><Field name="phone" label="Phone" /><label className="master-checkbox"><input type="checkbox" name="isPrimary" /> Primary contact</label><SaveButton saving={saving} label="Add contact" /></MasterForm></>}
      {tab === 'items' && <><MasterTable headings={['Item ID', 'Description', 'Stock UOM', 'Sell UOM', 'Weight', 'Status']} rows={items.filter(row => matches([row.item_code, row.description])).map(row => [row.item_code, row.description, row.stock_uom || '—', row.sell_uom || '—', row.catch_weight ? 'Catch weight' : 'Standard', prettyStatus(row.status)])} empty="No items yet." /><MasterForm disabled={!editable || saving} onSubmit={submit}><Field name="itemCode" label="Item ID" required /><Field name="description" label="Description" required /><Field name="stockUom" label="Stock UOM" /><Field name="sellUom" label="Sell UOM" /><label className="master-checkbox"><input type="checkbox" name="catchWeight" /> Catch weight item</label><SaveButton saving={saving} label="Add item" /></MasterForm></>}
      {tab === 'identifiers' && <><MasterTable headings={['Item', 'Type', 'Identifier', 'UOM', 'Primary / verified', 'Status']} rows={identifiers.filter(row => matches([itemName(row.item_id), row.identifier_type, row.identifier_value, row.uom])).map(row => [itemName(row.item_id), row.identifier_type.toUpperCase(), row.identifier_value, row.uom || '—', `${row.is_primary ? 'Primary' : 'Secondary'} · ${row.verified ? 'Verified' : 'Unverified'}`, prettyStatus(row.status)])} empty="No GTIN, UPC, or other item identifiers yet." /><MasterForm disabled={!editable || saving} onSubmit={submit}><Select name="itemId" label="Lucid item" options={items.map(item => [item.id, `${item.item_code} · ${item.description}`])} required /><Select name="identifierType" label="Identifier type" options={['gtin', 'upc', 'vendor_item', 'manufacturer_item', 'customer_sku', 'other'].map(value => [value, value.toUpperCase().replace('_', ' ')])} required /><Field name="identifierValue" label="Identifier value" required /><Field name="uom" label="UOM (optional)" /><label className="master-checkbox"><input type="checkbox" name="isPrimary" /> Primary identifier</label><label className="master-checkbox"><input type="checkbox" name="verified" /> Verified</label><SaveButton saving={saving} label="Add identifier" /></MasterForm></>}
      {tab === 'customerItems' && <><MasterTable headings={['Customer', 'Ship-to', 'Item', 'Customer item', 'UOM', 'Status']} rows={customerItems.filter(row => matches([customerName(row.customer_id), itemName(row.item_id), row.customer_sku, row.customer_uom])).map(row => [customerName(row.customer_id), row.ship_to_id ? shipTos.find(shipTo => shipTo.id === row.ship_to_id)?.name || '—' : 'All locations', itemName(row.item_id), row.customer_sku || '—', row.customer_uom || '—', prettyStatus(row.status)])} empty="No customer item mappings yet." /><MasterForm disabled={!editable || saving} onSubmit={submit}><Select name="customerId" label="Customer" options={customers.map(customer => [customer.id, customer.name])} required /><Select name="shipToId" label="Ship-to (optional)" options={shipTos.map(shipTo => [shipTo.id, `${customerName(shipTo.customer_id)} · ${shipTo.name}`])} /><Select name="itemId" label="Lucid item" options={items.map(item => [item.id, `${item.item_code} · ${item.description}`])} required /><Field name="customerSku" label="Customer item / SKU" /><Field name="customerUom" label="Customer UOM" /><SaveButton saving={saving} label="Add customer item" /></MasterForm></>}
    </section>
  </section>;
}

function prettyStatus(status: string) { return status === 'active' ? 'Active' : 'Inactive'; }
function MasterTable({ headings, rows, empty }: { headings: string[]; rows: string[][]; empty: string }) { return <div className="master-table-wrap"><table className="master-table"><thead><tr>{headings.map(heading => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.join('-')}-${index}`}>{row.map((value, valueIndex) => <td key={valueIndex}>{value}</td>)}</tr>)}{!rows.length && <tr><td colSpan={headings.length} className="master-empty">{empty}</td></tr>}</tbody></table></div>; }
function MasterForm({ children, onSubmit, disabled }: { children: React.ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void; disabled: boolean }) { return <form className="master-form" onSubmit={onSubmit} aria-disabled={disabled}><fieldset disabled={disabled} style={{ display: 'contents' }}>{children}</fieldset></form>; }
function Field({ name, label, required = false }: { name: string; label: string; required?: boolean }) { return <label><span>{label}</span><input name={name} required={required} disabled={false} /></label>; }
function Select({ name, label, options, required = false }: { name: string; label: string; options: Array<[string, string]>; required?: boolean }) { return <label><span>{label}</span><select name={name} required={required} defaultValue=""><option value="">{required ? `Select ${label.toLowerCase()}` : 'All / none'}</option>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>; }
function SaveButton({ saving, label }: { saving: boolean; label: string }) { return <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : label}</button>; }

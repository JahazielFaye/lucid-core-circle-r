'use client';

import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRightLeft, Bell, Boxes, ChartNoAxesCombined, CheckCheck, ChevronDown, ChevronRight, CircleAlert, ClipboardList, FileText, FlaskConical, FolderOpen, Forward, Grid3X3, Home as HomeIcon, LogOut, Menu, MessageSquare, PackageCheck, Search, Send, Settings, ShieldCheck, ScanSearch, Truck, UsersRound, X } from 'lucide-react';
import { orders as seedOrders, pallets as seedPallets } from '@/lib/core/mock';
import type { Pallet, UnifiedOrder } from '@/lib/core/types';
import { createClient } from '@/utils/supabase/client';
import { createDirectConversation, loadSharedMessaging, markSharedMessagesRead, sendSharedMessage, type SharedMessagingSnapshot } from '@/lib/supabase/messaging';
import { openBrowserCaseLabel, startBrowserCaseLabelPrint, type CaseLabelData } from '@/lib/production/case-label';
import { MasterDataSetup } from '@/components/master-data-setup';
import { InventoryWorkspace } from '@/components/inventory-workspace';
import { ProductionGenealogyWorkspace } from '@/components/production-genealogy-workspace';
import { ShipmentWorkspace } from '@/components/shipment-workspace';
import { HistoricalImportWorkspace } from '@/components/historical-import-workspace';
import { OperationsReports } from '@/components/operations-reports';
import { ReplacementReadiness } from '@/components/replacement-readiness';
import { ControlledQaOrderWorkspace } from '@/components/controlled-qa-order-workspace';

type Role = 'lucid_admin' | 'leadership' | 'office' | 'production';
type Section = 'Home' | 'Orders' | 'Exceptions' | 'Production' | 'Inventory' | 'Pallets' | 'Shipments' | 'Trace' | 'Reports' | 'Imports' | 'Samples' | 'Documents' | 'Office' | 'Logistics' | 'Sales' | 'Roadmap' | 'MasterData' | 'System';
type Notice = { tone: 'success' | 'warning' | 'info'; message: string } | null;

type UserRecord = {
  id: string;
  name: string;
  username: string;
  role: Role;
  active: boolean;
};

type AuthProfile = {
  id: string;
  organization_id: string;
  display_name: string;
  role: Role;
  active: boolean;
};
type StagedLine = { id:string; staged_order_id:string; line_number:string|null; buyer_part_number:string|null; vendor_item:string|null; gtin:string|null; description:string|null; quantity:number|null; sps_uom:string|null; sps_purchase_price:number|null; mapped_food_connex_item_number:string|null; approved_circle_r_price:number|null; item_mapping_status:string; price_status:string; uom_status:string };
type StagedException = { id:string; staged_order_id:string; staged_order_line_id:string|null; exception_code:string; severity:'info'|'warning'|'blocking'; field_name:string|null; message:string; suggested_actions:string[]; status:string; details?: unknown; resolution_action?:string|null; resolved_at?:string|null; resolved_by?:string|null; resolved_by_name?:string|null };
type StagedOrder = { id:string; source_file:string|null; source_path:string|null; external_po:string; trading_partner_id:string|null; po_date:string|null; requested_ship_date:string|null; source_customer_name:string|null; source_ship_to_name:string|null; source_ship_to_code:string|null; mapping_status:string; review_status:string; promoted_order_id:string|null; created_at:string };
type ProductionLine = UnifiedOrder['lines'][number] & { id: string; nativeItemId?: string | null; gtin?: string | null; lotCode?: string | null };
type OperationalOrder = Omit<UnifiedOrder, 'lines'> & { operationalStatus: string; orderDate?: string; sourceSystem?: string; lines: ProductionLine[] };
type ProductionLot = { id:string; organization_id:string; order_id:string; order_line_id:string; lot_code:string; status:'active'|'closed'; created_at:string };
type ProductionCase = { id:string; order_id:string; order_line_id:string; production_lot_id:string|null; production_run_id:string|null; output_inventory_lot_id:string|null; lot_code:string|null; pallet_id:string|null; case_identifier:string; quantity:number; net_weight:number|null; net_weight_uom:string; uom:string; status:'produced'|'palletized'|'shipped'|'voided'; produced_at:string; voided_at:string|null; void_reason:string|null; label_printed_at:string|null; label_print_count:number };
type OperationalPallet = { id:string; order_id:string; pallet_identifier:string; status:'building'|'complete'|'shipped'|'voided'; created_at:string; created_by:string|null; created_by_name:string|null; completed_at:string|null; completed_by:string|null; completed_by_name:string|null; original_completed_at:string|null; original_completed_by:string|null; original_completed_by_name:string|null; reopened_at:string|null; reopened_by:string|null; reopened_by_name:string|null; reopen_reason:string|null };
type PalletCaseAssignment = { id:string; pallet_id:string; production_case_id:string|null; status:'active'|'removed' };
type PalletActivity = { id:string; pallet_id:string; action:string; actor_name:string|null; created_at:string; details:unknown };

function palletActivityCopy(action: string, details: unknown) {
  const values = details && typeof details === 'object' ? details as Record<string, unknown> : {};
  const caseIdentifier = typeof values.case_identifier === 'string' ? values.case_identifier : 'a case';
  if (action === 'pallet created') return 'created this pallet.';
  if (action === 'case added to pallet') return `added case ${caseIdentifier}.`;
  if (action === 'case removed from pallet') return `removed case ${caseIdentifier} for correction.`;
  if (action === 'pallet completed') return 'completed this pallet.';
  if (action === 'pallet reopened for correction') return 'reopened this pallet for correction.';
  return 'updated this pallet.';
}

const stagedExceptionLabels: Record<string, string> = {
  CUSTOMER_UNMAPPED: 'Customer needs confirmation',
  SHIP_TO_UNMAPPED: 'Ship-to needs confirmation',
  ITEM_UNMAPPED: 'Item needs matching',
  PRICE_MISMATCH: 'Price is different',
  HEADER_QUANTITY_MISMATCH: 'Order quantity needs review',
  REQUESTED_DATE_UNMAPPED: 'Requested date needs confirmation',
};
const stagedExceptionLabel = (code: string) => stagedExceptionLabels[code] || 'Order check';

type AuditEvent = {
  id: string;
  at: string;
  user: string;
  action: string;
  entity: string;
  detail: string;
};

type BrandingSettings = {
  appName: string;
  companyName: string;
  tagline: string;
  logoDataUrl?: string;
};

type ExceptionDecision = {
  source: 'Physical price sheet' | 'Food Connex' | 'SPS' | 'Customer confirmation' | 'Other';
  approvedPrice?: number;
  referenceWeightLb?: number;
  notes?: string;
  reviewedAt: string;
};

type ReportRecord = {
  id: string;
  orderId?: string;
  po?: string;
  stage: 'Order' | 'Exception' | 'Production' | 'Pallet' | 'Shipment' | 'Order Packet';
  title: string;
  createdAt: string;
  html: string;
  sharePointStatus: 'Ready to sync' | 'Queued';
  suggestedPath?: string;
};

type InventoryRecord = { id:string; item:string; lot?:string; location?:string; onHand:number; unit:string; updatedAt:string; notes?:string };
type SampleRecord = { id:string; customer:string; item:string; type:'Sample'|'Rebuild'; owner:string; status:'New'|'In progress'|'Shipped'|'Closed'; due?:string; tracking?:string; notes?:string };
type OfficeRecord = { id:string; type:'AP Bill'|'AR Invoice'|'Customer File'|'Vendor File'|'Other'; reference:string; party:string; status:'Received'|'Needs review'|'Approved'|'Filed'; due?:string; notes?:string };
type LogisticsRecord = { id:string; po?:string; carrier:string; mode:'LTL'|'FTL'|'Customer Pickup'|'Other'; pickup?:string; delivery?:string; appointment?:string; status:'Planning'|'Quoted'|'Booked'|'In transit'|'Delivered'; rate?:number; notes?:string };
type SalesRecord = { id:string; company:string; contact?:string; source:'Food Show'|'Referral'|'Inbound'|'Existing Customer'|'Other'; nextStep:string; owner:string; status:'New'|'Follow-up'|'Quoted'|'Won'|'Closed'; followUpDate?:string; notes?:string };

type ConversationRecord = { id:string; kind:'direct'|'group'; name:string; participantIds:string[]; createdAt:string; updatedAt:string };
type MessageRecord = { id:string; threadId:string; fromUserId:string; body:string; createdAt:string; readBy:string[]; forwardedFromId?:string; forwardedByUserId?:string };

type AppState = {
  orders: UnifiedOrder[];
  pallets: Pallet[];
  reviewedExceptions: string[];
  exceptionDecisions: Record<string, ExceptionDecision>;
  branding: BrandingSettings;
  reports: ReportRecord[];
  users: UserRecord[];
  audit: AuditEvent[];
  inventory: InventoryRecord[];
  samples: SampleRecord[];
  officeRecords: OfficeRecord[];
  logistics: LogisticsRecord[];
  sales: SalesRecord[];
  conversations: ConversationRecord[];
  messages: MessageRecord[];
};

const defaultBranding: BrandingSettings = {
  appName: 'Lucid Core',
  companyName: 'Circle R Beef',
  tagline: 'Operations Hub',
};

const defaultConversations: ConversationRecord[] = [
  { id:'thread-team', kind:'group', name:'Circle R Team', participantIds:['usr-crystal','usr-cj','usr-mark','usr-admin'], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() },
];

const defaultUsers: UserRecord[] = [
  { id: 'usr-crystal', name: 'Crystal', username: 'crystal', role: 'office', active: true },
  { id: 'usr-cj', name: 'CJ / Production', username: 'cj', role: 'production', active: true },
  { id: 'usr-mark', name: 'Mark', username: 'mark', role: 'leadership', active: true },
  { id: 'usr-admin', name: 'Lucid Admin', username: 'admin', role: 'lucid_admin', active: true },
];

const roleSections: Record<Role, Section[]> = {
  office: ['Home', 'Orders', 'Exceptions', 'Production', 'Inventory', 'Pallets', 'Shipments', 'Trace', 'Reports', 'MasterData'],
  production: ['Home', 'Orders', 'Production', 'Inventory', 'Pallets', 'Shipments', 'Trace'],
  leadership: ['Home', 'Orders', 'Exceptions', 'Production', 'Inventory', 'Pallets', 'Shipments', 'Trace', 'Reports', 'MasterData'],
  lucid_admin: ['Home', 'Orders', 'Exceptions', 'Production', 'Inventory', 'Pallets', 'Shipments', 'Trace', 'Reports', 'Imports', 'MasterData', 'System'],
};

const roleLabels: Record<Role, string> = {
  lucid_admin: 'Lucid Admin',
  leadership: 'Leadership',
  office: 'Office',
  production: 'Production',
};

const sectionLabels: Record<Section, string> = {
  Home: 'Home',
  Orders: 'Orders / PO',
  Exceptions: 'Order Review',
  Production: 'Picking / Production',
  Inventory: 'Inventory',
  Pallets: 'Pallet Breakdown',
  Shipments: 'Advance Ship Notice',
  Trace: 'Trace / Recall',
  Reports: 'Reports',
  Imports: 'Historical Import',
  Samples: 'Samples / Rebuilds',
  Documents: 'Order Files / SharePoint',
  Office: 'Office Paperwork',
  Logistics: 'Logistics',
  Sales: 'Sales / Food Show Follow-Up',
  Roadmap: '90-Day Plan',
  MasterData: 'Customers & Items',
  System: 'Admin / Setup',
};

const reportStageLabel: Record<ReportRecord['stage'], string> = {
  Order: 'Purchase Order / Order',
  Exception: 'Order Review',
  Production: 'Picking / Production',
  Pallet: 'Pallet Breakdown',
  Shipment: 'Advance Ship Notice',
  'Order Packet': 'Customer Order Packet',
};

const foodConnexMap: Record<string, { item: string; description: string; price: number }> = {
  '000000000010174082': { item: '10174082', description: 'D.D. Fully Cooked Pork Belly', price: 4.99 },
  '000000000010133913': { item: '10133913', description: 'D.D. Fully Cooked Beef Brisket', price: 11.29 },
};

/** Presentation-only resolver for production-floor labels; it does not alter source or operational records. */
function productionItemName(line: { externalSku?: string; internalItemId?: string; vendorItem?: string; description?: string | null }) {
  const operationalDescription = line.description?.trim();
  if (operationalDescription && operationalDescription.toLowerCase() !== 'sps item') return operationalDescription;
  const approvedName = line.externalSku ? foodConnexMap[line.externalSku]?.description : undefined;
  if (approvedName) return approvedName;
  return line.internalItemId || line.externalSku || line.vendorItem || 'Item details unavailable';
}

function productionItemIdentifier(line: { externalSku?: string; internalItemId?: string; vendorItem?: string }) {
  return line.internalItemId || line.externalSku || line.vendorItem || 'No item identifier';
}

const shipToMap: Record<string, string> = { '3001': 'Riviera' };

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"' && quoted && next === '"') { field += '"'; i += 1; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && next === '\n') i += 1;
      row.push(field); field = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function toIsoDate(value?: string) {
  if (!value) return undefined;
  const [m, d, y] = value.split('/');
  return y && m && d ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : value;
}

function normalizeSpsCsv(text: string): UnifiedOrder {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The CSV does not contain an SPS order.');
  const headers = rows[0];
  const index = (name: string) => headers.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());
  const get = (row: string[], name: string) => {
    const i = index(name);
    return i >= 0 && i < row.length ? row[i]?.trim() : '';
  };
  const recordIdx = index('Record Type');
  const headerRow = rows.slice(1).find(r => recordIdx >= 0 && r[recordIdx]?.trim() === 'H') || rows[1];
  const detailRows = rows.slice(1).filter(r => recordIdx >= 0 && r[recordIdx]?.trim() === 'D');
  const po = get(headerRow, 'PO Number') || get(headerRow, 'Retailers PO');
  if (!po) throw new Error('PO Number was not found in the SPS export.');
  const shipLocation = get(headerRow, 'Ship To Location');
  const partner = get(headerRow, 'Partner') || 'SPS Customer';
  return {
    id: `sps-${po}-${Date.now()}`,
    externalPo: po,
    customer: partner,
    shipTo: shipToMap[shipLocation] || get(headerRow, 'Ship To Name') || shipLocation || 'Review ship-to',
    requestedShipDate: toIsoDate(get(headerRow, 'Ship Dates')),
    requestedDeliveryDate: toIsoDate(get(headerRow, 'Requested Delivery Date')),
    orderedWeightLb: Number(get(headerRow, 'PO Total Weight') || 0) || undefined,
    source: 'SPS',
    status: 'mapped',
    lines: detailRows.map(r => {
      const externalSku = get(r, 'Buyers Catalog or Stock Keeping #');
      const known = foodConnexMap[externalSku];
      const spsPrice = Number(get(r, 'Unit Price') || 0);
      return {
        externalSku,
        vendorItem: get(r, 'Vendor Style'),
        internalItemId: known?.item,
        description: known?.description || get(r, 'Product/Item Description') || 'Unmapped item',
        quantityCases: Number(get(r, 'Qty Ordered') || 0),
        unitPrice: spsPrice,
        uom: get(r, 'Unit of Measure') === 'Case' ? 'CS' : get(r, 'Unit of Measure') || 'EA',
      };
    }),
  };
}

function orderIssues(order: UnifiedOrder) {
  const issues: { type: string; message: string; severity: 'warning' | 'blocking' }[] = [];
  for (const line of order.lines) {
    const known = foodConnexMap[line.externalSku];
    if (!known || !line.internalItemId) {
      issues.push({ type: 'Item mapping', message: `${line.description} is not mapped to a Food Connex item.`, severity: 'blocking' });
    } else if (line.unitPrice != null && Math.abs(line.unitPrice - known.price) > 0.001) {
      issues.push({ type: 'Price review', message: `${known.description}: SPS $${line.unitPrice.toFixed(2)} / Food Connex $${known.price.toFixed(2)}`, severity: 'warning' });
    }
  }
  return issues;
}

function totalCases(order: UnifiedOrder) { return order.lines.reduce((sum, line) => sum + line.quantityCases, 0); }


function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[ch] || ch));
}

function reportShell(title: string, subtitle: string, body: string, documentLabel = 'OPERATIONS RECORD') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
  @page{size:letter;margin:.42in}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#171b19;margin:0;line-height:1.25;font-size:11px}.doc{border:1px solid #9ca39f;min-height:9.7in;background:#fff}.doc-head{display:grid;grid-template-columns:1.35fr .8fr;border-bottom:1px solid #9ca39f}.company{padding:14px 16px}.company strong{font-size:19px;display:block;letter-spacing:.02em}.company span{display:block;color:#545b57;margin-top:2px}.doc-title{border-left:1px solid #9ca39f;padding:12px 14px;text-align:right}.doc-title small{display:block;text-transform:uppercase;letter-spacing:.12em;color:#666;font-weight:700}.doc-title b{display:block;font-size:19px;margin-top:4px}.doc-meta{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #9ca39f}.meta-cell{min-height:48px;padding:7px 9px;border-right:1px solid #c8cdca}.meta-cell:last-child{border-right:0}.meta-cell small,.field-label{display:block;text-transform:uppercase;letter-spacing:.08em;color:#666;font-size:8px;font-weight:700}.meta-cell strong{font-size:11px;display:block;margin-top:5px}.doc-body{padding:14px 16px}.section-title{font-size:11px;text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid #777;padding-bottom:5px;margin:14px 0 7px;font-weight:800}.form-grid{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #aaa;margin:8px 0}.form-box{padding:8px;border-right:1px solid #bbb;min-height:48px}.form-box:last-child{border-right:0}.form-box strong{display:block;margin-top:5px;font-size:11px}.lined-field{border-bottom:1px solid #999;min-height:23px;padding-top:5px}.sps-table{width:100%;border-collapse:collapse;margin-top:8px;font-size:9px}.sps-table th{font-size:7px;text-transform:uppercase;letter-spacing:.05em;background:#f2f2f0;border-top:1px solid #aaa;border-bottom:1px solid #aaa;padding:6px 5px;text-align:left}.sps-table td{border-bottom:1px solid #c8cdca;padding:6px 5px;vertical-align:top}.sps-table td.num{text-align:right}.flag{font-weight:800;color:#9f111b}.summary-row{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #aaa;margin-top:8px}.summary-row>div{padding:8px;border-right:1px solid #bbb}.summary-row>div:last-child{border-right:0}.summary-row small{display:block;color:#666;text-transform:uppercase;font-size:7px;font-weight:700}.summary-row strong{display:block;margin-top:4px}.signature-row{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:28px}.signature{border-top:1px solid #777;padding-top:4px;font-size:8px;color:#666}.pallet-form{max-width:660px;margin:0 auto}.pallet-title{text-align:center;font-size:17px;margin:4px 0 20px}.pallet-head{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:12px}.pallet-line{display:grid;grid-template-columns:34px 1fr 1fr;gap:8px;align-items:end;min-height:30px}.check{width:13px;height:13px;border:1px solid #777}.write-line{border-bottom:1px solid #999;min-height:21px;padding:3px 5px}.doc-footer{border-top:1px solid #aaa;margin-top:20px;padding:8px 16px;color:#666;font-size:8px;display:flex;justify-content:space-between}.premium-note{background:#faf8f7;border-left:3px solid #9f111b;padding:8px 10px;margin:9px 0;color:#525854}.print-actions{display:none}@media print{body{background:#fff}.doc{border:0;min-height:auto}.doc-footer{position:fixed;bottom:0;left:0;right:0;background:#fff}}
  </style></head><body><div class="doc"><div class="doc-head"><div class="company"><strong>${escapeHtml(subtitle.split(' · ')[0] || 'Circle R Beef')}</strong><span>${escapeHtml(subtitle)}</span></div><div class="doc-title"><small>${escapeHtml(documentLabel)}</small><b>${escapeHtml(title)}</b></div></div>${body}<div class="doc-footer"><span>Lucid Core · Circle R Beef</span><span>Generated ${new Date().toLocaleString()}</span></div></div></body></html>`;
}

function downloadHtml(filename: string, html: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function printHtml(html: string) {
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) return false;
  win.document.open(); win.document.write(html); win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 250);
  return true;
}

function suggestedSharePointPath(order?: UnifiedOrder) {
  if (!order) return '/Circle R Operations/Reports';
  const year = order.requestedShipDate?.slice(0,4) || new Date().getFullYear();
  return `/Circle R Operations/${order.customer}/${year}/PO ${order.externalPo}`;
}

function SectionIcon({ name }: { name: Section }) {
  const iconProps = { size: 19, strokeWidth: 1.8, 'aria-hidden': true as const };
  const icons: Record<Section, React.ReactNode> = {
    Home: <HomeIcon {...iconProps} />,
    Orders: <FileText {...iconProps} />,
    Exceptions: <CircleAlert {...iconProps} />,
    Production: <PackageCheck {...iconProps} />,
    Inventory: <Boxes {...iconProps} />,
    Pallets: <Grid3X3 {...iconProps} />,
    Shipments: <Truck {...iconProps} />,
    Trace: <ScanSearch {...iconProps} />,
    Reports: <ChartNoAxesCombined {...iconProps} />,
    Imports: <FolderOpen {...iconProps} />,
    Samples: <FlaskConical {...iconProps} />,
    Documents: <FolderOpen {...iconProps} />,
    Office: <ClipboardList {...iconProps} />,
    Logistics: <ArrowRightLeft {...iconProps} />,
    Sales: <UsersRound {...iconProps} />,
    Roadmap: <ChartNoAxesCombined {...iconProps} />,
    MasterData: <Boxes {...iconProps} />,
    System: <Settings {...iconProps} />,
  };
  return <span className="nav-icon">{icons[name]}</span>;
}

function DashboardIcon({ target }: { target: Section }) {
  const iconProps = { size: 22, strokeWidth: 1.8, 'aria-hidden': true as const };
  const icons: Record<Section, React.ReactNode> = {
    Home: <HomeIcon {...iconProps} />,
    Orders: <FileText {...iconProps} />,
    Exceptions: <CircleAlert {...iconProps} />,
    Production: <PackageCheck {...iconProps} />,
    Inventory: <Boxes {...iconProps} />,
    Pallets: <Grid3X3 {...iconProps} />,
    Shipments: <Truck {...iconProps} />,
    Trace: <ScanSearch {...iconProps} />,
    Reports: <ChartNoAxesCombined {...iconProps} />,
    Imports: <FolderOpen {...iconProps} />,
    Samples: <FlaskConical {...iconProps} />,
    Documents: <FolderOpen {...iconProps} />,
    Office: <ClipboardList {...iconProps} />,
    Logistics: <ArrowRightLeft {...iconProps} />,
    Sales: <UsersRound {...iconProps} />,
    Roadmap: <ChartNoAxesCombined {...iconProps} />,
    MasterData: <Boxes {...iconProps} />,
    System: <Settings {...iconProps} />,
  };
  return <span className={`dashboard-icon dashboard-icon-${target.toLowerCase()}`}>{icons[target]}</span>;
}

export default function Home() {
  const supabase = useMemo(() => createClient(), []);
  const [section, setSection] = useState<Section>('Home');
  const [state, setState] = useState<AppState>({ orders: seedOrders, pallets: seedPallets, reviewedExceptions: [], exceptionDecisions: {}, branding: defaultBranding, reports: [], users: defaultUsers, audit: [], inventory: [], samples: [], officeRecords: [], logistics: [], sales: [], conversations: defaultConversations, messages: [] });
  const [sharedMessaging, setSharedMessaging] = useState<SharedMessagingSnapshot | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [stagedOrders, setStagedOrders] = useState<StagedOrder[]>([]);
  const [stagedLines, setStagedLines] = useState<StagedLine[]>([]);
  const [stagedExceptions, setStagedExceptions] = useState<StagedException[]>([]);
  const [operationalOrders, setOperationalOrders] = useState<OperationalOrder[]>([]);
  const [productionCases, setProductionCases] = useState<ProductionCase[]>([]);
  const [productionLots, setProductionLots] = useState<ProductionLot[]>([]);
  const [operationalPallets, setOperationalPallets] = useState<OperationalPallet[]>([]);
  const [palletCaseAssignments, setPalletCaseAssignments] = useState<PalletCaseAssignment[]>([]);
  const [palletActivities, setPalletActivities] = useState<PalletActivity[]>([]);
  const [selectedProductionOrderId, setSelectedProductionOrderId] = useState('');
  const [selectedStagedOrderId, setSelectedStagedOrderId] = useState('');
  const [selectedPalletId, setSelectedPalletId] = useState('');
  const [stagingLoaded, setStagingLoaded] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authPending, setAuthPending] = useState(false);
  const [passwordRecoveryOpen, setPasswordRecoveryOpen] = useState(false);
  const [passwordRecoveryMessage, setPasswordRecoveryMessage] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string>('thread-team');
  const [messageText, setMessageText] = useState('');
  const [forwardingMessageId, setForwardingMessageId] = useState<string>('');
  const [forwardTargetThreadId, setForwardTargetThreadId] = useState<string>('thread-team');
  const [notice, setNotice] = useState<Notice>(null);
  const [selectedOrderId, setSelectedOrderId] = useState(seedOrders[0]?.id || '');
  const [scanValue, setScanValue] = useState('');
  const [scanCode, setScanCode] = useState('');
  const [scanItem, setScanItem] = useState('');
  const brandButton = useRef<HTMLButtonElement>(null);
  const mobileDrawer = useRef<HTMLElement>(null);
  const [navigationRestored, setNavigationRestored] = useState(false);

  function setWorkspaceSection(nextSection: Section, source: string) {
    if (profile && !roleSections[profile.role].includes(nextSection)) {
      nextSection = 'Home';
      source = 'restricted local-only workspace';
    }
    setSection(currentSection => {
      if (process.env.NODE_ENV === 'development' && currentSection !== nextSection) {
        console.info('[navigation] view change', {
          previousView: currentSection,
          nextView: nextSection,
          source,
        });
      }
      return nextSection;
    });
  }

  useEffect(() => {
    const restoreNavigation = () => {
      const params = new URLSearchParams(window.location.search);
      const view = params.get('view');
      const validSections: Section[] = ['Home', 'Orders', 'Exceptions', 'Production', 'Inventory', 'Pallets', 'Shipments', 'Trace', 'Reports', 'Imports', 'MasterData', 'System'];
      if (view === 'order-review') setWorkspaceSection('Exceptions', 'url restore');
      else if (view === 'PalletBreakdown') setWorkspaceSection('Pallets', 'url restore');
      else if (view && validSections.includes(view as Section)) setWorkspaceSection(view as Section, 'url restore');
      const stagedOrderId = params.get('order');
      const productionOrderId = params.get('productionOrder');
      const palletId = params.get('pallet');
      if (stagedOrderId) setSelectedStagedOrderId(stagedOrderId);
      if (productionOrderId) setSelectedProductionOrderId(productionOrderId);
      if (palletId) setSelectedPalletId(palletId);
      setNavigationRestored(true);
    };
    restoreNavigation();
    window.addEventListener('popstate', restoreNavigation);
    return () => window.removeEventListener('popstate', restoreNavigation);
  }, []);

  useEffect(() => {
    // Do not let the initial Home state overwrite a deep link before it is restored.
    if (!navigationRestored) return;
    const url = new URL(window.location.href);
    const view = section === 'Exceptions' ? 'order-review' : section === 'Pallets' ? 'PalletBreakdown' : section;
    url.searchParams.set('view', view);
    if (selectedStagedOrderId) url.searchParams.set('order', selectedStagedOrderId);
    else url.searchParams.delete('order');
    if (selectedProductionOrderId) url.searchParams.set('productionOrder', selectedProductionOrderId);
    else url.searchParams.delete('productionOrder');
    if (selectedPalletId) url.searchParams.set('pallet', selectedPalletId);
    else url.searchParams.delete('pallet');
    window.history.replaceState(null, '', url);
  }, [navigationRestored, section, selectedPalletId, selectedStagedOrderId, selectedProductionOrderId]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFirst = () => mobileDrawer.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    const timer = window.setTimeout(focusFirst, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileNavOpen(false); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(mobileDrawer.current?.querySelectorAll<HTMLElement>(focusableSelector) || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
      brandButton.current?.focus();
    };
  }, [mobileNavOpen]);

  async function loadProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, organization_id, display_name, role, active')
      .eq('id', userId)
      .maybeSingle();

    const validRoles: Role[] = ['lucid_admin', 'leadership', 'office', 'production'];
    if (error || !data || !data.active || !validRoles.includes(data.role as Role)) {
      await supabase.auth.signOut();
      setProfile(null);
      setAuthError('Your Lucid Core account is not active. Contact an administrator.');
      setAuthLoading(false);
      return false;
    }

    setProfile(data as AuthProfile);
    setAuthError('');
    // TOKEN_REFRESHED and other non-null auth events are normal background work.
    // Preserve the URL-selected workspace instead of restarting the user at Home.
    setAuthLoading(false);
    return true;
  }

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      const { data } = await supabase.auth.getSession();
      if (data.session) await loadProfile(data.session.user.id);
      else if (active) setAuthLoading(false);
    }

    void restoreSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) void loadProfile(session.user.id);
      else if (active) {
        setProfile(null);
        setAuthLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function refreshSharedMessaging() {
    if (!profile) return;
    try {
      const next = await loadSharedMessaging(supabase, profile.organization_id);
      setSharedMessaging(next);
      setActiveThreadId(current => next.conversations.some(conversation => conversation.id === current) ? current : next.conversations[0]?.id || '');
    } catch {
      setSharedMessaging(null);
    }
  }

  useEffect(() => {
    const messagingProfile = profile;
    if (!messagingProfile) {
      setSharedMessaging(null);
      return;
    }
    const messagingOrganizationId = messagingProfile.organization_id;
    const messagingUserId = messagingProfile.id;
    let active = true;
    async function load() {
      try {
        const next = await loadSharedMessaging(supabase, messagingOrganizationId);
        if (!active) return;
        setSharedMessaging(next);
        setActiveThreadId(current => next.conversations.some(conversation => conversation.id === current) ? current : next.conversations[0]?.id || '');
      } catch {
        if (active) setSharedMessaging(null);
      }
    }
    void load();
    const channel = supabase
      .channel(`lucid-messaging:${messagingUserId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => { void load(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reads' }, () => { void load(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_reads' }, () => { void load(); })
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [supabase, profile]);

  async function refreshStaging() {
    if (!profile) return;
    setStagingLoaded(false);
    const [ordersResult, linesResult, exceptionsResult, profilesResult, operationalOrdersResult, palletsResult, palletAuditResult] = await Promise.all([
      supabase.from('sps_staged_orders').select('id, source_file, source_path, external_po, trading_partner_id, po_date, requested_ship_date, source_customer_name, source_ship_to_name, source_ship_to_code, mapping_status, review_status, promoted_order_id, created_at').eq('organization_id', profile.organization_id).order('created_at', { ascending: false }),
      supabase.from('sps_staged_order_lines').select('id, staged_order_id, line_number, buyer_part_number, vendor_item, gtin, description, quantity, sps_uom, sps_purchase_price, mapped_food_connex_item_number, approved_circle_r_price, item_mapping_status, price_status, uom_status').eq('organization_id', profile.organization_id),
      supabase.from('sps_order_exceptions').select('id, staged_order_id, staged_order_line_id, exception_code, severity, field_name, message, suggested_actions, status, details, resolution_action, resolved_at, resolved_by').eq('organization_id', profile.organization_id),
      supabase.from('profiles').select('id, display_name').eq('organization_id', profile.organization_id),
      supabase.from('orders').select('id, external_po, customer, ship_to, customer_id, ship_to_id, source, source_system, requested_ship_date, requested_delivery_date, ordered_weight_lb, status, food_connex_order, created_at, customers(name), customer_ship_tos(name, location_code)').eq('organization_id', profile.organization_id).in('status', ['ready_for_production', 'in_production', 'production_complete']).order('promoted_at', { ascending: false }),
      supabase.from('pallets').select('id, order_id, pallet_identifier, status, created_at, created_by, completed_at, completed_by, original_completed_at, original_completed_by, reopened_at, reopened_by, reopen_reason').eq('organization_id', profile.organization_id).order('created_at', { ascending: false }),
      supabase.from('audit_events').select('id, actor_id, action, entity_id, details, created_at').eq('organization_id', profile.organization_id).eq('entity_type', 'pallet').order('created_at', { ascending: false }).limit(200),
    ]);
    if (!ordersResult.error) {
      const orders = (ordersResult.data || []) as StagedOrder[];
      setStagedOrders(orders); setSelectedStagedOrderId(current => current || orders[0]?.id || '');
    }
    if (!linesResult.error) setStagedLines((linesResult.data || []) as StagedLine[]);
    if (!exceptionsResult.error) {
      const names = new Map((profilesResult.data || []).map(person => [person.id, person.display_name]));
      setStagedExceptions((exceptionsResult.data || []).map(exception => ({ ...exception, resolved_by_name: exception.resolved_by ? names.get(exception.resolved_by) || null : null })) as StagedException[]);
    }
    if (!operationalOrdersResult.error) {
      const operationalRows = operationalOrdersResult.data || [];
      const operationalOrderIds = operationalRows.map(order => order.id);
      const [operationalLinesResult, productionCasesResult, productionLotsResult] = operationalOrderIds.length
        ? await Promise.all([
          supabase.from('order_lines').select('id, order_id, item_id, external_sku, vendor_item, internal_item_id, description, quantity_cases, unit_price, uom, gtin, lot_code, items(item_code, description, stock_uom, sell_uom, item_identifiers(identifier_type, identifier_value, is_primary, verified, status))').in('order_id', operationalOrderIds),
          supabase.from('production_cases').select('id, order_id, order_line_id, production_lot_id, production_run_id, output_inventory_lot_id, pallet_id, case_identifier, quantity, net_weight, net_weight_uom, uom, status, produced_at, voided_at, void_reason, label_printed_at, label_print_count, production_lots(lot_code)').in('order_id', operationalOrderIds).order('created_at', { ascending: false }),
          supabase.from('production_lots').select('id, organization_id, order_id, order_line_id, lot_code, status, created_at').in('order_id', operationalOrderIds).eq('status', 'active').order('created_at', { ascending: false }),
        ])
        : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];

      if (!operationalLinesResult.error) {
        const linesByOrder = new Map<string, typeof operationalLinesResult.data>();
        for (const line of operationalLinesResult.data || []) {
          const lines = linesByOrder.get(line.order_id) || [];
          lines.push(line);
          linesByOrder.set(line.order_id, lines);
        }
        setOperationalOrders(operationalRows.map(order => {
          const nativeCustomer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
          const nativeShipTo = Array.isArray(order.customer_ship_tos) ? order.customer_ship_tos[0] : order.customer_ship_tos;
          return ({
          id: order.id,
          externalPo: order.external_po,
          customer: nativeCustomer?.name || order.customer || 'Customer not specified',
          shipTo: nativeShipTo ? [nativeShipTo.location_code, nativeShipTo.name].filter(Boolean).join(' · ') : order.ship_to || 'Destination not specified',
          requestedShipDate: order.requested_ship_date || undefined,
          requestedDeliveryDate: order.requested_delivery_date || undefined,
          orderDate: order.created_at || undefined,
          orderedWeightLb: order.ordered_weight_lb == null ? undefined : Number(order.ordered_weight_lb),
          source: order.source?.toLowerCase() === 'sps' ? 'SPS' : 'Other',
          sourceSystem: order.source_system || 'lucid_core',
          foodConnexOrder: order.food_connex_order || undefined,
          status: 'production',
          operationalStatus: order.status,
          lines: (linesByOrder.get(order.id) || []).map(line => {
            const nativeItem = Array.isArray(line.items) ? line.items[0] : line.items;
            const identifiers = Array.isArray(nativeItem?.item_identifiers) ? nativeItem.item_identifiers : [];
            const verifiedPrimaryGtin = identifiers.find((identifier: { identifier_type?: string; identifier_value?: string; is_primary?: boolean; verified?: boolean; status?: string }) =>
              identifier.is_primary && identifier.verified && identifier.status === 'active' && ['gtin', 'upc'].includes(identifier.identifier_type || ''),
            )?.identifier_value || null;
            return {
              id: line.id,
              nativeItemId: line.item_id || null,
              externalSku: line.external_sku || '',
              vendorItem: line.vendor_item || undefined,
              internalItemId: nativeItem?.item_code || line.internal_item_id || undefined,
              description: nativeItem?.description || line.description,
              quantityCases: Number(line.quantity_cases),
              unitPrice: line.unit_price == null ? undefined : Number(line.unit_price),
              uom: nativeItem?.stock_uom || nativeItem?.sell_uom || line.uom || '',
              // Only a verified primary native identifier is label-authoritative.
              gtin: verifiedPrimaryGtin,
              lotCode: line.lot_code || null,
            };
          }),
        });
        }));
      }
      if (!productionCasesResult.error) setProductionCases((productionCasesResult.data || []).map(productionCase => {
        const joinedLot = productionCase.production_lots as unknown as { lot_code?: string | null } | { lot_code?: string | null }[] | null;
        return {
          ...productionCase,
          lot_code: Array.isArray(joinedLot) ? joinedLot[0]?.lot_code || null : joinedLot?.lot_code || null,
          quantity: Number(productionCase.quantity),
          net_weight: productionCase.net_weight == null ? null : Number(productionCase.net_weight),
          label_print_count: Number(productionCase.label_print_count || 0),
        };
      }) as ProductionCase[]);
      if (!productionLotsResult.error) setProductionLots((productionLotsResult.data || []) as ProductionLot[]);
    }
    if (!palletsResult.error) {
      const names = new Map((profilesResult.data || []).map(person => [person.id, person.display_name]));
      const pallets = (palletsResult.data || []).map(pallet => ({
        ...pallet,
        pallet_identifier: pallet.pallet_identifier || 'Pallet',
        created_by_name: pallet.created_by ? names.get(pallet.created_by) || null : null,
        completed_by_name: pallet.completed_by ? names.get(pallet.completed_by) || null : null,
        original_completed_by_name: pallet.original_completed_by ? names.get(pallet.original_completed_by) || null : null,
        reopened_by_name: pallet.reopened_by ? names.get(pallet.reopened_by) || null : null,
      })) as OperationalPallet[];
      setOperationalPallets(pallets);
      const palletIds = pallets.map(pallet => pallet.id);
      if (palletIds.length) {
        const [legacyAssignmentsResult, durableAssignmentsResult] = await Promise.all([
          supabase.from('pallet_cases').select('id, pallet_id, production_case_id').in('pallet_id', palletIds),
          supabase.from('pallet_case_assignments').select('id, pallet_id, production_case_id, status').in('pallet_id', palletIds),
        ]);
        if (!legacyAssignmentsResult.error || !durableAssignmentsResult.error) {
          const assignments = new Map<string, PalletCaseAssignment>();
          for (const assignment of legacyAssignmentsResult.data || []) {
            if (assignment.production_case_id) assignments.set(`${assignment.pallet_id}:${assignment.production_case_id}`, { ...assignment, status: 'active' });
          }
          // Durable assignments retain removal history and take precedence over the legacy live join.
          for (const assignment of durableAssignmentsResult.data || []) {
            if (assignment.production_case_id) assignments.set(`${assignment.pallet_id}:${assignment.production_case_id}`, assignment as PalletCaseAssignment);
          }
          setPalletCaseAssignments(Array.from(assignments.values()));
        }
      } else {
        setPalletCaseAssignments([]);
      }
    }
    if (!palletAuditResult.error) {
      const names = new Map((profilesResult.data || []).map(person => [person.id, person.display_name]));
      setPalletActivities((palletAuditResult.data || []).map(event => ({
        id: String(event.id),
        pallet_id: event.entity_id || '',
        action: event.action,
        actor_name: event.actor_id ? names.get(event.actor_id) || 'A team member' : 'Lucid Core',
        created_at: event.created_at,
        details: event.details,
      })) as PalletActivity[]);
    }
    // A failed query is not proof that a URL-selected record is missing.
    setStagingLoaded(!ordersResult.error && !operationalOrdersResult.error);
  }

  const profileRefreshUserId = profile?.id ?? null;
  const profileRefreshOrganizationId = profile?.organization_id ?? null;
  useEffect(() => {
    if (!profileRefreshUserId || !profileRefreshOrganizationId) {
      setStagingLoaded(false);
      return;
    }
    const refreshInPlace = () => { void refreshStaging(); };
    refreshInPlace();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshInPlace();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [profileRefreshUserId, profileRefreshOrganizationId]);

  useEffect(() => {
    if (!profile || !stagingLoaded) return;

    if (section === 'Exceptions' && selectedStagedOrderId && !stagedOrders.some(order => order.id === selectedStagedOrderId)) {
      setSelectedStagedOrderId('');
      setWorkspaceSection('Home', 'confirmed missing staged order');
      return;
    }

    if (section === 'Production' && selectedProductionOrderId && !operationalOrders.some(order => order.id === selectedProductionOrderId)) {
      setSelectedProductionOrderId('');
      setWorkspaceSection('Home', 'confirmed missing production order');
      return;
    }

    if (section === 'Pallets' && selectedPalletId && !operationalPallets.some(pallet => pallet.id === selectedPalletId)) {
      setSelectedPalletId('');
      setWorkspaceSection('Home', 'confirmed missing pallet');
    }
  }, [operationalOrders, operationalPallets, profile, section, selectedPalletId, selectedProductionOrderId, selectedStagedOrderId, stagedOrders, stagingLoaded]);

  const role = profile?.role || 'office';
  const currentUserId = profile?.id || '';
  const visibleSections = roleSections[role];
  useEffect(() => {
    if (profile && !visibleSections.includes(section)) setWorkspaceSection('Home', 'restricted local-only workspace');
  }, [profile, section, visibleSections]);
  const mobileNavigationGroups = [
    { label: 'Operations', sections: ['Home','Orders','Exceptions','Production','Inventory','Pallets','Shipments','Trace','Reports'] as Section[] },
    { label: 'Management', sections: ['MasterData','Imports','System'] as Section[] },
  ];
  const mobilePrimarySections: Record<Role, Section[]> = {
    office: ['Home', 'Orders', 'Exceptions', 'Shipments'],
    production: ['Home', 'Production', 'Inventory', 'Pallets'],
        leadership: ['Home', 'Orders', 'Reports'],
    lucid_admin: ['Home', 'Orders', 'System'],
  };
  const mobileBottomSections = mobilePrimarySections[role].filter(item => visibleSections.includes(item));
  const activeOrders = profile ? operationalOrders : state.orders;
  const allIssues = useMemo(() => activeOrders.flatMap(order => orderIssues(order).map(issue => ({ order, issue }))), [activeOrders]);
  const unresolvedIssues = allIssues.filter(x => !state.reviewedExceptions.includes(`${x.order.id}:${x.issue.message}`));
  const selectedOrder = state.orders.find(o => o.id === selectedOrderId) || state.orders[0];
  const buildingPallets = state.pallets.filter(p => p.status === 'building');
  const selectedStagedOrder = stagedOrders.find(order => order.id === selectedStagedOrderId) || stagedOrders[0];
  const activeStagedOrders = stagedOrders.filter(order => order.review_status !== 'promoted' && !order.promoted_order_id);
  const stagingReviewOrders = activeStagedOrders.filter(order => order.review_status === 'needs_review');
  const stagingReviewCount = stagingReviewOrders.length;
  const stagingReadyCount = activeStagedOrders.filter(order => order.review_status === 'ready').length;
  const nextStagedReview = stagingReviewOrders[0];
  const nextStagedException = nextStagedReview ? stagedExceptions.find(exception => exception.staged_order_id === nextStagedReview.id && exception.status === 'open') : undefined;
  const selectedProductionOrder = operationalOrders.find(order => order.id === selectedProductionOrderId);
  const selectedOperationalPallet = operationalPallets.find(pallet => pallet.id === selectedPalletId);

  const currentUser = profile ? { id: profile.id, name: profile.display_name, role: profile.role, active: profile.active } : undefined;
  const messaging = sharedMessaging || { conversations: state.conversations, messages: state.messages, users: state.users };
  const currentThreads = messaging.conversations.filter(t => t.kind === 'group' || t.participantIds.includes(currentUserId));
  const unreadMessages = messaging.messages.filter(m => m.fromUserId !== currentUserId && !m.readBy.includes(currentUserId) && currentThreads.some(t => t.id === m.threadId));
  const activeThread = currentThreads.find(t => t.id === activeThreadId) || currentThreads[0];
  const activeThreadMessages = messaging.messages.filter(m => m.threadId === activeThread?.id).slice().sort((a,b)=>a.createdAt.localeCompare(b.createdAt));

  function directThreadId(a:string,b:string){ return `thread-direct-${[a,b].sort().join('-')}`; }
  function threadDisplayName(thread:ConversationRecord){
    if(thread.kind==='group') return thread.name;
    const other=thread.participantIds.find(id=>id!==currentUserId);
    return messaging.users.find(u=>u.id===other)?.name || 'Private chat';
  }
  async function ensureDirectThread(userId:string){
    if(!currentUserId || userId===currentUserId) return '';
    if (sharedMessaging) {
      try {
        const id = await createDirectConversation(supabase, userId);
        await refreshSharedMessaging();
        setActiveThreadId(id);
        return id;
      } catch {
        setNotice({ tone: 'warning', message: 'Unable to start this conversation. Please try again.' });
        return '';
      }
    }
    const id=directThreadId(currentUserId,userId);
    if(!state.conversations.some(t=>t.id===id)){
      const now=new Date().toISOString();
      const other=state.users.find(u=>u.id===userId)?.name || 'Team member';
      setState(prev=>({...prev,conversations:[...prev.conversations,{id,kind:'direct',name:other,participantIds:[currentUserId,userId],createdAt:now,updatedAt:now}]}));
    }
    setActiveThreadId(id); return id;
  }
  async function sendMessage() {
    const body = messageText.trim();
    if (!body || !currentUserId || !activeThread) return;
    if (sharedMessaging) {
      try {
        await sendSharedMessage(supabase, activeThread.id, currentUserId, body);
        setMessageText('');
        await refreshSharedMessaging();
      } catch {
        setNotice({ tone: 'warning', message: 'Unable to send your message. Please try again.' });
      }
      return;
    }
    const now=new Date().toISOString();
    const msg: MessageRecord = { id:`msg-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, threadId:activeThread.id, fromUserId:currentUserId, body, createdAt:now, readBy:[currentUserId] };
    setState(prev => ({ ...prev, messages:[...prev.messages, msg], conversations:prev.conversations.map(t=>t.id===activeThread.id?{...t,updatedAt:now}:t) }));
    setMessageText('');
  }
  async function markThreadRead(threadId:string) {
    if (!currentUserId) return;
    if (sharedMessaging) {
      try {
        await markSharedMessagesRead(supabase, messaging.messages.filter(message => message.threadId === threadId), currentUserId);
        await refreshSharedMessaging();
      } catch { /* Keep the thread usable if a read receipt cannot be recorded. */ }
      return;
    }
    setState(prev => ({ ...prev, messages: prev.messages.map(m => m.threadId===threadId && m.fromUserId !== currentUserId && !m.readBy.includes(currentUserId) ? { ...m, readBy:[...m.readBy,currentUserId] } : m) }));
  }
  function openThread(threadId:string){ setActiveThreadId(threadId); setMobileThreadOpen(true); void markThreadRead(threadId); }
  async function forwardMessage(messageId:string,targetThreadId:string){
    const original=messaging.messages.find(m=>m.id===messageId); if(!original || !currentUserId) return;
    if (sharedMessaging) {
      try {
        await sendSharedMessage(supabase, targetThreadId, currentUserId, original.body, original.id);
        setForwardingMessageId(''); setActiveThreadId(targetThreadId); setNotice({tone:'success',message:'Message forwarded.'});
        await refreshSharedMessaging();
      } catch {
        setNotice({ tone: 'warning', message: 'Unable to forward this message. Please try again.' });
      }
      return;
    }
    const now=new Date().toISOString();
    const msg:MessageRecord={id:`msg-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,threadId:targetThreadId,fromUserId:currentUserId,body:original.body,createdAt:now,readBy:[currentUserId],forwardedFromId:original.id,forwardedByUserId:currentUserId};
    setState(prev=>({...prev,messages:[...prev.messages,msg],conversations:prev.conversations.map(t=>t.id===targetThreadId?{...t,updatedAt:now}:t)}));
    setForwardingMessageId(''); setActiveThreadId(targetThreadId); setNotice({tone:'success',message:'Message forwarded.'});
  }
  function openMessages(threadId?:string) { setMessagesOpen(true); setNotificationsOpen(false); setMobileThreadOpen(Boolean(threadId)); const id=threadId || activeThread?.id || currentThreads[0]?.id || 'thread-team'; setActiveThreadId(id); void markThreadRead(id); }
  function openNotifications() { setNotificationsOpen(true); setMessagesOpen(false); }
  function navigateToSection(nextSection: Section) { setWorkspaceSection(nextSection, 'mobile navigation'); setMobileNavOpen(false); }

  function audit(action: string, entity: string, detail: string) {
    const user = currentUser?.name || 'Prototype user';
    setState(prev => ({ ...prev, audit: [{ id: `audit-${Date.now()}-${Math.random()}`, at: new Date().toISOString(), user, action, entity, detail }, ...prev.audit].slice(0, 250) }));
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthPending(true);
    setAuthError('');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      setAuthError('Invalid email or password. Please try again.');
      setAuthPending(false);
      return;
    }
    await loadProfile(data.user.id);
    setAuthPending(false);
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthPending(true);
    setAuthError('');
    setPasswordRecoveryMessage('');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });
    if (error) {
      setAuthError('Unable to send a password reset email. Please try again.');
    } else {
      setPasswordRecoveryMessage('Check your email for a password reset link.');
    }
    setAuthPending(false);
  }

  async function logout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setNotice({ tone: 'warning', message: 'Unable to sign out. Please try again.' });
      return;
    }
    setProfile(null);
    setAccountOpen(false);
    setWorkspaceSection('Home', 'sign out');
  }

  function updateUser(userId: string, patch: Partial<UserRecord>) {
    setState(prev => ({ ...prev, users: prev.users.map(u => u.id === userId ? { ...u, ...patch } : u) }));
  }

  function addUser() {
    const id = `usr-${Date.now()}`;
    setState(prev => ({ ...prev, users: [...prev.users, { id, name: 'New user', username: `user${prev.users.length + 1}`, role: 'office', active: true }], conversations: prev.conversations.map(t => t.id === 'thread-team' ? { ...t, participantIds:[...new Set([...t.participantIds,id])] } : t) }));
    audit('User created', id, 'New prototype user added');
  }

  function deleteUser(userId:string){
    if(userId===currentUserId){setNotice({tone:'warning',message:'You cannot delete the account you are currently signed in with.'});return;}
    if(!window.confirm('Delete this user from Lucid Core?')) return;
    setState(prev=>({...prev,users:prev.users.filter(u=>u.id!==userId), conversations:prev.conversations.map(t=>({...t,participantIds:t.participantIds.filter(id=>id!==userId)})).filter(t=>t.kind==='group'||t.participantIds.length>1)}));
    audit('User deleted',userId,'User removed from Lucid Core access');
  }

  function updateOrder(orderId: string, next: UnifiedOrder) {
    setState(prev => ({ ...prev, orders: prev.orders.map(o => o.id === orderId ? next : o) }));
    audit('Order edited', `PO ${next.externalPo}`, 'Order header or line details corrected');
    setNotice({ tone: 'success', message: `PO ${next.externalPo} updated. Change recorded in the audit history.` });
  }

  function updateCase(palletId: string, caseId: string, patch: { scannedCode?: string; itemId?: string; description?: string; weightLb?: number }) {
    setState(prev => ({ ...prev, pallets: prev.pallets.map(p => {
      if (p.id !== palletId) return p;
      const cases = (p.cases || []).map(c => c.id === caseId ? { ...c, ...patch } : c);
      return { ...p, cases, caseCount: cases.length, weightLb: Math.round(cases.reduce((sum,c) => sum + (c.weightLb || 0), 0) * 100) / 100, itemCount: new Set(cases.map(c => c.itemId || c.description || 'unknown')).size };
    }) }));
    audit('Pallet case edited', palletId, `Case ${caseId} corrected`);
  }

  function deleteCase(palletId: string, caseId: string) {
    if (!window.confirm('Remove this case from the pallet breakdown?')) return;
    setState(prev => ({ ...prev, pallets: prev.pallets.map(p => {
      if (p.id !== palletId) return p;
      const cases = (p.cases || []).filter(c => c.id !== caseId);
      return { ...p, cases, caseCount: cases.length, weightLb: Math.round(cases.reduce((sum,c) => sum + (c.weightLb || 0), 0) * 100) / 100, itemCount: new Set(cases.map(c => c.itemId || c.description || 'unknown')).size };
    }) }));
    audit('Pallet case removed', palletId, `Case ${caseId} removed for correction`);
  }

  function reopenPallet(palletId: string) {
    setState(prev => ({ ...prev, pallets: prev.pallets.map(p => p.id === palletId ? { ...p, status: 'building', completedAt: undefined } : p) }));
    audit('Pallet reopened', palletId, 'Completed pallet reopened for correction');
    setNotice({ tone: 'info', message: 'Pallet reopened. Cases and weights can be corrected before shipment.' });
  }

  function deletePallet(palletId: string) {
    const pallet = state.pallets.find(p => p.id === palletId);
    if (!pallet) return;
    if (!window.confirm(`Remove ${pallet.label}? This removes it from the current Pallet Breakdown. The action will remain in the audit history.`)) return;
    setState(prev => ({ ...prev, pallets: prev.pallets.filter(p => p.id !== palletId) }));
    audit('Pallet removed', palletId, `${pallet.label} removed from Pallet Breakdown`);
    setNotice({ tone: 'info', message: `${pallet.label} removed. The deletion is retained in audit history.` });
  }

  function addInventory() { const id=`inv-${Date.now()}`; setState(p=>({...p,inventory:[{id,item:'New item',onHand:0,unit:'CS',updatedAt:new Date().toISOString()},...p.inventory]})); audit('Inventory record created',id,'New inventory record'); }
  function updateInventory(id:string,patch:Partial<InventoryRecord>){ setState(p=>({...p,inventory:p.inventory.map(x=>x.id===id?{...x,...patch,updatedAt:new Date().toISOString()}:x)})); }
  function removeInventory(id:string){ if(!window.confirm('Remove this inventory record?'))return; setState(p=>({...p,inventory:p.inventory.filter(x=>x.id!==id)})); audit('Inventory record removed',id,'Removed by user'); }
  function addSample(){const id=`sample-${Date.now()}`;setState(p=>({...p,samples:[{id,customer:'',item:'',type:'Sample',owner:'Crystal',status:'New'},...p.samples]}));}
  function updateSample(id:string,patch:Partial<SampleRecord>){setState(p=>({...p,samples:p.samples.map(x=>x.id===id?{...x,...patch}:x)}));}
  function removeSample(id:string){if(!window.confirm('Remove this sample / rebuild record?'))return;setState(p=>({...p,samples:p.samples.filter(x=>x.id!==id)}));}
  function addOffice(){const id=`office-${Date.now()}`;setState(p=>({...p,officeRecords:[{id,type:'Customer File',reference:'',party:'',status:'Received'},...p.officeRecords]}));}
  function updateOffice(id:string,patch:Partial<OfficeRecord>){setState(p=>({...p,officeRecords:p.officeRecords.map(x=>x.id===id?{...x,...patch}:x)}));}
  function removeOffice(id:string){if(!window.confirm('Remove this office record?'))return;setState(p=>({...p,officeRecords:p.officeRecords.filter(x=>x.id!==id)}));}
  function addLogistics(){const id=`log-${Date.now()}`;setState(p=>({...p,logistics:[{id,carrier:'',mode:'LTL',status:'Planning'},...p.logistics]}));}
  function updateLogistics(id:string,patch:Partial<LogisticsRecord>){setState(p=>({...p,logistics:p.logistics.map(x=>x.id===id?{...x,...patch}:x)}));}
  function removeLogistics(id:string){if(!window.confirm('Remove this logistics record?'))return;setState(p=>({...p,logistics:p.logistics.filter(x=>x.id!==id)}));}
  function addSales(){const id=`sales-${Date.now()}`;setState(p=>({...p,sales:[{id,company:'',source:'Food Show',nextStep:'Follow up',owner:'Crystal',status:'New'},...p.sales]}));}
  function updateSales(id:string,patch:Partial<SalesRecord>){setState(p=>({...p,sales:p.sales.map(x=>x.id===id?{...x,...patch}:x)}));}
  function removeSales(id:string){if(!window.confirm('Remove this follow-up record?'))return;setState(p=>({...p,sales:p.sales.filter(x=>x.id!==id)}));}

  function saveExceptionDecision(key: string, decision: ExceptionDecision) {
    setState(prev => ({ ...prev, exceptionDecisions: { ...prev.exceptionDecisions, [key]: decision } }));
    audit('Exception decision edited', key, `Verification updated using ${decision.source}`);
  }

  function reopenException(key: string) {
    setState(prev => ({ ...prev, reviewedExceptions: prev.reviewedExceptions.filter(k => k !== key) }));
    audit('Exception reopened', key, 'Previously reviewed exception reopened for correction');
  }

  function resolveException(orderId: string, message: string, decision: Omit<ExceptionDecision, 'reviewedAt'>) {
    const key = `${orderId}:${message}`;
    setState(prev => ({
      ...prev,
      reviewedExceptions: [...new Set([...prev.reviewedExceptions, key])],
      exceptionDecisions: { ...prev.exceptionDecisions, [key]: { ...decision, reviewedAt: new Date().toISOString() } },
    }));
    audit('Exception verified', key, `Verified using ${decision.source}`);
    setNotice({ tone: 'success', message: `Exception verified using ${decision.source}. No live SPS or Food Connex record was changed.` });
  }

  function createPallet() {
    if (!selectedOrder) return;
    const next = state.pallets.filter(p => p.orderId === selectedOrder.id).length + 1;
    const pallet: Pallet = { id: `plt-${Date.now()}`, orderId: selectedOrder.id, label: `Pallet ${next}`, caseCount: 0, weightLb: 0, itemCount: 0, status: 'building', cases: [] };
    setState(prev => ({ ...prev, pallets: [...prev.pallets, pallet] }));
    setNotice({ tone: 'success', message: `${pallet.label} started for PO ${selectedOrder.externalPo}.` });
  }

  function scanCase(palletId: string) {
    const weight = Number(scanValue) || 0;
    const item = selectedOrder?.lines.find(line => line.internalItemId === scanItem) || selectedOrder?.lines[0];
    const code = scanCode.trim() || `CASE-${Date.now().toString().slice(-6)}`;
    const captured = { id: `case-${Date.now()}`, scannedCode: code, weightLb: weight, itemId: item?.internalItemId, description: item?.description, scannedAt: new Date().toISOString() };
    setState(prev => ({ ...prev, pallets: prev.pallets.map(p => {
      if (p.id !== palletId) return p;
      const cases = [...(p.cases || []), captured];
      const itemCount = new Set(cases.map(c => c.itemId || c.description || 'unknown')).size;
      return { ...p, cases, caseCount: cases.length, weightLb: Math.round(cases.reduce((sum,c) => sum + (c.weightLb || 0), 0) * 100) / 100, itemCount };
    }) }));
    setScanValue(''); setScanCode('');
    setNotice({ tone: 'success', message: weight ? `Case ${code} captured with ${weight.toFixed(2)} lb.` : `Case ${code} captured. Weight can come from the scale connection later.` });
  }

  function completePallet(palletId: string) {
    setState(prev => ({ ...prev, pallets: prev.pallets.map(p => p.id === palletId ? { ...p, status: 'complete', completedAt: new Date().toISOString() } : p) }));
    audit('Pallet completed', palletId, 'Pallet marked complete for shipment rollup');
    setNotice({ tone: 'success', message: 'Pallet completed and ready for shipment rollup.' });
  }

  function buildStageReport(stage: ReportRecord['stage'], order?: UnifiedOrder, pallet?: Pallet, exceptionText?: string) {
    const pallets = order ? state.pallets.filter(p => p.orderId === order.id) : [];
    const titleBase = order ? `PO ${order.externalPo}` : state.branding.companyName;
    const meta = order ? `<div class="doc-meta"><div class="meta-cell"><small>Customer</small><strong>${escapeHtml(order.customer)}</strong></div><div class="meta-cell"><small>Ship To</small><strong>${escapeHtml(order.shipTo)}</strong></div><div class="meta-cell"><small>Ship Date</small><strong>${escapeHtml(order.requestedShipDate || '—')}</strong></div><div class="meta-cell"><small>Order No.</small><strong>${escapeHtml(order.foodConnexOrder || 'Pending')}</strong></div></div>` : '';
    const orderRows = (order?.lines || []).map((l,idx) => `<tr><td>${String(idx+1).padStart(4,'0')}</td><td>${escapeHtml(l.externalSku)}</td><td>${escapeHtml(l.internalItemId || '—')}</td><td>${escapeHtml(l.description)}</td><td class="num">${l.quantityCases}</td><td>${escapeHtml(l.uom)}</td><td class="num">${l.unitPrice != null ? '$'+l.unitPrice.toFixed(2) : '—'}</td></tr>`).join('');

    if (stage === 'Pallet' && pallet) {
      const caseGroups: Record<string,{desc:string,count:number,weight:number}> = {};
      for (const c of pallet.cases || []) { const key=c.itemId || c.description || 'Unassigned'; const g=caseGroups[key] ||= {desc:c.description || c.itemId || 'Unassigned',count:0,weight:0}; g.count += 1; g.weight += c.weightLb || 0; }
      const groupLines = Object.entries(caseGroups).map(([item,g])=>`<div class="pallet-line"><span class="check"></span><span class="write-line">${escapeHtml(item)} — ${g.count} CS</span><span class="write-line">${escapeHtml(g.desc)}${g.weight ? ` · ${g.weight.toFixed(2)} lb` : ''}</span></div>`).join('');
      const blanks = Array.from({length:Math.max(8,12-Object.keys(caseGroups).length)},()=>`<div class="pallet-line"><span class="check"></span><span class="write-line"></span><span class="write-line"></span></div>`).join('');
      const body = `${meta}<div class="doc-body pallet-form"><div class="pallet-title">Pallet Breakdown</div><div class="pallet-head"><div><span class="field-label">PO #</span><div class="lined-field">${escapeHtml(order?.externalPo || '')}</div></div><div><span class="field-label">Order Number</span><div class="lined-field">${escapeHtml(order?.foodConnexOrder || '')}</div></div></div><div class="pallet-line"><strong>Pallet #</strong><strong>Item / Quantity (Cases)</strong><strong>Item / Weight / Notes</strong></div>${groupLines}${blanks}<div style="margin-top:24px"><span class="field-label">Loaded By</span><div class="lined-field"></div></div><div class="premium-note">Digitally generated from Lucid Core. Layout intentionally mirrors Circle R's existing Pallet Breakdown so the floor team does not have to learn a new paper format.</div></div>`;
      return reportShell(`${pallet.label}`, `${state.branding.companyName} · ${state.branding.appName}`, body, 'PALLET BREAKDOWN');
    }

    if (stage === 'Shipment') {
      const totalWeight = pallets.reduce((sum,p)=>sum+p.weightLb,0); const totalCases = pallets.reduce((sum,p)=>sum+p.caseCount,0);
      const shipmentRows = (order?.lines || []).map((l,idx)=>`<tr><td>${String(idx+1).padStart(4,'0')}</td><td>${escapeHtml(order?.shipTo || '')}</td><td>${escapeHtml(`PLT-${idx+1}`)}</td><td>${escapeHtml(l.externalSku)}</td><td>${escapeHtml(l.internalItemId || '')}</td><td>${escapeHtml(l.description)}</td><td class="num">${l.quantityCases}</td><td>${escapeHtml(l.uom)}</td></tr>`).join('');
      const body = `${meta}<div class="doc-body"><div class="form-grid"><div class="form-box"><span class="field-label">Ship Notice #</span><strong>ASN-${escapeHtml(order?.externalPo || '')}</strong></div><div class="form-box"><span class="field-label">PO #</span><strong>${escapeHtml(order?.externalPo || '')}</strong></div><div class="form-box"><span class="field-label">Pallets</span><strong>${pallets.length}</strong></div><div class="form-box"><span class="field-label">Actual Weight</span><strong>${totalWeight.toFixed(2)} lb</strong></div></div><div class="section-title">Shipment Detail</div><table class="sps-table"><thead><tr><th>Line #</th><th>Location</th><th>Container ID</th><th>SKU</th><th>Vendor PN</th><th>Description</th><th>Qty Shipped</th><th>UOM</th></tr></thead><tbody>${shipmentRows}</tbody></table><div class="summary-row"><div><small>Total Cases</small><strong>${totalCases}</strong></div><div><small>Actual Weight</small><strong>${totalWeight.toFixed(2)} lb</strong></div><div><small>Expected Weight</small><strong>${order?.orderedWeightLb ? order.orderedWeightLb.toFixed(2)+' lb':'—'}</strong></div><div><small>Status</small><strong>${pallets.length && pallets.every(p=>p.status==='complete')?'Ready':'In Progress'}</strong></div></div><div class="premium-note">Designed to follow the field order and density of the SPS Advance Ship Notice Circle R already uses, while using Lucid Core's cleaner print styling.</div></div>`;
      return reportShell(`${titleBase}`, `${state.branding.companyName} · ${state.branding.appName}`, body, 'ADVANCE SHIP NOTICE');
    }

    if (stage === 'Order' || stage === 'Production') {
      const label = stage === 'Production' ? 'PICKING / PRODUCTION' : 'ORDER / PURCHASE ORDER';
      const body = `${meta}<div class="doc-body"><div class="section-title">Order Detail</div><table class="sps-table"><thead><tr><th>Line</th><th>SKU</th><th>Vendor PN</th><th>Description</th><th>Qty</th><th>UOM</th><th>Unit Price</th></tr></thead><tbody>${orderRows}</tbody></table><div class="signature-row"><div class="signature">Prepared / Picked By</div><div class="signature">Verified By</div></div></div>`;
      return reportShell(`${titleBase}`, `${state.branding.companyName} · ${state.branding.appName}`, body, label);
    }

    if (stage === 'Exception') {
      const body = `${meta}<div class="doc-body"><div class="section-title">Order Review / Price Verification</div><div class="premium-note"><strong>Reason for review:</strong> ${escapeHtml(exceptionText || 'Review required')}</div><div class="form-grid"><div class="form-box"><span class="field-label">Verified Against</span><strong>____________________</strong></div><div class="form-box"><span class="field-label">Approved Price</span><strong>____________________</strong></div><div class="form-box"><span class="field-label">Reference Weight</span><strong>____________________</strong></div><div class="form-box"><span class="field-label">Reviewed By</span><strong>____________________</strong></div></div><div class="section-title">Notes</div><div style="height:90px;border:1px solid #bbb"></div></div>`;
      return reportShell(`${titleBase}`, `${state.branding.companyName} · ${state.branding.appName}`, body, 'ORDER REVIEW');
    }

    const totalWeight = pallets.reduce((sum,p)=>sum+p.weightLb,0); const totalCases = pallets.reduce((sum,p)=>sum+p.caseCount,0);
    const body = `${meta}<div class="doc-body"><div class="section-title">Order Lines</div><table class="sps-table"><thead><tr><th>Line</th><th>SKU</th><th>Vendor PN</th><th>Description</th><th>Qty</th><th>UOM</th><th>Unit Price</th></tr></thead><tbody>${orderRows}</tbody></table><div class="section-title">Pallet Breakdown / Advance Ship Notice Summary</div><div class="summary-row"><div><small>Pallets</small><strong>${pallets.length}</strong></div><div><small>Cases Palletized</small><strong>${totalCases}</strong></div><div><small>Actual Weight</small><strong>${totalWeight.toFixed(2)} lb</strong></div><div><small>Expected Weight</small><strong>${order?.orderedWeightLb ? order.orderedWeightLb.toFixed(2)+' lb':'—'}</strong></div></div><table class="sps-table"><thead><tr><th>Pallet</th><th>Status</th><th>Cases</th><th>Weight</th></tr></thead><tbody>${pallets.map(p=>`<tr><td>${escapeHtml(p.label)}</td><td>${escapeHtml(p.status)}</td><td>${p.caseCount}</td><td>${p.weightLb.toFixed(2)} lb</td></tr>`).join('')}</tbody></table></div>`;
    return reportShell(`${titleBase}`, `${state.branding.companyName} · ${state.branding.appName}`, body, 'CUSTOMER ORDER PACKET');
  }

  function buildFamiliarTemplate(kind: 'Pallet Breakdown'|'Advance Ship Notice'|'Bill of Lading'|'Weight Report', order?: UnifiedOrder) {
    const target = order || selectedOrder;
    if (!target) return '';
    const pallets = state.pallets.filter(p=>p.orderId===target.id);
    if (kind === 'Pallet Breakdown') {
      const p = pallets[0] || {id:'blank',orderId:target.id,label:'Pallet 1',caseCount:0,weightLb:0,itemCount:0,status:'building',cases:[]} as Pallet;
      return buildStageReport('Pallet',target,p);
    }
    if (kind === 'Advance Ship Notice') return buildStageReport('Shipment',target);
    if (kind === 'Weight Report') {
      const rows=(pallets.flatMap(p=>p.cases||[])).map((c,idx)=>`<tr><td>${idx+1}</td><td>${escapeHtml(c.itemId||'')}</td><td>${escapeHtml(c.description||'')}</td><td>${escapeHtml(c.scannedCode||'')}</td><td class="num">${c.weightLb?c.weightLb.toFixed(2):''}</td><td>${escapeHtml(c.scannedAt?new Date(c.scannedAt).toLocaleDateString():'')}</td></tr>`).join('');
      const body=`<div class="doc-meta"><div class="meta-cell"><small>Customer</small><strong>${escapeHtml(target.customer)}</strong></div><div class="meta-cell"><small>PO #</small><strong>${escapeHtml(target.externalPo)}</strong></div><div class="meta-cell"><small>Order #</small><strong>${escapeHtml(target.foodConnexOrder||'')}</strong></div><div class="meta-cell"><small>Ship Date</small><strong>${escapeHtml(target.requestedShipDate||'')}</strong></div></div><div class="doc-body"><div class="section-title">Detailed Case Weights</div><table class="sps-table"><thead><tr><th>#</th><th>Item</th><th>Description</th><th>Case / Label</th><th>Weight</th><th>Date</th></tr></thead><tbody>${rows||'<tr><td colspan="6">No case weights captured yet.</td></tr>'}</tbody></table></div>`;
      return reportShell(`PO ${target.externalPo}`,`${state.branding.companyName} · ${state.branding.appName}`,body,'WEIGHT REPORT');
    }
    const totalWeight=pallets.reduce((n,p)=>n+p.weightLb,0); const totalCases=pallets.reduce((n,p)=>n+p.caseCount,0);
    const body=`<div class="doc-meta"><div class="meta-cell"><small>Ship From</small><strong>${escapeHtml(state.branding.companyName)}</strong></div><div class="meta-cell"><small>Ship To</small><strong>${escapeHtml(target.customer)} · ${escapeHtml(target.shipTo)}</strong></div><div class="meta-cell"><small>PO #</small><strong>${escapeHtml(target.externalPo)}</strong></div><div class="meta-cell"><small>BOL #</small><strong>________________</strong></div></div><div class="doc-body"><div class="section-title">Handling Units / Commodities</div><table class="sps-table"><thead><tr><th>Handling Units</th><th>Packages</th><th>Description</th><th>Weight</th></tr></thead><tbody><tr><td>${pallets.length}</td><td>${totalCases}</td><td>Food products · See attached Pallet Breakdown</td><td>${totalWeight.toFixed(2)} lb</td></tr></tbody></table><div class="signature-row"><div class="signature">Carrier / Driver</div><div class="signature">Shipper Signature</div></div></div>`;
    return reportShell(`PO ${target.externalPo}`,`${state.branding.companyName} · ${state.branding.appName}`,body,'STRAIGHT BILL OF LADING');
  }

  function saveReport(stage: ReportRecord['stage'], order?: UnifiedOrder, pallet?: Pallet, exceptionText?: string, download = true) {
    const html = buildStageReport(stage, order, pallet, exceptionText);
    const title = `${order ? `PO ${order.externalPo}` : state.branding.companyName} — ${stage} Report`;
    const record: ReportRecord = { id: `report-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, orderId: order?.id, po: order?.externalPo, stage, title, createdAt: new Date().toISOString(), html, sharePointStatus: 'Ready to sync', suggestedPath: suggestedSharePointPath(order) };
    setState(prev => ({ ...prev, reports: [record, ...prev.reports.filter(r => !(r.po === record.po && r.stage === record.stage && stage !== 'Pallet'))] }));
    if (download) downloadHtml(`${(order?.externalPo || 'circle-r').replace(/[^a-z0-9-]/gi,'_')}-${stage.toLowerCase().replace(/ /g,'-')}-report.html`, html);
    setNotice({ tone: 'success', message: `${stage} report generated. It is also listed under Documents for future SharePoint sync.` });
  }

  function printStage(stage: ReportRecord['stage'], order?: UnifiedOrder, pallet?: Pallet, exceptionText?: string) {
    const html = buildStageReport(stage, order, pallet, exceptionText);
    const opened = printHtml(html);
    if (!opened) setNotice({ tone: 'warning', message: 'The browser blocked the print window. Allow pop-ups for localhost and try again.' });
  }

  function queueReport(reportId: string) {
    setState(prev => ({ ...prev, reports: prev.reports.map(r => r.id === reportId ? { ...r, sharePointStatus: 'Queued' } : r) }));
    setNotice({ tone: 'info', message: 'Report marked as queued. It will sync automatically once the SharePoint connector is configured.' });
  }

  const homeCards = role === 'production'
    ? [
        { value: activeOrders.length, label: 'Orders to work', hint: 'Open production queue', target: 'Production' as Section },
        { value: buildingPallets.length, label: 'Pallets in progress', hint: 'Continue scanning', target: 'Pallets' as Section },
      ]
    : role === 'leadership'
    ? [
        { value: activeOrders.length, label: 'Active orders', hint: 'View current activity', target: 'Orders' as Section },
        { value: unresolvedIssues.length, label: 'Needs attention', hint: unresolvedIssues.length ? 'Team review required' : 'Nothing blocked', target: 'Orders' as Section },
        { value: state.pallets.filter(p => p.status === 'complete').length, label: 'Pallets ready', hint: 'Shipping progress', target: 'Shipments' as Section },
      ]
    : [
        { value: activeStagedOrders.length, label: 'Orders', hint: 'SPS staging queue', target: 'Orders' as Section },
        { value: stagingReviewCount, label: 'Needs review', hint: 'Open staged exceptions', target: 'Exceptions' as Section },
        { value: stagingReadyCount, label: 'Ready', hint: 'Staged orders ready for approval', target: 'Orders' as Section },
      ];

  async function importSandboxOrders() {
    setNotice({ tone: 'info', message: 'Importing SPS Sandbox purchase orders…' });
    const response = await fetch('/api/sps/import-new-sandbox-pos');
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) setNotice({ tone: 'warning', message: result?.error || 'Sandbox import could not be completed.' });
    else { await refreshStaging(); setNotice({ tone: 'success', message: `Sandbox import complete: ${result.importedCount} new order(s).` }); }
  }

  if (authLoading) {
    return <div className="login-shell"><div className="login-card" aria-busy="true">
      <div className="login-brand">{state.branding.logoDataUrl ? <img src={state.branding.logoDataUrl} alt="Company logo" /> : <span>LC</span>}<div><strong>{state.branding.appName}</strong><small>{state.branding.companyName}</small></div></div>
      <span className="kicker">Secure staff access</span><h1>Restoring your workspace.</h1><p>Checking your secure Lucid Core session.</p>
    </div></div>;
  }

  if (!currentUserId) {
    return <div className="login-shell"><div className="login-card">
      <div className="login-brand">{state.branding.logoDataUrl ? <img src={state.branding.logoDataUrl} alt="Company logo" /> : <span>LC</span>}<div><strong>{state.branding.appName}</strong><small>{state.branding.companyName}</small></div></div>
      {passwordRecoveryOpen ? <>
        <span className="kicker">Password recovery</span><h1>Reset your password.</h1><p>Enter your Lucid Core email and we’ll send you a secure reset link.</p>
        <form onSubmit={requestPasswordReset}>
          <label className="login-field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@circlerbeef.com" required /></label>
          {authError && <div className="prototype-note" role="alert">{authError}</div>}
          {passwordRecoveryMessage && <div className="prototype-note" role="status">{passwordRecoveryMessage}</div>}
          <button className="primary login-button" type="submit" disabled={authPending}>{authPending ? 'Sending…' : 'Send reset link'}</button>
        </form>
        <button className="text-button" type="button" onClick={() => { setPasswordRecoveryOpen(false); setAuthError(''); setPasswordRecoveryMessage(''); }}>Back to sign in</button>
      </> : <>
        <span className="kicker">Secure staff access</span><h1>Sign in to your workspace.</h1><p>Use your Lucid Core email and password to access the tools assigned to your role.</p>
        <form onSubmit={login}>
          <label className="login-field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@circlerbeef.com" required /></label>
          <label className="login-field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" required /></label>
          {authError && <div className="prototype-note" role="alert">{authError}</div>}
          <button className="primary login-button" type="submit" disabled={authPending}>{authPending ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <button className="text-button" type="button" onClick={() => { setPasswordRecoveryOpen(true); setAuthError(''); }}>Forgot password?</button>
      </>}
    </div></div>;
  }

  return (
    <div className="app-shell">
      <header className="topbar modern-topbar">
        <button ref={brandButton} className="brand-button" onClick={() => window.matchMedia('(max-width: 820px)').matches ? setMobileNavOpen(true) : setWorkspaceSection('Home', 'brand button')} aria-label="Open navigation on mobile or go to home on desktop" aria-expanded={mobileNavOpen} aria-controls="mobile-navigation">
          {state.branding.logoDataUrl ? <span className="brand-logo-wrap"><img src={state.branding.logoDataUrl} alt="Company logo" /></span> : <span className="brand-mark">L</span>}
          <span><strong>{state.branding.appName}</strong><small>{state.branding.companyName} · {state.branding.tagline}</small></span>
        </button>
        <div className="top-search"><Search size={18}/><input aria-label="Search" placeholder="Search orders, documents, inventory..." /><kbd>⌘ K</kbd></div>
        <div className="top-actions reference-actions">
          <span className="safe-pill"><span className="status-dot" /> Safe mode</span>
          <div className="header-action-wrap"><button className="icon-button" aria-label="Messages" onClick={()=>openMessages()}><MessageSquare size={18}/>{unreadMessages.length > 0 && <span className="header-badge">{unreadMessages.length}</span>}</button></div>
          <div className="header-action-wrap"><button className="icon-button" aria-label="Notifications" onClick={openNotifications}><Bell size={18}/>{(unreadMessages.length + unresolvedIssues.length) > 0 && <span className="header-badge">{unreadMessages.length + unresolvedIssues.length}</span>}</button></div>
          <div className="account-menu-wrap">
            <button className="account-button" onClick={()=>setAccountOpen(v=>!v)}><span className="account-avatar">{(currentUser?.name||'U').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()}</span><span className="account-copy"><strong>{currentUser?.name}</strong><small>{roleLabels[role]}</small></span><ChevronDown size={17}/></button>
            {accountOpen && <div className="account-popover"><button onClick={logout}><LogOut size={16}/> Sign out</button></div>}
          </div>
        </div>
      </header>

      {messagesOpen && <div className="utility-panel messages-panel modern-messenger">
        <div className="utility-panel-head"><div><span className="kicker">Team Messages</span><h3>Messages</h3></div><button className="icon-button" onClick={()=>setMessagesOpen(false)} aria-label="Close messages"><X size={17}/></button></div>
        <div className={`messenger-shell ${mobileThreadOpen ? 'mobile-thread-open' : ''}`}>
          <aside className="thread-list">
            <div className="thread-list-head"><strong>Conversations</strong><select aria-label="Start a new private conversation" defaultValue="" onChange={event=>{if(event.target.value){void ensureDirectThread(event.target.value);event.target.value='';}}}><option value="">New chat</option>{messaging.users.filter(user=>user.active&&user.id!==currentUserId).map(user=><option value={user.id} key={user.id}>{user.name}</option>)}</select></div>
            {currentThreads.slice().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(t=>{const last=messaging.messages.filter(m=>m.threadId===t.id).slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];const count=messaging.messages.filter(m=>m.threadId===t.id&&m.fromUserId!==currentUserId&&!m.readBy.includes(currentUserId)).length;return <button key={t.id} className={`thread-item ${activeThread?.id===t.id?'active':''}`} onClick={()=>openThread(t.id)}><span className="thread-avatar">{t.kind==='group'?'CR':threadDisplayName(t).slice(0,2).toUpperCase()}</span><span className="thread-copy"><strong>{threadDisplayName(t)}</strong><small>{last?last.body:'No messages yet'}</small></span>{last && <time className="thread-time">{new Date(last.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</time>}{count>0&&<b>{count}</b>}</button>})}
          </aside>
          <section className="thread-view">
            {activeThread ? <>
              <div className="thread-head"><button className="mobile-thread-back" type="button" onClick={() => setMobileThreadOpen(false)} aria-label="Back to messages"><ArrowLeft size={17}/> Messages</button><div><strong>{threadDisplayName(activeThread)}</strong><small>{activeThread.kind==='group'?`${activeThread.participantIds.length} members`:'Private conversation'}</small></div></div>
              <div className="thread-messages">{activeThreadMessages.length ? activeThreadMessages.map(m=>{const mine=m.fromUserId===currentUserId;const sender=messaging.users.find(u=>u.id===m.fromUserId)?.name||'User';const recipients=activeThread.participantIds.filter(id=>id!==m.fromUserId);const seenCount=recipients.filter(id=>m.readBy.includes(id)).length;return <div className={`chat-message ${mine?'mine':''}`} key={m.id}><div className="chat-message-top"><strong>{mine?'You':sender}</strong><time>{new Date(m.createdAt).toLocaleString()}</time></div>{m.forwardedFromId&&<span className="forwarded-label"><Forward size={12}/> Forwarded</span>}<p>{m.body}</p><div className="chat-message-foot"><button onClick={()=>{setForwardingMessageId(m.id);setForwardTargetThreadId(activeThread.id)}}><Forward size={13}/> Forward</button>{mine&&<span className="read-state"><CheckCheck size={13}/>{activeThread.kind==='direct'?(seenCount?'Seen':'Delivered'):`Seen by ${seenCount}/${recipients.length}`}</span>}</div></div>}) : <div className="panel-empty">No messages yet. Send the first message in this thread.</div>}</div>
              <div className="message-compose modern-compose"><textarea value={messageText} onChange={e=>setMessageText(e.target.value)} placeholder={`Message ${threadDisplayName(activeThread)}…`} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}}/><button className="primary send-button" onClick={sendMessage} aria-label="Send message"><Send size={17}/></button></div>
            </> : <div className="panel-empty">Choose a conversation.</div>}
          </section>
        </div>
        {forwardingMessageId && <div className="forward-sheet"><div><strong>Forward message</strong><button className="icon-button" onClick={()=>setForwardingMessageId('')}><X size={15}/></button></div><select value={forwardTargetThreadId} onChange={e=>setForwardTargetThreadId(e.target.value)}>{currentThreads.map(t=><option value={t.id} key={t.id}>{threadDisplayName(t)}</option>)}</select><button className="primary" onClick={()=>forwardMessage(forwardingMessageId,forwardTargetThreadId)}>Forward</button></div>}
      </div>}

      {notificationsOpen && <div className="utility-panel notification-panel">
        <div className="utility-panel-head"><div><span className="kicker">Notifications</span><h3>Needs your attention</h3></div><button className="icon-button" onClick={()=>setNotificationsOpen(false)} aria-label="Close notifications"><X size={17}/></button></div>
        <div className="notification-list">
          {unresolvedIssues.slice(0,5).map((x,i)=><button key={`${x.order.id}-${i}`} className="notification-item" onClick={()=>{setSelectedOrderId(x.order.id);setWorkspaceSection('Exceptions', 'notification');setNotificationsOpen(false)}}><CircleAlert size={18}/><span><strong>Order review</strong><small>PO {x.order.externalPo} · {x.issue.message}</small></span></button>)}
          {unreadMessages.slice(0,5).map(m=><button key={m.id} className="notification-item" onClick={()=>openMessages(m.threadId)}><MessageSquare size={18}/><span><strong>New message</strong><small>{messaging.users.find(u=>u.id===m.fromUserId)?.name || 'Team member'}: {m.body.slice(0,70)}</small></span></button>)}
          {!unresolvedIssues.length && !unreadMessages.length && <div className="panel-empty">You're all caught up.</div>}
        </div>
      </div>}

      {mobileNavOpen && <div className="mobile-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setMobileNavOpen(false); }}>
        <aside ref={mobileDrawer} id="mobile-navigation" className="mobile-drawer" role="dialog" aria-modal="true" aria-label="Lucid Core navigation">
          <div className="mobile-drawer-head">
            <div className="mobile-drawer-brand"><span className="brand-mark">L</span><span><strong>{state.branding.appName}</strong><small>{state.branding.companyName}</small></span></div>
            <button className="icon-button" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation menu"><X size={19}/></button>
          </div>
          <nav className="mobile-drawer-nav" aria-label="Mobile navigation">
            {mobileNavigationGroups.map(group => {
              const sections = group.sections.filter(item => visibleSections.includes(item));
              return sections.length ? <div className="mobile-nav-group" key={group.label}><span>{group.label}</span>{sections.map(item => <button key={item} className={section === item ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => navigateToSection(item)}><SectionIcon name={item}/><strong>{sectionLabels[item]}</strong>{item === 'Exceptions' && unresolvedIssues.length > 0 && <b>{unresolvedIssues.length}</b>}</button>)}</div> : null;
            })}
          </nav>
          <div className="mobile-drawer-foot"><div><strong>{currentUser?.name}</strong><span>{roleLabels[role]}</span></div><button type="button" onClick={logout}><LogOut size={18}/> Sign out</button></div>
        </aside>
      </div>}

      <div className="workspace">
        <aside className="side-nav" aria-label="Main navigation">
          <nav>
            <span className="nav-group-label">Operations</span>
            {(['Home','Orders','Exceptions','Production','Inventory','Pallets','Shipments','Trace','Reports'] as Section[]).filter(i=>visibleSections.includes(i)).map(item => <button key={item} className={section === item ? 'nav-item active' : 'nav-item'} onClick={() => setWorkspaceSection(item, 'side navigation')}><SectionIcon name={item} /><span>{sectionLabels[item]}</span>{item === 'Exceptions' && unresolvedIssues.length > 0 && <b>{unresolvedIssues.length}</b>}</button>)}
            <span className="nav-group-label">Records & Growth</span>
            {(['Samples','Documents','Office','Logistics','Sales'] as Section[]).filter(i=>visibleSections.includes(i)).map(item => <button key={item} className={section === item ? 'nav-item active' : 'nav-item'} onClick={() => setWorkspaceSection(item, 'side navigation')}><SectionIcon name={item} /><span>{sectionLabels[item]}</span>{item === 'Exceptions' && unresolvedIssues.length > 0 && <b>{unresolvedIssues.length}</b>}</button>)}
            <span className="nav-group-label">Management</span>
            {(['Roadmap','MasterData','Imports','System'] as Section[]).filter(i=>visibleSections.includes(i)).map(item => <button key={item} className={section === item ? 'nav-item active' : 'nav-item'} onClick={() => setWorkspaceSection(item, 'side navigation')}><SectionIcon name={item} /><span>{sectionLabels[item]}</span></button>)}
          </nav>
          <div className="side-help"><strong>Need help?</strong><span>Lucid Core only shows the tools needed for your role.</span></div>
        </aside>

        <main className="content">
          {notice && <div className={`notice ${notice.tone}`}><span>{notice.message}</span><button onClick={() => setNotice(null)}>×</button></div>}

          {section === 'Home' && <>
            <div className="page-heading compact-heading">
              <div><span className="kicker">{role === 'leadership' ? 'Operations overview' : 'Today'}</span><h1>{role === 'production' ? 'Ready for the floor.' : role === 'leadership' ? 'What needs your attention.' : `Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}.`}</h1><p>{role === 'office' ? 'Orders, order review, receiving, shipping, and inventory work — only what you need right now.' : role === 'production' ? 'See Picking / Production work and complete the Pallet Breakdown without moving between systems.' : role === 'leadership' ? 'A simple view of current activity. Open details only when you need them.' : `Manage ${state.branding.companyName} operations and integrations from one place.`}</p></div>
            </div>

            <section className="home-focus-strip">
              <div className="home-focus-copy"><span className="home-focus-eyebrow">Your workspace</span><strong>{role === 'production' ? 'Production + Pallet Breakdown' : role === 'office' ? 'Orders + Order Review + ASN' : role === 'leadership' ? 'Leadership overview' : 'Full operations control'}</strong><small>Only the areas relevant to this role are shown. Open a card when you need the details.</small></div>
              <span className="home-focus-shield"><ShieldCheck size={22} strokeWidth={1.8} /> Role-based view</span>
            </section>

            <div className={`quick-grid ${homeCards.length === 2 ? 'two' : ''}`}>
              {homeCards.map(card => <button className={`quick-card quick-card-${card.target.toLowerCase()}`} key={card.label} onClick={() => setWorkspaceSection(card.target, 'home shortcut')}>
                <div className="quick-card-top"><DashboardIcon target={card.target} /><span className="quick-value">{card.value}</span></div>
                <span className="quick-label">{card.label}</span><small>{card.hint}</small><span className="card-arrow"><ChevronRight size={19} /></span>
              </button>)}
            </div>

            {role !== 'leadership' && <section className="surface next-work">
              <div className="section-head"><div><span className="kicker">Next up</span><h2>{profile ? (nextStagedReview ? 'One order needs review' : 'Everything looks clear') : (unresolvedIssues.length ? 'One order needs review' : 'Everything looks clear')}</h2></div>{(profile ? nextStagedReview : unresolvedIssues[0]) && <button className="text-button" onClick={() => setWorkspaceSection('Exceptions', 'home next up')}>See exception →</button>}</div>
              {profile ? (nextStagedReview ? <div className="work-row"><div className="work-icon warning">!</div><div><strong>PO {nextStagedReview.external_po}</strong><span>{nextStagedException?.message || 'An order check needs attention.'}</span></div><button className="secondary" onClick={() => { setSelectedStagedOrderId(nextStagedReview.id); setWorkspaceSection('Exceptions', 'home review'); }}>Review</button></div> : <div className="empty-compact">No orders need review right now.</div>) : (unresolvedIssues.length ? <div className="work-row"><div className="work-icon warning">!</div><div><strong>PO {unresolvedIssues[0].order.externalPo}</strong><span>{unresolvedIssues[0].issue.message}</span></div><button className="secondary" onClick={() => setWorkspaceSection('Exceptions', 'home review')}>Review</button></div> : <div className="empty-compact">No blocked orders right now.</div>)}
            </section>}
          </>}

          {section === 'Orders' && <>
            <div className="page-heading"><div><span className="kicker">Incoming Orders</span><h1>One clear place to check incoming orders.</h1><p>Review what needs attention, then keep ready orders together for the next approved step.</p></div>{role === 'lucid_admin' && <button className="secondary" onClick={() => void importSandboxOrders()}>Refresh SPS Sandbox test orders</button>}</div>
            {profile && <ControlledQaOrderWorkspace
              organizationId={profile.organization_id}
              role={role}
              qaOrders={operationalOrders.filter(order => order.sourceSystem === 'lucid_qa').map(order => ({ id: order.id, externalPo: order.externalPo, operationalStatus: order.operationalStatus }))}
              onCreated={refreshStaging}
              onOpenProduction={(orderId) => {
                setSelectedProductionOrderId(orderId);
                setWorkspaceSection('Production', 'controlled QA order created');
              }}
            />}
            <IncomingOrdersQueue orders={activeStagedOrders} lines={stagedLines} exceptions={stagedExceptions} onOpenOrder={id => { setSelectedStagedOrderId(id); setWorkspaceSection('Exceptions', 'incoming order'); }} />
          </>}

          {section === 'Exceptions' && <>
            <div className="page-heading"><div><span className="kicker">Order Check</span><h1>Let’s get this order ready.</h1><p>Work through the remaining checks. Lucid will remember what you confirm.</p></div></div>
            <div className="stack">
              {selectedStagedOrder && (
                <StagedOrderReviewWorkspace
                  order={selectedStagedOrder}
                  lines={stagedLines.filter(line => line.staged_order_id === selectedStagedOrder.id)}
                  allLines={stagedLines}
                  exceptions={stagedExceptions.filter(exception => exception.staged_order_id === selectedStagedOrder.id)}
                  role={role}
                  onOpenProduction={() => {
                    setNotice({
                      tone: 'success',
                      message: `Production order PO ${selectedStagedOrder.external_po} is ready.`,
                    });
                    setWorkspaceSection('Production', 'promotion complete');
                  }}
                  onPromotionFailure={(message) => setNotice({ tone: 'warning', message })}
                  onSaved={async (message) => {
                    await refreshStaging();
                    setNotice({ tone: 'success', message });
                  }}
                />
              )}
              {!stagedOrders.length && (unresolvedIssues.length ? unresolvedIssues.map(({ order, issue }) => <ExceptionReviewCard key={`${order.id}:${issue.message}`} order={order} issue={issue} onView={() => { setSelectedOrderId(order.id); setWorkspaceSection('Orders', 'legacy exception review'); }} onResolve={(decision) => resolveException(order.id, issue.message, decision)} onPrint={() => printStage('Exception', order, undefined, issue.message)} onDownload={() => saveReport('Exception', order, undefined, issue.message)} />) : <Empty title="No orders need review" text="When a price, item, date or mapping does not match, it will appear here. Verified physical pricing sheets and other approved references are recorded instead of treated as automatic errors." />)}
            </div>
            {state.reviewedExceptions.length > 0 && <section className="surface reviewed-panel"><div className="section-head"><div><span className="kicker">Reviewed</span><h2>Past order reviews can still be corrected.</h2><p>Nothing becomes uneditable just because it moved forward. Changes stay traceable.</p></div></div>{state.reviewedExceptions.map(key => { const [orderId, ...rest] = key.split(':'); const order = state.orders.find(o => o.id === orderId); const decision = state.exceptionDecisions[key]; if (!order || !decision) return null; return <ReviewedDecisionRow key={key} order={order} decision={decision} onSave={(d) => saveExceptionDecision(key, d)} onReopen={() => reopenException(key)} />; })}</section>}
          </>}

          {section === 'Production' && <>
            {selectedProductionOrder ? (
              <ProductionOrderWorkspace
                order={selectedProductionOrder}
                cases={productionCases.filter(productionCase => productionCase.order_id === selectedProductionOrder.id)}
                lots={productionLots.filter(productionLot => productionLot.order_id === selectedProductionOrder.id)}
                organizationId={profile?.organization_id || ''}
                role={role}
                onBack={() => setSelectedProductionOrderId('')}
                onRefresh={refreshStaging}
                onStartPalletizing={() => setWorkspaceSection('Pallets', 'start palletizing')}
              />
            ) : <>
              <div className="page-heading"><div><span className="kicker">Picking / Production</span><h1>What production needs today.</h1><p>Manage today’s approved production orders, case activity, and pallet progress in one place.</p></div></div>
              <div className="surface production-board">{operationalOrders.map(order => {
                const orderCases = productionCases.filter(productionCase => productionCase.order_id === order.id && productionCase.status !== 'voided');
                const producedCases = orderCases.reduce((total, productionCase) => total + productionCase.quantity, 0);
                const orderedCases = totalCases(order);
                const progress = orderedCases ? Math.min(100, Math.round((producedCases / orderedCases) * 100)) : 0;
                const statusLabel = order.operationalStatus === 'ready_for_production' ? 'Ready to start' : order.operationalStatus === 'in_production' ? 'In production' : 'Production complete';
                return <div className="production-job" key={order.id}><div><span className={`status-chip ${order.operationalStatus === 'production_complete' ? 'ready' : order.operationalStatus === 'in_production' ? 'progress' : 'needs'}`}>{statusLabel}</span>{order.sourceSystem === 'lucid_qa' && <span className="status-chip progress">TEST / QA</span>}<h2>PO {order.externalPo}</h2><p>{order.customer} · {order.shipTo} · Needed {order.requestedShipDate || 'Not specified'}</p></div><div className="line-summary"><strong>{orderedCases} cases ordered · {producedCases} produced</strong>{order.lines.map(line => <small key={line.id}>{line.quantityCases} {line.uom} · {productionItemName(line)}</small>)}<span className="production-progress"><i style={{ width: `${progress}%` }} /></span><small>{progress}% complete</small></div><div className="job-actions"><button type="button" className="primary" onClick={() => setSelectedProductionOrderId(order.id)}>Open Production Order</button></div></div>;
              })}{!operationalOrders.length && <Empty title="No production orders are scheduled" text="Approved orders will appear here when they are ready for production." />}</div>
            </>}
          </>}

          {section === 'Pallets' && <>
            {profile ? <PalletBreakdownHub orders={operationalOrders} pallets={operationalPallets} cases={productionCases} assignments={palletCaseAssignments} activities={palletActivities} role={role} selectedPallet={selectedOperationalPallet} onOpenPallet={id => setSelectedPalletId(id)} onClosePallet={() => setSelectedPalletId('')} onRefresh={refreshStaging} /> : <Empty title="Sign in to build pallets" text="Production pallet breakdowns are available to authenticated Lucid Core users." />}
          </>}

          {section === 'Shipments' && (profile
            ? <ShipmentWorkspace
                organizationId={profile.organization_id}
                role={role}
                orders={operationalOrders.map(order => ({
                  id: order.id,
                  po: order.externalPo,
                  customer: order.customer,
                  shipTo: order.shipTo,
                  lines: order.lines.map(line => ({ id: line.id, itemCode: productionItemIdentifier(line), description: productionItemName(line), uom: line.uom, quantity: line.quantityCases })),
                }))}
              />
            : <Empty title="Shipments are unavailable" text="Sign in with an active Lucid Core account to view shipment status." />
          )}

          {section === 'Documents' && <>
            <div className="page-heading"><div><span className="kicker">Order Files</span><h1>One familiar packet per order.</h1><p>Keep the same records the team already recognizes: PO, Acknowledgment, Picking Ticket, Weight Report, Pallet Breakdown, Advance Ship Notice, Bill of Lading and Invoice.</p></div></div>
            <div className="document-toolbar"><div><strong>Printable + SharePoint-ready order files</strong><span>These forms intentionally follow the same field order and paper language Circle R already uses in SPS, Food Connex and the physical pallet / BOL packet. Print opens the browser dialog so staff can print or Save as PDF.</span></div>{selectedOrder && <button className="primary" onClick={() => saveReport('Order Packet', selectedOrder)}>Generate Customer Order Packet</button>}</div>
            {selectedOrder && <section className="template-library"><div className="template-head"><div><span className="kicker">Familiar forms</span><h2>Print the forms the team already knows.</h2><p>Premium digital versions of the same physical records — not a new document language.</p></div></div><div className="template-grid">{(['Pallet Breakdown','Advance Ship Notice','Weight Report','Bill of Lading'] as const).map(kind=>{const html=buildFamiliarTemplate(kind,selectedOrder);return <div className="template-card" key={kind}><div className="template-icon"><FileText size={21}/></div><div><strong>{kind}</strong><span>Circle R familiar format</span></div><div className="template-actions"><button className="secondary" onClick={()=>printHtml(html)}>Print / Save PDF</button><button className="text-button" onClick={()=>downloadHtml(`${selectedOrder.externalPo}-${kind.toLowerCase().replace(/ /g,'-')}.html`,html)}>Download</button></div></div>})}</div></section>}
            {state.reports.length ? <div className="surface report-list">{state.reports.map(report => <div className="report-row" key={report.id}><div><span className="row-label">{reportStageLabel[report.stage]}</span><strong>{report.title}</strong><small>{new Date(report.createdAt).toLocaleString()} · {report.suggestedPath}</small></div><span className={`status-chip ${report.sharePointStatus === 'Queued' ? 'progress' : 'ready'}`}>{report.sharePointStatus}</span><div className="report-actions compact"><button className="secondary" onClick={() => printHtml(report.html)}>Print / PDF</button><button className="secondary" onClick={() => downloadHtml(`${(report.po || 'circle-r')}-${report.stage.toLowerCase().replace(/ /g,'-')}.html`, report.html)}>Download</button><button className="text-button" onClick={() => queueReport(report.id)}>{report.sharePointStatus === 'Queued' ? 'Queued' : 'Queue for SharePoint'}</button></div></div>)}</div> : <Empty title="No generated reports yet" text="Use Print or Download from Orders, Production, Pallets, Exceptions or Shipping. Every generated download is also indexed here for the future SharePoint archive." action="SharePoint connector can be added later" />}
          </>}


          {section === 'Inventory' && (profile
            ? <InventoryWorkspace organizationId={profile.organization_id} role={role} />
            : <Empty title="Inventory is unavailable" text="Sign in with an active Lucid Core account to view inventory." />
          )}

          {section === 'Trace' && <>
            <div className="page-heading"><div><span className="kicker">Trace / Recall</span><h1>Find the full path of an order, case or pallet.</h1><p>Search one place instead of chasing paper. This is designed for audit, recall and shipping questions.</p></div></div>
            <TraceRecall orders={operationalOrders} cases={productionCases} pallets={operationalPallets} assignments={palletCaseAssignments} />
          </>}

          {section === 'Reports' && profile && <OperationsReports organizationId={profile.organization_id} role={role} onOpenTrace={() => setWorkspaceSection('Trace', 'reports trace link')} />}

          {section === 'Imports' && profile && <HistoricalImportWorkspace role={role} />}

          {section === 'Samples' && <>
            <div className="page-heading"><div><span className="kicker">Samples / Rebuilds</span><h1>Keep sample and rebuild requests from getting lost.</h1><p>This is the Phase 1 quick win from the 90-day plan: owner, status, follow-up, shipment and notes in one simple tracker.</p></div><button className="primary" onClick={addSample}>+ Add request</button></div>
            <EditableGrid headers={['Customer','Item','Type','Owner','Status','Due / Follow-up','Tracking','Notes','']} rows={state.samples.map(r=>[<input value={r.customer} onChange={e=>updateSample(r.id,{customer:e.target.value})}/>,<input value={r.item} onChange={e=>updateSample(r.id,{item:e.target.value})}/>,<select value={r.type} onChange={e=>updateSample(r.id,{type:e.target.value as SampleRecord['type']})}><option>Sample</option><option>Rebuild</option></select>,<input value={r.owner} onChange={e=>updateSample(r.id,{owner:e.target.value})}/>,<select value={r.status} onChange={e=>updateSample(r.id,{status:e.target.value as SampleRecord['status']})}><option>New</option><option>In progress</option><option>Shipped</option><option>Closed</option></select>,<input type="date" value={r.due||''} onChange={e=>updateSample(r.id,{due:e.target.value})}/>,<input value={r.tracking||''} onChange={e=>updateSample(r.id,{tracking:e.target.value})}/>,<input value={r.notes||''} onChange={e=>updateSample(r.id,{notes:e.target.value})}/>,<button className="text-button danger-link" onClick={()=>removeSample(r.id)}>Remove</button>])} empty="No sample or rebuild requests yet." />
          </>}

          {section === 'Office' && <>
            <div className="page-heading"><div><span className="kicker">Office Paperwork</span><h1>Track bills, customer files and paperwork without losing the paper trail.</h1><p>Designed for the later AP / AR and document-flow phase. SharePoint can become the final archive while Lucid Core tracks where each record stands.</p></div><button className="primary" onClick={addOffice}>+ Add paperwork</button></div>
            <EditableGrid headers={['Type','Reference','Customer / Vendor','Status','Due','Notes','']} rows={state.officeRecords.map(r=>[<select value={r.type} onChange={e=>updateOffice(r.id,{type:e.target.value as OfficeRecord['type']})}><option>AP Bill</option><option>AR Invoice</option><option>Customer File</option><option>Vendor File</option><option>Other</option></select>,<input value={r.reference} onChange={e=>updateOffice(r.id,{reference:e.target.value})}/>,<input value={r.party} onChange={e=>updateOffice(r.id,{party:e.target.value})}/>,<select value={r.status} onChange={e=>updateOffice(r.id,{status:e.target.value as OfficeRecord['status']})}><option>Received</option><option>Needs review</option><option>Approved</option><option>Filed</option></select>,<input type="date" value={r.due||''} onChange={e=>updateOffice(r.id,{due:e.target.value})}/>,<input value={r.notes||''} onChange={e=>updateOffice(r.id,{notes:e.target.value})}/>,<button className="text-button danger-link" onClick={()=>removeOffice(r.id)}>Remove</button>])} empty="No office paperwork tracked yet." />
          </>}

          {section === 'Logistics' && <>
            <div className="page-heading"><div><span className="kicker">Logistics</span><h1>Freight, routes and appointments in one view.</h1><p>This supports the Growth Readiness phase without forcing a TMS decision yet. Compare LTL / FTL, appointments and rates while requirements become clearer.</p></div><button className="primary" onClick={addLogistics}>+ Add load</button></div>
            <EditableGrid headers={['PO','Carrier','Mode','Pickup','Delivery','Appointment','Status','Rate','Notes','']} rows={state.logistics.map(r=>[<input value={r.po||''} onChange={e=>updateLogistics(r.id,{po:e.target.value})}/>,<input value={r.carrier} onChange={e=>updateLogistics(r.id,{carrier:e.target.value})}/>,<select value={r.mode} onChange={e=>updateLogistics(r.id,{mode:e.target.value as LogisticsRecord['mode']})}><option>LTL</option><option>FTL</option><option>Customer Pickup</option><option>Other</option></select>,<input type="date" value={r.pickup||''} onChange={e=>updateLogistics(r.id,{pickup:e.target.value})}/>,<input type="date" value={r.delivery||''} onChange={e=>updateLogistics(r.id,{delivery:e.target.value})}/>,<input value={r.appointment||''} onChange={e=>updateLogistics(r.id,{appointment:e.target.value})}/>,<select value={r.status} onChange={e=>updateLogistics(r.id,{status:e.target.value as LogisticsRecord['status']})}><option>Planning</option><option>Quoted</option><option>Booked</option><option>In transit</option><option>Delivered</option></select>,<input inputMode="decimal" value={r.rate??''} onChange={e=>updateLogistics(r.id,{rate:e.target.value?Number(e.target.value):undefined})}/>,<input value={r.notes||''} onChange={e=>updateLogistics(r.id,{notes:e.target.value})}/>,<button className="text-button danger-link" onClick={()=>removeLogistics(r.id)}>Remove</button>])} empty="No freight loads tracked yet. Add one when logistics review begins." />
          </>}

          {section === 'Sales' && <>
            <div className="page-heading"><div><span className="kicker">Sales / Food Show Follow-Up</span><h1>Keep every lead and next step visible.</h1><p>This covers the Month 3 food-show / sales follow-up deliverable with a simple tracker rather than another CRM.</p></div><button className="primary" onClick={addSales}>+ Add follow-up</button></div>
            <EditableGrid headers={['Company','Contact','Source','Next step','Owner','Status','Follow-up date','Notes','']} rows={state.sales.map(r=>[<input value={r.company} onChange={e=>updateSales(r.id,{company:e.target.value})}/>,<input value={r.contact||''} onChange={e=>updateSales(r.id,{contact:e.target.value})}/>,<select value={r.source} onChange={e=>updateSales(r.id,{source:e.target.value as SalesRecord['source']})}><option>Food Show</option><option>Referral</option><option>Inbound</option><option>Existing Customer</option><option>Other</option></select>,<input value={r.nextStep} onChange={e=>updateSales(r.id,{nextStep:e.target.value})}/>,<input value={r.owner} onChange={e=>updateSales(r.id,{owner:e.target.value})}/>,<select value={r.status} onChange={e=>updateSales(r.id,{status:e.target.value as SalesRecord['status']})}><option>New</option><option>Follow-up</option><option>Quoted</option><option>Won</option><option>Closed</option></select>,<input type="date" value={r.followUpDate||''} onChange={e=>updateSales(r.id,{followUpDate:e.target.value})}/>,<input value={r.notes||''} onChange={e=>updateSales(r.id,{notes:e.target.value})}/>,<button className="text-button danger-link" onClick={()=>removeSales(r.id)}>Remove</button>])} empty="No sales or food-show follow-ups yet." />
          </>}

          {section === 'Roadmap' && <>
            <div className="page-heading"><div><span className="kicker">90-Day Plan</span><h1>Review → Solve → Test → Move Forward</h1><p>The same project rhythm from the approved roadmap, now visible inside Lucid Core so everyone can see what is being worked on without learning a project-management tool.</p></div></div>
            <div className="roadmap-grid">
              <RoadmapPhase phase="Phase 1 · Days 1–30" title="Core Systems" items={['Food Connex review','Orders / PO flow','Inventory + Pallet review','Samples / Rebuilds quick win']} result="Begin testing useful improvements early." />
              <RoadmapPhase phase="Phase 2 · Days 31–60" title="Connected Office + Production" items={['Pallet / Inventory Pilot','Order Improvements','Order Files / SharePoint Hub','Office Paperwork']} result="Information becomes easier to find and manage." />
              <RoadmapPhase phase="Phase 3 · Days 61–90" title="Growth Readiness" items={['Logistics','Leadership View','Sales / Food Show Follow-Up','Next Roadmap']} result="Circle R is better prepared for continued growth." />
            </div>
            <section className="surface roadmap-weeks"><div className="section-head"><div><span className="kicker">12-week rhythm</span><h2>Work scheduled around the project — not fixed shifts.</h2></div></div><div className="week-list">{[
              ['Week 1','Food Connex review + Samples / Rebuilds outline'],['Week 2','Food Connex solution + Order flow review'],['Week 3','Test Food Connex improvement + Inventory / Pallets'],['Week 4','Launch Samples / Rebuilds + design Pallet pilot'],['Week 5','Run Pallet / Inventory pilot + review order repeat work'],['Week 6','Adjust pilot + improve order flow + start SharePoint'],['Week 7','Build Order Files / SharePoint hub + review Office Paperwork'],['Week 8','Test SharePoint / office flow + training work'],['Week 9','Review Logistics + improve Leadership View'],['Week 10','Logistics recommendations + training presentation'],['Week 11','Review Sales / Food Show follow-up + build simple tracking'],['Week 12','Test final improvements + build next 90-day roadmap']
            ].map(([week,focus])=><div className="week-row" key={week}><strong>{week}</strong><span>{focus}</span></div>)}</div></section>
            <ReplacementReadiness role={role} />
          </>}

          {section === 'MasterData' && profile && <MasterDataSetup organizationId={profile.organization_id} role={role} />}

          {section === 'System' && <>
            <div className="page-heading"><div><span className="kicker">Lucid Admin</span><h1>Operational controls and integration boundaries.</h1><p>Organization-wide operating records are managed in the relevant Lucid workspaces. Browser-only setup controls are intentionally unavailable in the pilot.</p></div></div>

            <div className="admin-subheading"><span className="kicker">Access</span><h2>Authenticated account</h2></div>
            <section className="surface admin-section"><div className="section-head"><div><h2>{profile?.display_name}</h2><p>Your active organization and role are verified from your Lucid Core profile when you sign in.</p></div><span className="status-chip ready">{roleLabels[role]}</span></div></section>

            <div className="admin-subheading"><span className="kicker">Connections</span><h2>Integration status</h2></div>
            <div className="integration-grid">{[
              ['SPS Commerce','EDI / trading-partner authority','SPS remains the authority for inbound and outbound EDI transactions.'],
              ['Food Connex','Legacy / reference during transition','Historical data can be imported with provenance; Lucid does not write back to Food Connex.'],
              ['QuickBooks','Accounting authority','Shipment invoice references are retained here; accounting and AR remain in QuickBooks.'],
              ['Microsoft / SharePoint','Document authority','Governed document storage remains in SharePoint.'],
              ['Supabase / Postgres','Lucid operational data platform','Organization-scoped operations, audit history, authentication, and messages are stored centrally.'],
            ].map(([name,status,desc]) => <div className="surface integration-card" key={name}><div className="integration-dot"/><div><strong>{name}</strong><span>{status}</span><small>{desc}</small></div></div>)}</div>
            <div className="surface safe-panel"><strong>Operational safeguards</strong><p>Lucid writes only to its authenticated, organization-scoped operational records. It does not create or change Food Connex, QuickBooks, SharePoint, carrier, or SPS transactions from this workspace.</p></div>
          </>}
        </main>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Primary mobile navigation">
        {mobileBottomSections.map(item => <button key={item} className={section === item ? 'active' : ''} onClick={() => navigateToSection(item)}><SectionIcon name={item}/><span>{sectionLabels[item].replace(' / PO','').replace('Order Review','Review').replace('Advance Ship Notice','ASN')}</span></button>)}
        {(role === 'leadership' || role === 'lucid_admin') && <button type="button" onClick={() => openMessages()} aria-label="Open messages"><span className="bottom-nav-icon"><MessageSquare size={19}/>{unreadMessages.length > 0 && <b>{unreadMessages.length}</b>}</span><span>Messages</span></button>}
        <button type="button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation menu"><Menu size={20}/><span>Menu</span></button>
      </nav>
    </div>
  );
}


function TraceRecall({ orders, cases, pallets, assignments }: { orders: OperationalOrder[]; cases: ProductionCase[]; pallets: OperationalPallet[]; assignments: PalletCaseAssignment[] }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const palletById = useMemo(() => new Map(pallets.map(pallet => [pallet.id, pallet])), [pallets]);
  const activePalletByCaseId = useMemo(() => {
    const result = new Map<string, OperationalPallet>();
    for (const assignment of assignments) {
      const pallet = assignment.production_case_id && assignment.status === 'active' ? palletById.get(assignment.pallet_id) : undefined;
      if (assignment.production_case_id && pallet) result.set(assignment.production_case_id, pallet);
    }
    return result;
  }, [assignments, palletById]);
  const palletForCase = (productionCase: ProductionCase) =>
    productionCase.pallet_id ? palletById.get(productionCase.pallet_id) || activePalletByCaseId.get(productionCase.id) : activePalletByCaseId.get(productionCase.id);
  const casesForOrder = (orderId: string) => cases.filter(productionCase => productionCase.order_id === orderId);
  const caseMatches = cases.filter(productionCase => !q || [
    productionCase.case_identifier,
    productionCase.lot_code,
    palletForCase(productionCase)?.pallet_identifier,
  ].filter(Boolean).some(value => String(value).toLowerCase().includes(q)));
  const orderMatches = orders.filter(order => {
    const orderCases = casesForOrder(order.id);
    return !q || [
      order.externalPo, order.customer, order.shipTo, order.foodConnexOrder,
      ...order.lines.flatMap(line => [line.externalSku, line.internalItemId, line.vendorItem, line.description]),
      ...orderCases.flatMap(productionCase => [productionCase.case_identifier, productionCase.lot_code, palletForCase(productionCase)?.pallet_identifier]),
    ].filter(Boolean).some(value => String(value).toLowerCase().includes(q));
  });
  const visibleCases = q ? caseMatches : cases;
  const activeCaseCount = visibleCases.filter(productionCase => productionCase.status !== 'voided').length;
  const voidedCaseCount = visibleCases.length - activeCaseCount;
  const palletMatches = pallets.filter(pallet => !q || [
    pallet.pallet_identifier,
    ...cases.filter(productionCase => palletForCase(productionCase)?.id === pallet.id).map(productionCase => productionCase.case_identifier),
  ].filter(Boolean).some(value => String(value).toLowerCase().includes(q)));

  return <div className="trace-layout">
    <section className="surface trace-search">
      <div className="trace-searchbar"><Search size={18}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search PO, item, case ID, pallet, customer, or ship-to…"/></div>
      <div className="trace-summary"><span><strong>{orderMatches.length}</strong> Orders</span><span><strong>{palletMatches.length}</strong> Pallets</span><span><strong>{visibleCases.length}</strong> Cases</span><span><strong>{activeCaseCount}</strong> Active</span><span><strong>{voidedCaseCount}</strong> Voided</span></div>
    </section>
    {(orderMatches.length || palletMatches.length || caseMatches.length) ? <div className="trace-results">
      {orderMatches.map(order => {
        const orderCases = casesForOrder(order.id);
        const activeCases = orderCases.filter(productionCase => productionCase.status !== 'voided');
        const voidedCases = orderCases.filter(productionCase => productionCase.status === 'voided');
        const orderPallets = Array.from(new Map(orderCases.map(palletForCase).filter((pallet): pallet is OperationalPallet => Boolean(pallet)).map(pallet => [pallet.id, pallet])).values());
        return <section className="surface trace-card" key={order.id}>
          <div className="trace-card-head"><div><span className="kicker">Order trace</span><h2>PO {order.externalPo}</h2><p>{order.customer} · {order.shipTo}</p></div><div>{order.sourceSystem === 'lucid_qa' && <span className="status-chip progress">TEST / QA</span>}<span className="status-chip progress">{order.operationalStatus.replaceAll('_', ' ')}</span></div></div>
          <div className="trace-flow"><span>{order.sourceSystem === 'lucid_qa' ? 'Controlled QA' : order.source || 'Operational order'}</span><ChevronRight size={16}/><span>{activeCases.length} active case{activeCases.length === 1 ? '' : 's'}</span><ChevronRight size={16}/><span>{orderPallets.length} pallet{orderPallets.length === 1 ? '' : 's'}</span><ChevronRight size={16}/><span>{voidedCases.length} voided</span></div>
          <div className="trace-detail">{order.lines.map(line => <div key={line.id}><strong>{productionItemName(line)}</strong><span>{productionItemIdentifier(line)} · {line.quantityCases} {line.uom}</span></div>)}</div>
          <div className="trace-detail trace-case-list">{orderCases.length ? orderCases.map(productionCase => {
            const pallet = palletForCase(productionCase);
            return <div key={productionCase.id} className={productionCase.status === 'voided' ? 'voided' : ''}>
              <strong>{productionCase.case_identifier}</strong>
              <span>{productionCase.status === 'voided' ? `Voided${productionCase.void_reason ? ` · ${productionCase.void_reason}` : ''}` : 'Active'} · {productionCase.net_weight == null ? 'Weight unavailable' : `${productionCase.net_weight.toFixed(2)} ${productionCase.net_weight_uom}`}{productionCase.lot_code ? ` · Prod Code ${productionCase.lot_code}` : ''}{pallet ? ` · Pallet ${pallet.pallet_identifier}` : ' · Not palletized'}</span>
            </div>;
          }) : <p className="muted-copy">No production cases have been recorded for this order.</p>}</div>
        </section>;
      })}
      {palletMatches.filter(pallet => !orderMatches.some(order => order.id === pallet.order_id)).map(pallet => {
        const palletCases = cases.filter(productionCase => palletForCase(productionCase)?.id === pallet.id);
        return <section className="surface trace-card" key={pallet.id}><h2>{pallet.pallet_identifier}</h2><p>{palletCases.length} case{palletCases.length === 1 ? '' : 's'} · {pallet.status}</p></section>;
      })}
    </div> : <Empty title="No traceability match" text="Try a PO number, item, case label, pallet, customer, or ship-to."/>}
  </div>;
}

function IncomingOrdersQueue({ orders, lines, exceptions, onOpenOrder }: {
  orders: StagedOrder[];
  lines: StagedLine[];
  exceptions: StagedException[];
  onOpenOrder: (id: string) => void;
}) {
  type QueueState = 'ready' | 'review' | 'leadership';
  const [view, setView] = useState<'order' | 'issue'>('order');
  const [issueFilter, setIssueFilter] = useState<string | null>(null);
  const [selectedReady, setSelectedReady] = useState<string[]>([]);
  const [showReadyPreview, setShowReadyPreview] = useState(false);
  const openExceptions = exceptions.filter(exception => exception.status === 'open');
  const leadershipRequested = (exception: StagedException) => exception.exception_code === 'PRICE_MISMATCH' && exception.status === 'open' && Boolean(exception.details && typeof exception.details === 'object' && 'leadership_review_requested_at' in exception.details);
  const classify = (order: StagedOrder): QueueState => {
    const orderExceptions = openExceptions.filter(exception => exception.staged_order_id === order.id);
    if (orderExceptions.some(leadershipRequested)) return 'leadership';
    const hasDecision = orderExceptions.some(exception => exception.severity === 'warning' || exception.severity === 'blocking');
    const allItemsMatched = lines.filter(line => line.staged_order_id === order.id).every(line => line.item_mapping_status === 'mapped');
    return order.review_status === 'ready' && order.mapping_status === 'mapped' && allItemsMatched && !hasDecision ? 'ready' : 'review';
  };
  const queues = {
    ready: orders.filter(order => classify(order) === 'ready'),
    review: orders.filter(order => classify(order) === 'review'),
    leadership: orders.filter(order => classify(order) === 'leadership'),
  };
  const issueLabels: Record<string, string> = { PRICE_MISMATCH: 'Price differences', ITEM_UNMAPPED: 'Items needing confirmation', CUSTOMER_UNMAPPED: 'Customer confirmation', SHIP_TO_UNMAPPED: 'Ship-to confirmation', REQUESTED_DATE_UNMAPPED: 'Requested dates to review', HEADER_QUANTITY_MISMATCH: 'Quantity checks' };
  const issueGroups = Object.entries(openExceptions.reduce<Record<string, StagedException[]>>((groups, exception) => {
    (groups[exception.exception_code] ||= []).push(exception);
    return groups;
  }, {})).sort(([, left], [, right]) => right.length - left.length);
  const visibleOrders = issueFilter ? orders.filter(order => openExceptions.some(exception => exception.staged_order_id === order.id && exception.exception_code === issueFilter)) : orders;
  const readySelection = selectedReady.filter(id => queues.ready.some(order => order.id === id));
  const toggleReady = (id: string) => setSelectedReady(current => current.includes(id) ? current.filter(currentId => currentId !== id) : [...current, id]);
  const actionLabel = (order: StagedOrder) => {
    const actions = openExceptions.filter(exception => exception.staged_order_id === order.id && !leadershipRequested(exception));
    return actions.length ? `${actions.length} action${actions.length === 1 ? '' : 's'} needed` : 'Ready to process';
  };

  return <section className="incoming-queue">
    <div className="queue-summary-grid">
      <button className="surface queue-summary-card ready" onClick={() => { setView('order'); setIssueFilter(null); }}><span>Ready to Process</span><strong>{queues.ready.length}</strong><small>Passed the Circle R order checks</small></button>
      <button className="surface queue-summary-card review" onClick={() => { setView('order'); setIssueFilter(null); }}><span>Needs My Review</span><strong>{queues.review.length}</strong><small>One or more choices still need attention</small></button>
      <button className="surface queue-summary-card leadership" onClick={() => { setView('order'); setIssueFilter('PRICE_MISMATCH'); }}><span>Waiting on Leadership</span><strong>{queues.leadership.length}</strong><small>Price choice has been sent to Mark</small></button>
    </div>

    <div className="queue-toolbar">
      <div className="queue-view-switch" role="tablist" aria-label="Incoming order view"><button role="tab" aria-selected={view === 'order'} className={view === 'order' ? 'active' : ''} onClick={() => { setView('order'); setIssueFilter(null); }}>By Order</button><button role="tab" aria-selected={view === 'issue'} className={view === 'issue' ? 'active' : ''} onClick={() => setView('issue')}>By Issue</button></div>
      {readySelection.length > 0 && <div className="queue-bulk-actions"><span>{readySelection.length} ready order{readySelection.length === 1 ? '' : 's'} selected</span><button className="text-button" onClick={() => setSelectedReady([])}>Clear</button><button className="primary" onClick={() => setShowReadyPreview(true)}>Process {readySelection.length} Ready Order{readySelection.length === 1 ? '' : 's'}</button></div>}
    </div>

    {view === 'issue' && <section className="surface issue-group-browser"><div><span className="kicker">Review by issue</span><h2>Handle similar checks together.</h2><p>Choose an issue to see only the orders that need that same decision.</p></div><div className="issue-group-list">{issueGroups.map(([code, group]) => <button key={code} className={issueFilter === code ? 'active' : ''} onClick={() => setIssueFilter(current => current === code ? null : code)}><span>{issueLabels[code] || 'Order check'}</span><b>{group.length}</b><ChevronRight size={16} /></button>)}</div></section>}

    {issueFilter === 'PRICE_MISMATCH' && <section className="surface compact-price-review"><div><span className="kicker">Price review</span><h2>Choose a price one order at a time.</h2></div><div className="compact-price-list">{openExceptions.filter(exception => exception.exception_code === 'PRICE_MISMATCH').map(exception => { const order = orders.find(candidate => candidate.id === exception.staged_order_id); const line = lines.find(candidate => candidate.id === exception.staged_order_line_id); return <div key={exception.id}><span><strong>PO {order?.external_po || '—'}</strong><small>{line?.description || 'Item details unavailable'}</small></span><span><small>SPS price</small><strong>{line?.sps_purchase_price == null ? '—' : `$${line.sps_purchase_price}`}</strong></span><span><small>Circle R price</small><strong>{line?.approved_circle_r_price == null ? '—' : `$${line.approved_circle_r_price}`}</strong></span><button className="secondary" onClick={() => order && onOpenOrder(order.id)}>Review</button></div>; })}</div></section>}

    <section className="surface incoming-order-list">
      <div className="incoming-list-head"><div><span className="kicker">{issueFilter ? issueLabels[issueFilter] || 'Selected order check' : view === 'issue' ? 'All incoming order checks' : 'Orders to work'}</span><h2>{issueFilter ? 'Orders with this check' : 'Incoming orders'}</h2></div>{queues.ready.length > 0 && <label className="select-ready"><input type="checkbox" checked={queues.ready.length > 0 && readySelection.length === queues.ready.length} onChange={event => setSelectedReady(event.target.checked ? queues.ready.map(order => order.id) : [])} /> Select all ready</label>}</div>
      {visibleOrders.map(order => {
        const state = classify(order);
        const lineCount = lines.filter(line => line.staged_order_id === order.id).length;
        const canSelect = state === 'ready';
        const stateCopy = state === 'ready' ? 'Ready to process' : state === 'leadership' ? 'Waiting on Mark' : actionLabel(order);
        return <div className="incoming-order-card" key={order.id}>
          {canSelect && <label className="ready-checkbox"><input type="checkbox" checked={readySelection.includes(order.id)} onChange={() => toggleReady(order.id)} aria-label={`Select PO ${order.external_po}`} /></label>}
          <button className="incoming-order-main" onClick={() => onOpenOrder(order.id)}><span className="row-label">PO {order.external_po}</span><strong>{order.source_customer_name || 'Customer needs confirmation'} <i>→</i> {order.source_ship_to_name || order.source_ship_to_code || 'Ship-to needs confirmation'}</strong><small>{order.requested_ship_date ? `Requested ${order.requested_ship_date}` : 'Requested date not provided'} · {lineCount} line item{lineCount === 1 ? '' : 's'}</small></button>
          <span className={`queue-state ${state}`}>{stateCopy}</span><button className="secondary" onClick={() => onOpenOrder(order.id)}>{state === 'ready' ? 'View check' : 'Review'}</button>
        </div>;
      })}
      {!visibleOrders.length && <Empty title="No incoming orders in this view" text="Try another review view or import Sandbox orders to continue testing." />}
    </section>

    {showReadyPreview && <div className="queue-modal-backdrop" role="presentation"><section className="surface queue-ready-modal" role="dialog" aria-modal="true" aria-labelledby="ready-preview-title"><span className="kicker">Ready orders</span><h2 id="ready-preview-title">These orders passed Circle R’s required checks.</h2><p>They are ready for the next approved step. Food Connex has not been contacted and no operational orders will be created from this screen.</p><div className="queue-ready-list">{readySelection.map(id => <span key={id}>PO {orders.find(order => order.id === id)?.external_po}</span>)}</div><div className="queue-modal-actions"><button className="secondary" onClick={() => setShowReadyPreview(false)}>Close</button><button className="primary" disabled title="A safe staged confirmation field is not available yet.">Confirm Ready (preview only)</button></div></section></div>}
  </section>;
}

function ProductionOrderWorkspace({ order, cases, lots, organizationId, role, onBack, onRefresh, onStartPalletizing }: {
  order: OperationalOrder;
  cases: ProductionCase[];
  lots: ProductionLot[];
  organizationId: string;
  role: Role;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onStartPalletizing: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caseIdentifier, setCaseIdentifier] = useState('');
  const [netWeight, setNetWeight] = useState('');
  const [weighModeLineId, setWeighModeLineId] = useState('');
  const [weighModeLot, setWeighModeLot] = useState('');
  const [labelPreviewCaseId, setLabelPreviewCaseId] = useState('');
  const weightInputRef = useRef<HTMLInputElement>(null);
  const activeCases = cases.filter(productionCase => productionCase.status !== 'voided');
  const producedForLine = (lineId: string) => activeCases.filter(productionCase => productionCase.order_line_id === lineId).reduce((total, productionCase) => total + productionCase.quantity, 0);
  const producedCases = activeCases.reduce((total, productionCase) => total + productionCase.quantity, 0);
  const palletizedCases = activeCases.filter(productionCase => productionCase.pallet_id && productionCase.status === 'palletized').reduce((total, productionCase) => total + productionCase.quantity, 0);
  const waitingForPalletCases = Math.max(0, producedCases - palletizedCases);
  const orderedCases = totalCases(order);
  const remainingCases = Math.max(0, orderedCases - producedCases);
  const capturedWeight = activeCases.reduce((total, productionCase) => total + (productionCase.net_weight || 0), 0);
  const allProduced = order.lines.length > 0 && order.lines.every(line => producedForLine(line.id) >= line.quantityCases);
  const progress = orderedCases ? Math.min(100, Math.round((producedCases / orderedCases) * 100)) : 0;
  const statusLabel = order.operationalStatus === 'ready_for_production' ? 'Ready to start' : order.operationalStatus === 'in_production' ? 'In production' : 'Production complete';
  const weighModeLine = order.lines.find(line => line.id === weighModeLineId);
  const activeLotsForWeighMode = weighModeLine ? lots.filter(lot => lot.order_line_id === weighModeLine.id && lot.status === 'active') : [];

  useEffect(() => {
    if (!weighModeLineId || saving) return;
    const timer = window.setTimeout(() => weightInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [weighModeLineId, saving, labelPreviewCaseId]);

  const request = async (path: string, body?: object) => {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => null) as ({ success?: boolean; error?: string } & Record<string, unknown>) | null;
    if (!response.ok || !result?.success) throw new Error(result?.error || 'The production update could not be saved.');
    return result;
  };
  const save = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await action();
      await onRefresh();
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The production update could not be saved.');
    } finally {
      setSaving(false);
    }
  };
  const addCase = async () => {
    const quantity = 1;
    const weight = Number(netWeight);
    if (!weighModeLineId) { setError('Start Weigh Mode for the item you are producing.'); return; }
    if (!weighModeLot.trim()) { setError('Select or enter a production lot / Prod Code.'); return; }
    if (!Number.isFinite(weight) || weight <= 0) { setError('Enter a net weight greater than zero.'); return; }
    if (Math.round(weight * 100) / 100 !== weight) { setError('Use no more than two decimal places for net weight.'); return; }
    const result = await save(() => request(`/api/production/orders/${order.id}/cases`, {
        orderLineId: weighModeLineId,
        caseIdentifier,
        quantity,
        netWeight: weight,
        lotCode: weighModeLot,
      }));
    if (typeof result?.production_case_id === 'string') setLabelPreviewCaseId(result.production_case_id);
    if (result) {
      setCaseIdentifier('');
      setNetWeight('');
      window.setTimeout(() => weightInputRef.current?.focus(), 0);
    }
  };
  const startWeighMode = (line: ProductionLine) => {
    setWeighModeLineId(line.id);
    setWeighModeLot(lots.find(lot => lot.order_line_id === line.id && lot.status === 'active')?.lot_code || line.lotCode || '');
    setCaseIdentifier('');
    setNetWeight('');
    setError(null);
  };
  const endWeighMode = () => {
    setWeighModeLineId('');
    setCaseIdentifier('');
    setNetWeight('');
    setError(null);
  };
  const startProduction = async () => {
    if (!window.confirm(`Start production for PO ${order.externalPo}?`)) return;
    await save(() => request(`/api/production/orders/${order.id}/start`));
  };
  const voidCase = async (productionCase: ProductionCase) => {
    const reason = window.prompt(`Why should case ${productionCase.case_identifier} be voided?`);
    if (reason == null) return;
    await save(() => request(`/api/production/cases/${productionCase.id}/void`, { reason }));
  };
  const labelData = (productionCase: ProductionCase, line: ProductionLine): CaseLabelData => ({
    itemDescription: productionItemName(line),
    itemId: productionItemIdentifier(line) === 'No item identifier' ? null : productionItemIdentifier(line),
    caseIdentifier: productionCase.case_identifier,
    packDate: new Date(productionCase.produced_at).toLocaleDateString(),
    productionCode: productionCase.lot_code || null,
    netWeight: productionCase.net_weight || 0,
    netWeightUom: productionCase.net_weight_uom || 'LB',
    gtin: line.gtin || null,
    gs1BarcodeValue: null,
    gs1HumanReadable: null,
  });
  const printLabel = async (productionCase: ProductionCase, line: ProductionLine) => {
    const printWindow = openBrowserCaseLabel(labelData(productionCase, line));
    if (!printWindow) {
      setError('Pop-up blocked. Allow pop-ups for Lucid Core to print labels.');
      return;
    }
    const printStarted = await startBrowserCaseLabelPrint(printWindow);
    if (!printStarted) {
      setError('The label window could not start printing. Keep the window open and try again.');
      return;
    }
    await save(() => request(`/api/production/cases/${productionCase.id}/label-printed`));
  };
  const previewCase = labelPreviewCaseId ? cases.find(productionCase => productionCase.id === labelPreviewCaseId) : undefined;
  const previewLine = previewCase ? order.lines.find(line => line.id === previewCase.order_line_id) : undefined;

  return <section className="production-workspace">
    <button type="button" className="text-button" onClick={onBack}>← Back to production queue</button>
    <div className="production-workbench surface">
    <header className="production-po-header">
      <div className="production-po-title"><span className="kicker">Production PO</span><h1>PO {order.externalPo}</h1><span className={`status-chip ${order.operationalStatus === 'production_complete' ? 'ready' : order.operationalStatus === 'in_production' ? 'progress' : 'needs'}`}>{statusLabel}</span>{order.sourceSystem === 'lucid_qa' && <span className="status-chip progress">TEST / QA</span>}</div>
      <dl className="production-po-details"><div><dt>Customer</dt><dd>{order.customer || 'Not specified'}</dd></div><div><dt>Ship-to</dt><dd>{order.shipTo || 'Not specified'}</dd></div><div><dt>Needed date</dt><dd>{order.requestedShipDate || 'Not specified'}</dd></div><div><dt>Warehouse</dt><dd>Not specified</dd></div><div><dt>Order date</dt><dd>{order.orderDate ? new Date(order.orderDate).toLocaleDateString() : 'Not specified'}</dd></div><div><dt>Total lines</dt><dd>{order.lines.length}</dd></div><div><dt>Total ordered cases</dt><dd>{orderedCases}</dd></div></dl>
    </header>
    {error && <p className="production-workspace-error" role="alert">{error}</p>}
    {previewCase && previewLine && <section className="surface case-label-preview"><div><span className="kicker">Label preview</span><h2>{productionItemName(previewLine)}</h2><p>{previewCase.case_identifier} · {previewCase.net_weight?.toFixed(2)} {previewCase.net_weight_uom}</p><small>Customer PO {order.externalPo} · Pack date {new Date(previewCase.produced_at).toLocaleDateString()}</small></div><button type="button" className="primary production-action" disabled={saving} onClick={() => void printLabel(previewCase, previewLine)}>{previewCase.label_print_count ? 'Reprint Label' : 'Print Label'}</button></section>}
    <section className="production-line-list"><div className="production-line-table-head" aria-hidden="true"><span>Item ID</span><span>Description</span><span>Ordered</span><span>Produced</span><span>Remaining</span><span>Total Weight</span><span>UOM</span><span>Lot / Prod Code</span><span>Action</span></div>{order.lines.map(line => {
      const produced = producedForLine(line.id);
      const remaining = Math.max(0, line.quantityCases - produced);
      const lineCases = cases.filter(productionCase => productionCase.order_line_id === line.id);
      const producedWeight = lineCases.filter(productionCase => productionCase.status !== 'voided').reduce((total, productionCase) => total + (productionCase.net_weight || 0), 0);
      const currentLot = lineCases.find(productionCase => productionCase.status !== 'voided' && productionCase.lot_code)?.lot_code || line.lotCode || 'Not specified';
      return <><article className={`production-line-card production-line-row ${weighModeLineId === line.id ? 'weighing' : ''}`} key={line.id}><div className="production-line-cell item-id"><small>Item ID</small><strong>{productionItemIdentifier(line)}</strong></div><div className="production-line-cell description"><small>Description</small><strong>{productionItemName(line)}</strong></div><div className="production-line-cell"><small>Ordered</small><strong>{line.quantityCases}</strong></div><div className="production-line-cell"><small>Produced</small><strong>{produced}</strong></div><div className="production-line-cell"><small>Remaining</small><strong>{remaining}</strong></div><div className="production-line-cell"><small>Total Weight</small><strong>{producedWeight ? `${producedWeight.toFixed(2)} lb` : '—'}</strong></div><div className="production-line-cell"><small>UOM</small><strong>{line.uom || '—'}</strong></div><div className="production-line-cell"><small>Lot / Prod Code</small><strong>{currentLot}</strong></div><div className="production-line-cell production-line-action"><small>Action</small>{order.operationalStatus === 'in_production' && <button type="button" className={weighModeLineId === line.id ? 'secondary' : 'primary'} disabled={saving || remaining === 0} title={remaining === 0 ? 'This item’s ordered quantity is complete.' : undefined} onClick={() => startWeighMode(line)}>{weighModeLineId === line.id ? 'In Weigh Mode' : remaining === 0 ? 'Item Complete' : 'Start Weigh Mode'}</button>}</div>{lineCases.length > 0 && <details className="production-case-history"><summary>{lineCases.length} case{lineCases.length === 1 ? '' : 's'}</summary><div>{lineCases.map(productionCase => <div key={productionCase.id} className={productionCase.status === 'voided' ? 'voided' : ''}><span>{productionCase.case_identifier}</span><strong>{productionCase.quantity} {productionCase.uom}{productionCase.net_weight != null ? ` · ${productionCase.net_weight.toFixed(2)} ${productionCase.net_weight_uom}` : ''}</strong><small>{productionCase.status === 'voided' ? `Voided: ${productionCase.void_reason || 'Corrected'}` : `${new Date(productionCase.produced_at).toLocaleString()}${productionCase.lot_code ? ` · Prod Code ${productionCase.lot_code}` : ''} · ${productionCase.label_print_count ? `Label printed ${productionCase.label_print_count}×` : 'Label not printed'}`}</small>{productionCase.status !== 'voided' && <button type="button" className="text-button" disabled={saving} onClick={() => void printLabel(productionCase, line)}>{productionCase.label_print_count ? 'Reprint' : 'Print Label'}</button>}{order.operationalStatus === 'in_production' && productionCase.status !== 'voided' && <button type="button" className="text-button danger-link" disabled={saving} onClick={() => void voidCase(productionCase)}>Void</button>}</div>)}</div></details>}</article>{order.operationalStatus === 'in_production' && weighModeLineId === line.id && <section className="inline-weigh-mode" aria-labelledby={`weigh-mode-${line.id}`}><div><span className="kicker">Weigh Mode</span><h2 id={`weigh-mode-${line.id}`}>{productionItemIdentifier(line)} · {productionItemName(line)}</h2><p>Ordered {line.quantityCases} · Produced {produced} · Remaining {remaining} {line.uom}</p></div><div className="inline-weigh-form"><label><span>Lot / Prod Code</span><input list="active-production-lots" required value={weighModeLot} onChange={event => setWeighModeLot(event.target.value)} placeholder="Select or enter lot" /><datalist id="active-production-lots">{activeLotsForWeighMode.map(lot => <option key={lot.id} value={lot.lot_code} />)}</datalist></label><label className="weigh-mode-weight"><span>Current net weight (lb)</span><input ref={weightInputRef} required inputMode="decimal" value={netWeight} onChange={event => setNetWeight(event.target.value)} placeholder="e.g. 42.36" /></label><label><span>Case ID (optional)</span><input value={caseIdentifier} onChange={event => setCaseIdentifier(event.target.value)} placeholder="Generated automatically" /></label><button type="button" className="primary production-action" disabled={saving} onClick={() => void addCase()}>{saving ? 'Creating…' : 'Create Case & Print Label'}</button><button type="button" className="secondary" disabled={saving} onClick={endWeighMode}>End Weigh Mode</button></div></section>}</>;
    })}</section>
    <section className="production-summary-strip"><div><small>Total lines</small><strong>{order.lines.length}</strong></div><div><small>Ordered cases</small><strong>{orderedCases}</strong></div><div><small>Produced cases</small><strong>{producedCases}</strong></div><div><small>Remaining cases</small><strong>{remainingCases}</strong></div><div><small>Total weight</small><strong>{capturedWeight ? `${capturedWeight.toFixed(2)} lb` : '—'}</strong></div><div><small>Palletized</small><strong>{palletizedCases}</strong></div><div><small>Waiting for pallet</small><strong>{waitingForPalletCases}</strong></div><div className="production-summary-action">{order.operationalStatus === 'ready_for_production' && <button type="button" className="primary production-action" disabled={saving} onClick={() => void startProduction()}>{saving ? 'Starting…' : 'Start Production'}</button>}{order.operationalStatus === 'in_production' && <button type="button" className="primary production-action" disabled={saving || !allProduced} title={allProduced ? undefined : 'Finish every ordered quantity before completing production.'} onClick={() => void save(() => request(`/api/production/orders/${order.id}/complete`))}>{saving ? 'Completing…' : 'Complete Production'}</button>}{order.operationalStatus === 'production_complete' && <button type="button" className="primary production-action" onClick={onStartPalletizing}>Start Palletizing</button>}</div><span className="production-progress"><i style={{ width: `${progress}%` }} /></span></section>
    <ProductionGenealogyWorkspace
      organizationId={organizationId}
      role={role}
      orderId={order.id}
      lines={order.lines.map(line => ({ id: line.id, itemCode: productionItemIdentifier(line), description: productionItemName(line), quantity: line.quantityCases, uom: line.uom }))}
      lots={lots}
      cases={cases}
      onRefresh={onRefresh}
    />
    </div>
  </section>;
}

function PalletBreakdownHub({ orders, pallets, cases, assignments, activities, role, selectedPallet, onOpenPallet, onClosePallet, onRefresh }: {
  orders: OperationalOrder[];
  pallets: OperationalPallet[];
  cases: ProductionCase[];
  assignments: PalletCaseAssignment[];
  activities: PalletActivity[];
  role: Role;
  selectedPallet: OperationalPallet | undefined;
  onOpenPallet: (palletId: string) => void;
  onClosePallet: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = async (path: string, body?: object) => {
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json().catch(() => null) as ({ success?: boolean; error?: string } & Record<string, unknown>) | null;
    if (!response.ok || !result?.success) throw new Error(result?.error || 'The pallet update could not be saved.');
    return result;
  };
  const save = async <T,>(action: () => Promise<T>) => {
    if (saving) return undefined;
    setSaving(true); setError(null);
    try { const result = await action(); await onRefresh(); return result; }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The pallet update could not be saved.'); return undefined; }
    finally { setSaving(false); }
  };
  const createPallet = async (orderId: string) => {
    const result = await save(() => request(`/api/production/orders/${orderId}/pallets`));
    if (typeof result?.pallet_id === 'string') onOpenPallet(result.pallet_id);
  };
  const reopenPallet = async (palletId: string) => {
    const reason = window.prompt('Why does this completed pallet need correction?');
    if (reason == null) return;
    if (!reason.trim()) { setError('A correction reason is required to reopen this pallet.'); return; }
    await save(() => request(`/api/production/pallets/${palletId}/reopen`, { reason }));
  };

  if (selectedPallet) {
    const order = orders.find(candidate => candidate.id === selectedPallet.order_id);
    const assignedCaseIds = new Set(assignments.filter(assignment => assignment.pallet_id === selectedPallet.id && assignment.production_case_id).map(assignment => assignment.production_case_id));
    const assignedCases = cases.filter(productionCase => assignedCaseIds.has(productionCase.id));
    const availableCases = cases.filter(productionCase => productionCase.order_id === selectedPallet.order_id && productionCase.status === 'produced' && !productionCase.pallet_id);
    const totalCases = assignedCases.reduce((total, productionCase) => total + productionCase.quantity, 0);
    const totalWeight = assignedCases.reduce((total, productionCase) => total + (productionCase.net_weight || 0), 0);
    const palletActivity = activities.filter(activity => activity.pallet_id === selectedPallet.id);
    const lastActivity = palletActivity[0];
    const canReopen = ['office', 'leadership', 'lucid_admin'].includes(role);
    const reopenedForCorrection = selectedPallet.status === 'building' && Boolean(selectedPallet.reopened_at);
    const casesByLine = new Map<string, ProductionCase[]>();
    for (const productionCase of assignedCases) {
      const grouped = casesByLine.get(productionCase.order_line_id) || [];
      grouped.push(productionCase);
      casesByLine.set(productionCase.order_line_id, grouped);
    }

    return <section className="pallet-workspace">
      <button type="button" className="text-button" onClick={onClosePallet}>← Back to pallet breakdowns</button>
      <header className="surface pallet-workspace-header"><div><span className="kicker">Digital pallet breakdown</span><h1>{selectedPallet.pallet_identifier}</h1><p>{order ? `${order.customer} · PO ${order.externalPo} · ${order.shipTo}` : 'Order details unavailable'}</p></div><span className={`status-chip ${selectedPallet.status === 'complete' ? 'ready' : 'progress'}`}>{selectedPallet.status === 'complete' ? 'Completed' : reopenedForCorrection ? 'Reopened for correction' : 'Building'}</span></header>
      {error && <p className="production-workspace-error" role="alert">{error}</p>}
      <section className="surface pallet-total-strip"><div><small>Total cases</small><strong>{totalCases}</strong></div><div><small>Total net weight</small><strong>{totalWeight.toFixed(2)} lb</strong></div><div><small>Items</small><strong>{casesByLine.size}</strong></div><div><small>Created by</small><strong>{selectedPallet.created_by_name || 'Team member'}</strong></div><div><small>Last updated</small><strong>{lastActivity?.actor_name || '—'}</strong></div>{selectedPallet.status === 'building' ? <button type="button" className="primary production-action" disabled={saving} onClick={() => void save(() => request(`/api/production/pallets/${selectedPallet.id}/complete`))}>{saving ? 'Completing…' : 'Complete Pallet'}</button> : <div className="pallet-complete-note"><strong>Completed</strong><small>{selectedPallet.completed_by_name ? `Completed by ${selectedPallet.completed_by_name}` : 'Completed'}{selectedPallet.completed_at ? ` · ${new Date(selectedPallet.completed_at).toLocaleString()}` : ''}</small>{canReopen ? <button type="button" className="secondary" disabled={saving} onClick={() => void reopenPallet(selectedPallet.id)}>Reopen Pallet</button> : <small>Ask office or leadership to reopen for correction.</small>}</div>}</section>
      {selectedPallet.status === 'building' && <PalletCaseAdder cases={availableCases} saving={saving} onAdd={caseIdentifier => void save(() => request(`/api/production/pallets/${selectedPallet.id}/cases`, { caseIdentifier }))} />}
      <section className="pallet-item-groups">{Array.from(casesByLine.entries()).map(([lineId, lineCases]) => {
        const line = order?.lines.find(candidate => candidate.id === lineId);
        const lineWeight = lineCases.reduce((total, productionCase) => total + (productionCase.net_weight || 0), 0);
        return <article className="surface pallet-item-group" key={lineId}><div className="pallet-item-head"><div><span className="kicker">Item</span><h2>{line ? productionItemName(line) : 'Item details unavailable'}</h2><p>{line ? productionItemIdentifier(line) : 'No item identifier'}</p></div><div><strong>{lineCases.reduce((total, productionCase) => total + productionCase.quantity, 0)} cases</strong><small>{lineWeight.toFixed(2)} lb total</small></div></div><details><summary>Show {lineCases.length} case{lineCases.length === 1 ? '' : 's'}</summary><div className="pallet-case-list">{lineCases.map(productionCase => <div key={productionCase.id}><span><strong>{productionCase.case_identifier}</strong><small>{productionCase.produced_at ? new Date(productionCase.produced_at).toLocaleString() : 'Production time unavailable'}{productionCase.lot_code ? ` · Prod Code ${productionCase.lot_code}` : ''}</small></span><strong>{productionCase.net_weight == null ? 'Weight unavailable' : `${productionCase.net_weight.toFixed(2)} ${productionCase.net_weight_uom}`}</strong>{selectedPallet.status === 'building' && <button type="button" className="text-button danger-link" disabled={saving} onClick={() => void save(() => request(`/api/production/pallets/${selectedPallet.id}/cases/${productionCase.id}/remove`))}>Remove from pallet</button>}</div>)}</div></details></article>;
      })}</section>
      <section className="surface pallet-activity"><div><span className="kicker">Activity</span><h2>What happened on this pallet</h2></div><div>{palletActivity.length ? palletActivity.map(activity => <p key={activity.id}><strong>{activity.actor_name || 'A team member'}</strong> {palletActivityCopy(activity.action, activity.details)}<small>{new Date(activity.created_at).toLocaleString()}</small></p>) : <p className="pallet-activity-empty">Activity will appear as the team works on this pallet.</p>}</div></section>
      {!assignedCases.length && <Empty title="No cases on this pallet yet" text="Scan or select an available case to begin the pallet breakdown." />}
    </section>;
  }

  const buildableOrders = orders.filter(order => ['in_production', 'production_complete'].includes(order.operationalStatus));
  return <section className="pallet-workspace"><header className="page-heading"><div><span className="kicker">Pallet Breakdown</span><h1>Build each pallet from finished cases.</h1><p>Scan or select existing cases, then complete the digital breakdown when the pallet is ready.</p></div></header>{error && <p className="production-workspace-error" role="alert">{error}</p>}<section className="pallet-order-list">{buildableOrders.map(order => { const orderPallets = pallets.filter(pallet => pallet.order_id === order.id); const palletized = cases.filter(productionCase => productionCase.order_id === order.id && productionCase.status === 'palletized').reduce((total, productionCase) => total + productionCase.quantity, 0); return <article className="surface pallet-order-card" key={order.id}><div><span className="kicker">PO {order.externalPo}</span><h2>{order.customer}</h2><p>{order.shipTo} · {palletized} cases already palletized</p></div><div className="pallet-order-actions"><button type="button" className="primary" disabled={saving} onClick={() => void createPallet(order.id)}>{saving ? 'Creating…' : 'Create Pallet'}</button>{orderPallets.map(pallet => <button type="button" className="secondary" key={pallet.id} onClick={() => onOpenPallet(pallet.id)}>{pallet.pallet_identifier} · {pallet.status === 'complete' ? 'Complete' : 'Building'}</button>)}</div></article>; })}</section>{!buildableOrders.length && <Empty title="No orders are ready for pallet building" text="Start production and record cases first." />}</section>;
}

function PalletCaseAdder({ cases, saving, onAdd }: { cases: ProductionCase[]; saving: boolean; onAdd: (caseIdentifier: string) => void }) {
  const [caseIdentifier, setCaseIdentifier] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (caseIdentifier.trim()) { onAdd(caseIdentifier); setCaseIdentifier(''); } };
  return <section className="surface pallet-case-adder"><div><span className="kicker">Add existing case</span><h2>Scan or enter Case ID</h2><p>Only available cases from this order can be added.</p></div><form onSubmit={submit}><label><span>Case ID</span><input autoFocus value={caseIdentifier} onChange={event => setCaseIdentifier(event.target.value)} placeholder="Scan or enter case ID" /></label><button className="primary" disabled={saving} type="submit">Add Case</button></form><label className="pallet-case-select"><span>Or select an available case</span><select value="" disabled={saving} onChange={event => { if (event.target.value) onAdd(event.target.value); }}><option value="">Choose a case</option>{cases.map(productionCase => <option key={productionCase.id} value={productionCase.case_identifier}>{productionCase.case_identifier} · {productionCase.net_weight?.toFixed(2) || '—'} {productionCase.net_weight_uom}</option>)}</select></label></section>;
}

function StagedOrderReviewWorkspace({ order, lines, allLines, exceptions, role, onOpenProduction, onPromotionFailure, onSaved }: {
  order: StagedOrder;
  lines: StagedLine[];
  allLines: StagedLine[];
  exceptions: StagedException[];
  role: Role;
  onOpenProduction: (operationalOrderId: string) => void;
  onPromotionFailure: (message: string) => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const openExceptions = exceptions.filter(exception => exception.status === 'open');
  const resolvedExceptions = exceptions.filter(exception => exception.status === 'resolved');
  const [activeExceptionId, setActiveExceptionId] = useState(openExceptions[0]?.id || '');
  type ReviewStep = 'customer' | 'items' | 'details';
  const [activeStep, setActiveStep] = useState<ReviewStep>('customer');
  const customerExceptions = openExceptions.filter(exception => ['CUSTOMER_UNMAPPED', 'SHIP_TO_UNMAPPED'].includes(exception.exception_code));
  const itemExceptions = openExceptions.filter(exception => exception.exception_code === 'ITEM_UNMAPPED');
  const detailExceptions = openExceptions.filter(exception => !['CUSTOMER_UNMAPPED', 'SHIP_TO_UNMAPPED', 'ITEM_UNMAPPED'].includes(exception.exception_code));
  const firstIncompleteStep: ReviewStep | null = customerExceptions.length ? 'customer' : itemExceptions.length ? 'items' : detailExceptions.length ? 'details' : null;
  useEffect(() => {
    setActiveExceptionId(openExceptions[0]?.id || '');
    setActiveStep(firstIncompleteStep || 'customer');
  }, [order.id]);
  useEffect(() => {
    const activeExceptions = activeStep === 'customer' ? customerExceptions : activeStep === 'items' ? itemExceptions : detailExceptions;
    if (!activeExceptions.length && firstIncompleteStep) setActiveStep(firstIncompleteStep);
    if (activeExceptions.length && !activeExceptions.some(exception => exception.id === activeExceptionId)) setActiveExceptionId(activeExceptions[0].id);
  }, [activeStep, activeExceptionId, firstIncompleteStep, customerExceptions, itemExceptions, detailExceptions]);
  const mappedLines = lines.filter(line => line.item_mapping_status === 'mapped').length;
  const leadershipPending = openExceptions.some(exception => exception.exception_code === 'PRICE_MISMATCH' && Boolean(exception.details && typeof exception.details === 'object' && 'leadership_review_requested_at' in exception.details));
  const readinessLabel = leadershipPending ? 'Waiting on leadership' : order.review_status === 'ready' ? 'Ready to process' : 'Not ready yet';
  const hasOpen = (code: string) => openExceptions.some(exception => exception.exception_code === code);
  const priceDifferences = openExceptions.filter(exception => exception.exception_code === 'PRICE_MISMATCH').length;
  const checksLeft = customerExceptions.length + itemExceptions.length + detailExceptions.length;
  const checksComplete = Math.max(0, lines.length + 3 - checksLeft);
  const checklistProgress = Math.min(100, Math.round((checksComplete / Math.max(lines.length + 3, 1)) * 100));
  const [promotionPending, setPromotionPending] = useState(false);
  const [promotionError, setPromotionError] = useState<string | null>(null);
  const [promotionResult, setPromotionResult] = useState<{ operationalOrderId: string; alreadyPromoted: boolean } | null>(null);
  const canSendToProduction = order.review_status === 'ready' && ['office', 'leadership', 'lucid_admin'].includes(role);
  const sendToProduction = async (stagedOrderId: string | null | undefined) => {
    if (process.env.NODE_ENV === 'development') {
      console.info('[send-to-production] click received', { stagedOrderId });
    }

    if (!stagedOrderId) {
      const message = 'This incoming order does not have a valid ID.';
      setPromotionError(message);
      onPromotionFailure(message);
      return;
    }

    if (promotionPending) return;

    setPromotionPending(true);
    setPromotionError(null);
    try {
      if (process.env.NODE_ENV === 'development') {
        console.info('[send-to-production] starting request', { stagedOrderId });
      }

      const response = await fetch(`/api/sps/staged-orders/${stagedOrderId}/send-to-production`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const result = await response.json().catch(() => null) as { success?: boolean; error?: string; alreadyPromoted?: boolean; operationalOrderId?: string } | null;
      if (!response.ok || !result?.success) throw new Error(result?.error || 'Unable to send this order to production.');
      if (!result.operationalOrderId) throw new Error('The production order was not returned after sending.');
      setPromotionResult({ operationalOrderId: result.operationalOrderId, alreadyPromoted: Boolean(result.alreadyPromoted) });
      await onSaved(result.alreadyPromoted ? 'This order was already sent to production.' : 'Order is ready for production.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to send this order to production.';
      setPromotionError(message); onPromotionFailure(message);
    } finally { setPromotionPending(false); }
  };
  const openItemException = (lineId: string) => openExceptions.find(exception => exception.staged_order_line_id === lineId && exception.exception_code === 'ITEM_UNMAPPED');
  const repeatedIncomingItemCount = (line: StagedLine) => {
    const identifier = line.buyer_part_number || line.vendor_item || line.gtin;
    if (!identifier || line.item_mapping_status === 'mapped') return 0;
    return new Set(allLines.filter(candidate => candidate.item_mapping_status !== 'mapped' && (candidate.buyer_part_number || candidate.vendor_item || candidate.gtin) === identifier).map(candidate => candidate.staged_order_id)).size;
  };
  const stepSummary = (step: ReviewStep, label: string, description: string, stepExceptions: StagedException[]) => {
    const isActive = activeStep === step && stepExceptions.length > 0;
    const status = !stepExceptions.length ? 'Confirmed' : step === 'items' ? `${mappedLines} of ${lines.length} matched` : leadershipPending && step === 'details' ? 'Waiting on leadership' : 'Needs review';
    return <section className={`surface guided-review-step ${isActive ? 'active' : ''}`} key={step}>
      <button type="button" className="guided-review-step-head" onClick={() => stepExceptions.length && setActiveStep(step)} aria-expanded={isActive}>
        <div><span className="kicker">{label}</span><strong>{status}</strong><small>{description}</small></div>
        {stepExceptions.length > 0 && <span className={`status-chip ${leadershipPending && step === 'details' ? 'progress' : 'needs'}`}>{isActive ? 'In progress' : 'Review'}</span>}
      </button>
      {isActive && <div className="guided-review-step-body">
        <p className="guided-next-action">Next: {step === 'customer' ? 'confirm the customer or delivery location.' : step === 'items' ? 'match the next incoming item.' : 'review the next order detail.'}</p>
        {step === 'items' && <div className="guided-item-progress"><strong>{mappedLines} of {lines.length} matched</strong><span className="production-progress"><i style={{ width: `${lines.length ? Math.round((mappedLines / lines.length) * 100) : 0}%` }} /></span></div>}
        {stepExceptions[0] && <StagedReviewAction exception={stepExceptions[0]} order={order} line={lines.find(line => line.id === stepExceptions[0].staged_order_line_id)} role={role} isOpen={activeExceptionId === stepExceptions[0].id} onOpen={() => setActiveExceptionId(stepExceptions[0].id)} onSaved={onSaved} />}
      </div>}
    </section>;
  };

  return <section className="review-workspace">
    <header className="surface review-order-summary">
      <div>
        <span className="kicker">Staged purchase order</span>
        <h2>PO {order.external_po}</h2>
        <p>{order.trading_partner_id ? `Trading partner ${order.trading_partner_id} · ` : ''}{order.source_customer_name || 'Customer to confirm'} · {order.source_ship_to_name || order.source_ship_to_code || 'Ship-to to confirm'}</p>
      </div>
      <div className="review-summary-meta">
        <span><small>PO date</small><strong>{order.po_date || '—'}</strong></span>
        <span><small>Line items</small><strong>{lines.length}</strong></span>
        <span className={`status-chip ${order.review_status === 'ready' ? 'ready' : 'needs'}`}>{readinessLabel}</span>
      </div>
    </header>

    <section className="surface guided-review-progress" aria-label="Order check progress"><strong>{checksLeft ? `${checksLeft} thing${checksLeft === 1 ? '' : 's'} left to check` : 'Everything is confirmed'}</strong><span className="production-progress"><i style={{ width: `${checklistProgress}%` }} /></span><small>Lucid will remember what you confirm.</small></section>

    <div className="review-workspace-grid">
      <main className="review-queue">
        <div className="review-queue-intro"><span className="kicker">Order check</span><h3>Let’s get this order ready.</h3><p>Work through the remaining checks. Lucid will remember what you confirm.</p></div>
        {stepSummary('customer', 'Customer', 'Customer and ship-to', customerExceptions)}
        {stepSummary('items', 'Items', 'All incoming line items', itemExceptions)}
        {stepSummary('details', 'Order details', 'Quantity, price, and requested date', detailExceptions)}
        {activeStep === 'items' && <section className="surface compact-item-list"><div className="section-head"><div><span className="kicker">Incoming items</span><h3>Review items one at a time</h3></div></div>{lines.map(line => <div className="line-mapping-row" key={line.id}><div><strong>#{line.line_number || '—'} {line.description || 'No description'}</strong><small>{line.quantity ?? '—'} {line.sps_uom || ''}</small></div><span className={`status-chip ${line.item_mapping_status === 'mapped' ? 'ready' : 'needs'}`}>{line.item_mapping_status === 'mapped' ? 'Matched' : 'Needs matching'}</span></div>)}</section>}
      </main>

      <aside className="review-side-rail">
        <section className="surface review-progress-card review-checklist">
          <span className="kicker">Order checklist</span>
          <dl><div><dt>Customer</dt><dd className={customerExceptions.length ? 'pending' : 'confirmed'}>{customerExceptions.length ? 'Needs review' : 'Confirmed'}</dd></div><div><dt>Items</dt><dd className={itemExceptions.length ? 'pending' : 'confirmed'}>{mappedLines} of {lines.length}</dd></div><div><dt>Order details</dt><dd className={detailExceptions.length ? 'pending' : 'confirmed'}>{leadershipPending ? 'Waiting on leadership' : detailExceptions.length ? `${detailExceptions.length} checks remaining` : 'Confirmed'}</dd></div></dl>
          <p>{readinessLabel}</p>
        </section>
        <section className="surface review-side-details"><span className="kicker">What came in</span><dl><div><dt>Customer</dt><dd>{order.source_customer_name || 'To be confirmed'}</dd></div><div><dt>Ship-to</dt><dd>{order.source_ship_to_name || order.source_ship_to_code || 'To be confirmed'}</dd></div><div><dt>Requested date</dt><dd>{order.requested_ship_date || 'Not provided'}</dd></div><div><dt>Next step</dt><dd>{readinessLabel}</dd></div></dl></section>
        <section className="surface production-handoff-card">{promotionResult || order.review_status === 'promoted' ? <><span className="kicker">Production</span><strong>Order is ready for production</strong><span className="production-sent-copy">Already sent to production</span>{(promotionResult?.operationalOrderId || order.promoted_order_id) && <button type="button" className="primary" onClick={() => onOpenProduction(promotionResult?.operationalOrderId || order.promoted_order_id!)}>Open Production Order</button>}</> : canSendToProduction ? <><span className="kicker">Ready for production</span><strong>All required checks are confirmed.</strong><small>Safe Mode permits this internal Lucid Core action. It does not change the incoming SPS order or any external system.</small><button type="button" className="primary" disabled={promotionPending} aria-busy={promotionPending} onClick={() => void sendToProduction(order.id)}>{promotionPending ? 'Sending...' : 'Send to Production'}</button>{promotionError && <p className="production-handoff-error" role="alert"><strong>Could not send to production:</strong> {promotionError}</p>}</> : <><span className="kicker">Next step</span><strong>{order.review_status === 'ready' ? 'Only an authorized role can send this order to production.' : 'Complete the remaining order checks first.'}</strong></>}</section>
      </aside>
    </div>

    <details className="surface reviewed-panel"><summary>Resolved ({resolvedExceptions.length})</summary>{resolvedExceptions.map(exception => <div className="reviewed-row" key={exception.id}><div><strong>{stagedExceptionLabel(exception.exception_code)}</strong><span>{exception.resolution_action || 'Resolved'}{exception.resolved_by_name ? ` · ${exception.resolved_by_name}` : ''} · {exception.resolved_at ? new Date(exception.resolved_at).toLocaleString() : 'Saved'}</span></div></div>)}</details>
  </section>;
}

function StagedReviewAction({ exception, order, line, role, isOpen, onOpen, onSaved }: {
  exception: StagedException;
  order: StagedOrder;
  line?: StagedLine;
  role: Role;
  isOpen: boolean;
  onOpen: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customer, setCustomer] = useState({ id: '', name: '' });
  const [shipTo, setShipTo] = useState({ id: '', name: '' });
  const [item, setItem] = useState({ id: '', number: '', uom: '', approvedPrice: '' });
  const [nativeCustomerId, setNativeCustomerId] = useState('');
  const [nativeShipToId, setNativeShipToId] = useState('');
  const [nativeItemId, setNativeItemId] = useState('');
  const [nativeCustomerItemId, setNativeCustomerItemId] = useState('');
  const [nativeCustomers, setNativeCustomers] = useState<Array<{ id: string; customer_code: string | null; name: string }>>([]);
  const [nativeShipTos, setNativeShipTos] = useState<Array<{ id: string; customer_id: string; location_code: string | null; name: string }>>([]);
  const [nativeItems, setNativeItems] = useState<Array<{ id: string; item_code: string; description: string; stock_uom: string | null; sell_uom: string | null }>>([]);
  const [nativeCustomerItems, setNativeCustomerItems] = useState<Array<{ id: string; customer_id: string; item_id: string; customer_sku: string | null }>>([]);
  const nativeSupabase = useMemo(() => createClient(), []);
  const canMap = ['lucid_admin', 'leadership', 'office'].includes(role);
  const canFinalizePrice = ['lucid_admin', 'leadership'].includes(role);

  useEffect(() => {
    if (!canMap) return;
    void Promise.all([
      nativeSupabase.from('customers').select('id, customer_code, name').eq('status', 'active').order('name'),
      nativeSupabase.from('customer_ship_tos').select('id, customer_id, location_code, name').eq('status', 'active').order('name'),
      nativeSupabase.from('items').select('id, item_code, description, stock_uom, sell_uom').eq('status', 'active').order('item_code'),
      nativeSupabase.from('customer_items').select('id, customer_id, item_id, customer_sku').eq('status', 'active'),
    ]).then(([customersResult, shipTosResult, itemsResult, customerItemsResult]) => {
      if (!customersResult.error) setNativeCustomers(customersResult.data || []);
      if (!shipTosResult.error) setNativeShipTos(shipTosResult.data || []);
      if (!itemsResult.error) setNativeItems(itemsResult.data || []);
      if (!customerItemsResult.error) setNativeCustomerItems(customerItemsResult.data || []);
    });
  }, [canMap, nativeSupabase]);

  const submit = async (path: string, body: Record<string, unknown>, message: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null) as { success?: boolean; error?: string } | null;
      if (!response.ok || !result?.success) throw new Error(result?.error || 'Unable to save this review decision.');
      await onSaved(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save this review decision.');
    } finally {
      setSaving(false);
    }
  };

  const routineConfirmation = ['CUSTOMER_UNMAPPED', 'SHIP_TO_UNMAPPED', 'ITEM_UNMAPPED'].includes(exception.exception_code);
  const severityTone = routineConfirmation ? 'warning' : exception.severity === 'blocking' ? 'danger' : exception.severity === 'warning' ? 'warning' : 'info';
  const lineSummary = line ? `Line ${line.line_number || '—'} · ${line.description || 'Item description unavailable'}` : null;
  const resolve = (resolutionAction: string, message: string) => submit(
    `/api/sps/exceptions/${exception.id}/resolve`,
    { resolutionAction },
    message,
  );

  return <article className={`surface review-issue ${isOpen ? 'open' : ''}`}>
    <button className="review-issue-header" type="button" onClick={onOpen} aria-expanded={isOpen}>
      <div className={`work-icon ${severityTone}`}>{exception.severity === 'blocking' ? '!' : exception.severity === 'warning' ? '!' : 'i'}</div>
      <div>
        <span className="kicker">{lineSummary || exception.field_name || 'Order details'}</span>
        <h3>{stagedExceptionLabel(exception.exception_code)}</h3>
        <p>{exception.message}</p>
      </div>
      <span className="review-issue-cta">{isOpen ? 'Reviewing' : 'Review'} <ChevronRight size={16} /></span>
    </button>

    {isOpen && <div className="review-issue-body">
    {exception.exception_code === 'PRICE_MISMATCH' && <div className="review-panel">
      <div className="review-note"><strong>{lineSummary || 'Price needs review'}</strong><span>SPS price: {line?.sps_purchase_price == null ? 'Not provided' : `$${line.sps_purchase_price}`} · Approved Circle R price: {line?.approved_circle_r_price == null ? 'Not set' : `$${line.approved_circle_r_price}`}</span></div>
      <div className="review-footer">
        <span>{canFinalizePrice ? 'Choose which price should guide this staged order. Both original prices remain recorded.' : role === 'office' ? 'You can send this price difference to leadership for a final choice.' : 'Your role cannot resolve this price difference.'}</span>
        <div className="exception-actions">
          {canFinalizePrice && <><button className="secondary" disabled={saving} onClick={() => void resolve('use_sps_price', 'SPS price selected and saved.')}>Use SPS Price</button><button className="primary" disabled={saving} onClick={() => void resolve('use_approved_circle_r_price', 'Approved Circle R price selected and saved.')}>Use Approved Circle R Price</button></>}
          {['office', 'leadership', 'lucid_admin'].includes(role) && <button className="text-button" disabled={saving} onClick={() => void resolve('needs_leadership_review', 'Leadership review was requested.')}>Needs Leadership Review</button>}
        </div>
      </div>
    </div>}

    {exception.exception_code === 'CUSTOMER_UNMAPPED' && <form className="review-panel" onSubmit={event => { event.preventDefault(); void submit(`/api/sps/exceptions/${exception.id}/map-customer`, { customerId: nativeCustomerId || undefined, foodConnexCustomerId: customer.id || undefined, foodConnexCustomerName: customer.name || undefined }, 'Customer mapping saved.'); }}>
      <div className="review-note"><strong>Which Lucid Customer belongs to this SPS trading partner?</strong><span>SPS trading partner: {order.source_customer_name || 'Customer name not provided'}. Lucid will remember this match for future orders.</span></div>
      {canMap ? <><div className="review-grid"><label><span>Lucid Customer</span><select value={nativeCustomerId} onChange={event => { const selected = nativeCustomers.find(record => record.id === event.target.value); setNativeCustomerId(event.target.value); if (selected) setCustomer({ id: selected.customer_code || '', name: selected.name }); }}><option value="">Choose a Lucid Customer</option>{nativeCustomers.map(record => <option key={record.id} value={record.id}>{record.customer_code ? `${record.customer_code} · ` : ''}{record.name}</option>)}</select></label><label><span>Legacy fallback ID</span><input required={!nativeCustomerId} value={customer.id} onChange={event => setCustomer({ ...customer, id: event.target.value })} /></label><label><span>Customer name</span><input required={!nativeCustomerId} value={customer.name} onChange={event => setCustomer({ ...customer, name: event.target.value })} /></label></div><div className="review-footer"><span>Select a Lucid Customer when it exists; legacy fields remain available for older mappings.</span><button className="primary" disabled={saving} type="submit">{saving ? 'Saving…' : 'Confirm Customer'}</button></div></> : <p className="prototype-note">Your role cannot confirm customer records.</p>}
    </form>}

    {exception.exception_code === 'SHIP_TO_UNMAPPED' && <form className="review-panel" onSubmit={event => { event.preventDefault(); void submit(`/api/sps/exceptions/${exception.id}/map-ship-to`, { shipToId: nativeShipToId || undefined, foodConnexShipToId: shipTo.id || undefined, foodConnexShipToName: shipTo.name || undefined }, 'Ship-to mapping saved.'); }}>
      <div className="review-note"><strong>Which Lucid Ship-To should this order use?</strong><span>SPS location: {order.source_ship_to_code || 'Not provided'} · {order.source_ship_to_name || 'Ship-to name not provided'}. Lucid will remember this location for future orders.</span></div>
      {canMap ? <><div className="review-grid"><label><span>Lucid Ship-To</span><select value={nativeShipToId} onChange={event => { const selected = nativeShipTos.find(record => record.id === event.target.value); setNativeShipToId(event.target.value); if (selected) setShipTo({ id: selected.location_code || '', name: selected.name }); }}><option value="">Choose a Lucid Ship-To</option>{nativeShipTos.map(record => <option key={record.id} value={record.id}>{record.location_code ? `${record.location_code} · ` : ''}{record.name}</option>)}</select></label><label><span>Legacy fallback ID</span><input required={!nativeShipToId} value={shipTo.id} onChange={event => setShipTo({ ...shipTo, id: event.target.value })} /></label><label><span>Ship-to name</span><input required={!nativeShipToId} value={shipTo.name} onChange={event => setShipTo({ ...shipTo, name: event.target.value })} /></label></div><div className="review-footer"><span>Select a Lucid Ship-To when it exists; legacy fields remain available for older mappings.</span><button className="primary" disabled={saving} type="submit">{saving ? 'Saving…' : 'Confirm Ship-to'}</button></div></> : <p className="prototype-note">Your role cannot confirm ship-to records.</p>}
    </form>}

    {exception.exception_code === 'ITEM_UNMAPPED' && <form className="review-panel" onSubmit={event => { event.preventDefault(); const approvedPrice = item.approvedPrice.trim() === '' ? undefined : Number(item.approvedPrice); if (approvedPrice !== undefined && !Number.isFinite(approvedPrice)) { setError('Enter a valid approved Circle R price.'); return; } void submit(`/api/sps/exceptions/${exception.id}/map-item`, { itemId: nativeItemId || undefined, customerItemId: nativeCustomerItemId || undefined, foodConnexItemId: item.id || undefined, foodConnexItemNumber: item.number || undefined, foodConnexUom: item.uom || undefined, approvedCircleRPrice: approvedPrice }, 'Item mapping saved.'); }}>
      <div className="review-note"><strong>Which Lucid Item matches this SPS line?</strong><span>{lineSummary || 'Item details'}. Buyer SKU: {line?.buyer_part_number || '—'} · Vendor item: {line?.vendor_item || '—'} · GTIN: {line?.gtin || '—'}<br />Once matched, Lucid can recognize this item automatically on future orders.</span></div>
      {canMap ? <><div className="review-grid"><label><span>Lucid Item</span><select value={nativeItemId} onChange={event => { const selected = nativeItems.find(record => record.id === event.target.value); setNativeItemId(event.target.value); setNativeCustomerItemId(''); if (selected) setItem({ ...item, id: selected.id, number: selected.item_code, uom: selected.stock_uom || selected.sell_uom || item.uom }); }}><option value="">Choose a Lucid Item</option>{nativeItems.map(record => <option key={record.id} value={record.id}>{record.item_code} · {record.description}</option>)}</select></label><label><span>Customer Item</span><select value={nativeCustomerItemId} onChange={event => setNativeCustomerItemId(event.target.value)}><option value="">Optional customer-specific item</option>{nativeCustomerItems.filter(record => !nativeItemId || record.item_id === nativeItemId).map(record => <option key={record.id} value={record.id}>{record.customer_sku || 'Customer item'} </option>)}</select></label><label><span>Legacy fallback Item ID</span><input value={item.id} onChange={event => setItem({ ...item, id: event.target.value })} /></label><label><span>Legacy fallback Item Code</span><input required={!nativeItemId} value={item.number} onChange={event => setItem({ ...item, number: event.target.value })} /></label><label><span>UOM</span><input value={item.uom} onChange={event => setItem({ ...item, uom: event.target.value })} /></label><label><span>Approved Circle R Price</span><input inputMode="decimal" value={item.approvedPrice} onChange={event => setItem({ ...item, approvedPrice: event.target.value })} /></label></div><div className="review-footer"><span>A price difference will remain visible for review after the item is confirmed.</span><button className="primary" disabled={saving} type="submit">{saving ? 'Saving…' : 'Confirm Item'}</button></div></> : <p className="prototype-note">Your role cannot confirm item records.</p>}
    </form>}

    {['REQUESTED_DATE_UNMAPPED', 'HEADER_QUANTITY_MISMATCH'].includes(exception.exception_code) && <div className="review-panel"><div className="review-note"><strong>{exception.exception_code === 'REQUESTED_DATE_UNMAPPED' ? 'Date needs review' : 'Order quantity needs review'}</strong><span>The original SPS value is kept unchanged. Confirm that this difference has been reviewed before resolving it.</span></div><div className="review-footer"><span>{exception.suggested_actions.join(' · ')}</span><button className="primary" disabled={saving} onClick={() => void resolve('acknowledged_for_review', 'This order difference was acknowledged and saved.')}>{saving ? 'Saving…' : 'Acknowledge / Resolve'}</button></div></div>}

    {error && <p className="prototype-note"><strong>Could not save:</strong> {error}</p>}
    </div>}
  </article>;
}

function OrderDetail({ order, setSection, onPrint, onDownload, onSave, canEdit }: { order: UnifiedOrder; setSection: (s: Section) => void; onPrint: () => void; onDownload: () => void; onSave: (next: UnifiedOrder) => void; canEdit: boolean }) {
  const issues = orderIssues(order);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<UnifiedOrder>(order);
  useEffect(() => { setDraft(order); }, [order]);
  const updateLine = (idx: number, patch: Partial<UnifiedOrder['lines'][number]>) => setDraft(prev => ({ ...prev, lines: prev.lines.map((l,i) => i === idx ? { ...l, ...patch } : l) }));
  if (editing) return <section className="surface detail-card edit-card"><div className="section-head"><div><span className="kicker">Correct order</span><h2>PO {order.externalPo}</h2><p>Corrections remain traceable. Safe Mode does not push them to SPS or Food Connex yet.</p></div></div><div className="edit-grid"><label><span>PO</span><input value={draft.externalPo} onChange={e => setDraft({...draft,externalPo:e.target.value})}/></label><label><span>Customer</span><input value={draft.customer} onChange={e => setDraft({...draft,customer:e.target.value})}/></label><label><span>Ship to</span><input value={draft.shipTo} onChange={e => setDraft({...draft,shipTo:e.target.value})}/></label><label><span>Ship date</span><input type="date" value={draft.requestedShipDate || ''} onChange={e => setDraft({...draft,requestedShipDate:e.target.value})}/></label><label><span>Delivery date</span><input type="date" value={draft.requestedDeliveryDate || ''} onChange={e => setDraft({...draft,requestedDeliveryDate:e.target.value})}/></label><label><span>Ordered / expected weight</span><input inputMode="decimal" value={draft.orderedWeightLb ?? ''} onChange={e => setDraft({...draft,orderedWeightLb:e.target.value ? Number(e.target.value) : undefined})}/></label></div><h3 className="edit-subhead">Order lines</h3><div className="edit-lines">{draft.lines.map((line,idx) => <div className="edit-line" key={`${line.externalSku}-${idx}`}><input value={line.description} onChange={e => updateLine(idx,{description:e.target.value})}/><input value={line.internalItemId || ''} onChange={e => updateLine(idx,{internalItemId:e.target.value})} placeholder="Food Connex item"/><input inputMode="numeric" value={line.quantityCases} onChange={e => updateLine(idx,{quantityCases:Number(e.target.value)||0})}/><input inputMode="decimal" value={line.unitPrice ?? ''} onChange={e => updateLine(idx,{unitPrice:e.target.value ? Number(e.target.value) : undefined})}/><input value={line.uom} onChange={e => updateLine(idx,{uom:e.target.value})}/></div>)}</div><div className="edit-actions"><button className="secondary" onClick={() => {setDraft(order);setEditing(false)}}>Cancel</button><button className="primary" onClick={() => {onSave(draft);setEditing(false)}}>Save correction</button></div></section>;
  return <section className="surface detail-card order-detail-card">
    <div className="order-detail-top"><div><span className="kicker">Selected order</span><h2>PO {order.externalPo}</h2><p>{order.customer} · {order.shipTo}</p></div><span className={`status-chip ${issues.length ? 'needs' : 'ready'}`}>{issues.length ? 'Needs review' : 'Validated'}</span></div>
    <div className="detail-head-actions order-detail-actions">{canEdit && <button className="secondary" onClick={() => setEditing(true)}>Edit / correct</button>}<button className="secondary" onClick={onPrint}>Print / PDF</button><button className="secondary" onClick={onDownload}>Download report</button></div>
    <div className="detail-meta order-facts"><span><small>Ship date</small><strong>{order.requestedShipDate || '—'}</strong></span><span><small>Delivery</small><strong>{order.requestedDeliveryDate || '—'}</strong></span><span><small>Food Connex</small><strong>{order.foodConnexOrder || 'Preview only'}</strong></span><span><small>Total cases</small><strong>{totalCases(order)}</strong></span><span><small>SPS order weight</small><strong>{order.orderedWeightLb ? `${order.orderedWeightLb.toFixed(2)} lb` : '—'}</strong></span></div>
    <div className="line-table order-lines"><div className="line-table-head"><span>Item</span><span>Qty</span><span>SPS price</span><span>Food Connex</span></div>{order.lines.map(line => { const known = foodConnexMap[line.externalSku]; const mismatch = known && line.unitPrice != null && Math.abs(known.price-line.unitPrice) > .001; return <div className="line-table-row" key={`${order.id}-${line.externalSku}`}><span data-label="Item"><strong>{line.description}</strong><small>{line.externalSku} → {line.internalItemId || 'Unmapped'}</small></span><span data-label="Quantity">{line.quantityCases} {line.uom}</span><span data-label="SPS price">${(line.unitPrice || 0).toFixed(2)}</span><span data-label="Food Connex" className={mismatch ? 'price-mismatch' : ''}>{known ? `$${known.price.toFixed(2)}` : 'Needs mapping'}{mismatch && <small> Review</small>}</span></div>; })}</div>
    {issues.length > 0 && <div className="detail-footer"><span>Automation paused until {issues.length} exception{issues.length > 1 ? 's are' : ' is'} verified. A difference may be valid if Crystal has an updated physical pricing sheet or other approved reference.</span><button className="secondary" onClick={() => setSection('Exceptions')}>Open order review</button></div>}
  </section>;
}

function PalletCasesEditor({ pallet, order, canEdit, onUpdate, onDelete }: { pallet: Pallet; order?: UnifiedOrder; canEdit: boolean; onUpdate: (caseId:string, patch:any) => void; onDelete:(caseId:string)=>void }) {
  return <div className="case-editor"><div className="case-editor-head"><strong>Pallet Breakdown — cases</strong><span>{canEdit ? 'Each case can be corrected before shipment.' : 'View only'}</span></div>{(pallet.cases || []).map(c => <div className="case-edit-row" key={c.id}><input disabled={!canEdit} value={c.scannedCode} onChange={e => onUpdate(c.id,{scannedCode:e.target.value})}/><select disabled={!canEdit} value={c.itemId || ''} onChange={e => { const line=order?.lines.find(l=>l.internalItemId===e.target.value); onUpdate(c.id,{itemId:e.target.value,description:line?.description}) }}>{order?.lines.map(l => <option key={l.externalSku} value={l.internalItemId || ''}>{l.internalItemId || 'Unmapped'} · {l.description}</option>)}</select><input disabled={!canEdit} inputMode="decimal" value={c.weightLb} onChange={e => onUpdate(c.id,{weightLb:Number(e.target.value)||0})}/>{canEdit && <button className="text-button danger-link" onClick={() => onDelete(c.id)}>Remove</button>}</div>)}</div>;
}

function ReviewedDecisionRow({ order, decision, onSave, onReopen }: { order: UnifiedOrder; decision: ExceptionDecision; onSave:(d:ExceptionDecision)=>void; onReopen:()=>void }) {
  const [draft,setDraft]=useState(decision); const [editing,setEditing]=useState(false); useEffect(()=>setDraft(decision),[decision]);
  return <div className="reviewed-row"><div><strong>PO {order.externalPo}</strong><span>{decision.source} · {new Date(decision.reviewedAt).toLocaleString()}</span>{decision.notes && <small>{decision.notes}</small>}</div>{editing ? <div className="reviewed-edit"><select value={draft.source} onChange={e=>setDraft({...draft,source:e.target.value as ExceptionDecision['source']})}><option>Physical price sheet</option><option>Food Connex</option><option>SPS</option><option>Customer confirmation</option><option>Other</option></select><input inputMode="decimal" value={draft.approvedPrice ?? ''} onChange={e=>setDraft({...draft,approvedPrice:e.target.value?Number(e.target.value):undefined})} placeholder="Approved price"/><input inputMode="decimal" value={draft.referenceWeightLb ?? ''} onChange={e=>setDraft({...draft,referenceWeightLb:e.target.value?Number(e.target.value):undefined})} placeholder="Reference weight"/><input value={draft.notes || ''} onChange={e=>setDraft({...draft,notes:e.target.value})} placeholder="Notes"/><button className="primary" onClick={()=>{onSave({...draft,reviewedAt:new Date().toISOString()});setEditing(false)}}>Save</button><button className="secondary" onClick={()=>setEditing(false)}>Cancel</button></div> : <div className="reviewed-actions"><button className="secondary" onClick={()=>setEditing(true)}>Edit decision</button><button className="text-button" onClick={onReopen}>Reopen review</button></div>}</div>;
}


function ExceptionReviewCard({ order, issue, onView, onResolve, onPrint, onDownload }: { order: UnifiedOrder; issue: { type: string; message: string; severity: 'warning' | 'blocking' }; onView: () => void; onResolve: (decision: Omit<ExceptionDecision, 'reviewedAt'>) => void; onPrint: () => void; onDownload: () => void }) {
  const [source, setSource] = useState<ExceptionDecision['source']>(issue.type === 'Price review' ? 'Physical price sheet' : 'Other');
  const [approvedPrice, setApprovedPrice] = useState('');
  const [referenceWeight, setReferenceWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [open, setOpen] = useState(false);
  return <div className="surface exception-card exception-card-expanded">
    <div className="exception-main"><div className="work-icon warning">!</div><div><span className="row-label">PO {order.externalPo} · {issue.type}</span><h2>{issue.message}</h2><p>{issue.type === 'Price review' ? 'This is a review point, not automatically an error. Crystal may have an updated physical pricing sheet that is newer than one of the systems.' : 'No live system is changed while this difference is unresolved.'}</p></div></div>
    <div className="exception-actions"><button className="secondary" onClick={onPrint}>Print</button><button className="secondary" onClick={onDownload}>Download</button><button className="secondary" onClick={onView}>View order</button><button className="primary" onClick={() => setOpen(v => !v)}>{open ? 'Close review' : 'Verify'}</button></div>
    {open && <div className="review-panel">
      <div className="review-note"><strong>Use the approved real-world source.</strong><span>For pricing, this can be Crystal's physical updated price sheet. Weight can also be recorded here when the shipment paperwork provides the final reference.</span></div>
      <div className="review-grid">
        <label><span>Verified against</span><select value={source} onChange={e => setSource(e.target.value as ExceptionDecision['source'])}><option>Physical price sheet</option><option>Food Connex</option><option>SPS</option><option>Customer confirmation</option><option>Other</option></select></label>
        <label><span>Approved unit price (optional)</span><input inputMode="decimal" value={approvedPrice} onChange={e => setApprovedPrice(e.target.value)} placeholder="e.g. 11.29" /></label>
        <label><span>Reference / final weight lb (optional)</span><input inputMode="decimal" value={referenceWeight} onChange={e => setReferenceWeight(e.target.value)} placeholder="e.g. 1847.50" /></label>
        <label className="review-notes"><span>Review note</span><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Example: Verified against Crystal's updated physical price sheet dated 10/07." /></label>
      </div>
      <div className="review-footer"><span>This records the decision in Lucid Core only. Live system updates stay disabled in Safe Mode.</span><button className="primary" onClick={() => onResolve({ source, approvedPrice: approvedPrice ? Number(approvedPrice) : undefined, referenceWeightLb: referenceWeight ? Number(referenceWeight) : undefined, notes: notes || undefined })}>Save verification</button></div>
    </div>}
  </div>;
}


function EditableGrid({headers,rows,empty}:{headers:string[];rows:React.ReactNode[][];empty:string}){
  if(!rows.length) return <Empty title="Nothing here yet" text={empty}/>;
  return <div className="surface editable-table-wrap"><div className="editable-table" style={{'--cols':headers.length} as React.CSSProperties}><div className="editable-table-head">{headers.map((h,i)=><span key={`${h}-${i}`}>{h}</span>)}</div>{rows.map((row,i)=><div className="editable-table-row" key={i}>{row.map((cell,j)=><div key={j}>{cell}</div>)}</div>)}</div></div>;
}

function RoadmapPhase({phase,title,items,result}:{phase:string;title:string;items:string[];result:string}){
  return <section className="surface roadmap-phase"><span className="kicker">{phase}</span><h2>{title}</h2><div className="roadmap-items">{items.map(item=><div key={item}>{item}</div>)}</div><div className="roadmap-result"><strong>Result:</strong> {result}</div></section>;
}

function Empty({ title, text, action }: { title: string; text: string; action?: string }) {
  return <div className="surface empty-state"><div className="empty-icon">✓</div><h2>{title}</h2><p>{text}</p>{action && <span className="status-chip progress">{action}</span>}</div>;
}

// Browser-safe presentation and file-adapter helpers. No matching or import decisions live here.
import * as XLSX from 'xlsx';
import { z } from 'zod';
import type { CustomerImportPlan, CustomerPlanRow, FieldChange, ImportDecision } from './customer-import-planner';

export const decisionLabels: Record<ImportDecision, string> = { CREATE: 'New customers', UPDATE: 'Proposed changes', SKIP: 'Skipped', BLOCK: 'Needs review' };
export const decisionExplanations: Record<ImportDecision, string> = {
  CREATE: 'The planner found no matching customer. These values would create a new record in a future approved import.',
  UPDATE: 'The planner matched an existing customer. Only the field changes listed below are proposed.',
  SKIP: 'The planner proposes no change. Findings explain unchanged records, repeated rows and exclusions.',
  BLOCK: 'The planner found an issue that needs resolution before this record can be considered for import.',
};
const findingSchema = z.object({ severity: z.enum(['error','warning','info']), code: z.string(), field: z.string().optional(), message: z.string() });
const scalar = z.union([z.string(),z.number().finite(),z.boolean()]);
const planSchema = z.object({
  version:z.literal('customer-master-plan-v1'), entity:z.literal('customers'), mode:z.literal('current'), dry_run:z.literal(true), executable:z.literal(false),
  organization_id:z.string(), source_system:z.literal('food_connex'), source_reference:z.string(),
  input_hash:z.string().regex(/^[a-f0-9]{64}$/),snapshot_hash:z.string().regex(/^[a-f0-9]{64}$/),plan_id:z.string().regex(/^[a-f0-9]{64}$/),
  findings:z.array(findingSchema), rows:z.array(z.object({ row:z.number().int().positive(),source_record_id:z.string().nullable(),customer_code:z.string().nullable(),
    decision:z.enum(['CREATE','UPDATE','SKIP','BLOCK']),matched_id:z.string().nullable(),duplicate_of_row:z.number().int().positive().nullable(),findings:z.array(findingSchema),
    changes:z.array(z.object({field:z.string(),before:scalar.nullable(),after:scalar})),
  })).max(500), counts:z.object({total:z.number().int().nonnegative(),CREATE:z.number().int().nonnegative(),UPDATE:z.number().int().nonnegative(),SKIP:z.number().int().nonnegative(),BLOCK:z.number().int().nonnegative()}),
});
/** Validate response integrity, never recompute or change server decisions. */
export function readCustomerPlan(value: unknown): CustomerImportPlan {
  const plan=planSchema.parse(value);const ids=new Set<number>();
  if(plan.counts.total!==plan.rows.length)throw new Error('The server review is incomplete.');
  for(const decision of ['CREATE','UPDATE','SKIP','BLOCK'] as const)if(plan.counts[decision]!==plan.rows.filter(row=>row.decision===decision).length)throw new Error('The server review counts are inconsistent.');
  for(const row of plan.rows){if(ids.has(row.row))throw new Error('The server review repeats a row.');ids.add(row.row);}
  return plan;
}
export function filterCustomerPlan(rows: readonly CustomerPlanRow[], query: string, decision: string, issues: string) {
  const term=query.toLowerCase().trim();
  return rows.filter(row=>(decision==='ALL'||row.decision===decision) && (issues==='ALL'||row.findings.some(f=>f.severity===issues)) &&
    (!term||[row.customer_code,row.source_record_id,...row.findings.map(f=>f.code)].some(value=>value?.toLowerCase().includes(term))));
}
export function fieldLabel(field: string) { return ({general_email:'Email',po_required:'Purchase order required',order_guide_enabled:'Order guide enabled',source_record_id:'Food Connex record ID',is_historical:'Historical record',organization_id:'Organization',default_warehouse_id:'Warehouse reference'} as Record<string,string>)[field] || field.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase()); }
const protectedValue=/\bredacted\b|\*{2,}|•{2,}|^x{3,}[- .()/x\d]*$|^(blank in source|not captured|unverified)(:.*)?$/i;
export function reviewValue(field: string,value: FieldChange['before']|FieldChange['after'],reveal=false):string {
  if(value===null)return 'Not set';
  if(typeof value==='string'&&protectedValue.test(value.trim()))return 'Protected source value';
  const publicFields=new Set(['customer_code','source_record_id','source_system','status','is_historical','po_required','order_guide_enabled','order_guide_retention_days','customer_type','customer_group','default_warehouse_id']);
  if(!publicFields.has(field)&&!reveal)return 'Private value hidden';
  return typeof value==='boolean'?(value?'Yes':'No'):String(value);
}
export type CustomerFile = {headers:string[];rows:string[][];numericCells:Record<string,number>};
export function readCustomerFile(buffer: ArrayBuffer):CustomerFile {
  const book=XLSX.read(buffer,{type:'array',raw:true});const sheet=book.Sheets[book.SheetNames[0]];
  if(!sheet)throw new Error('The file has no readable worksheet.');
  const range=XLSX.utils.decode_range(sheet['!ref']||'A1');
  if(range.e.r>501||range.e.c>99)throw new Error('Use a file with at most 500 customer rows and 100 columns.');
  const grid=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:'',raw:false,blankrows:true});
  if(grid.length<2)throw new Error('Add a header row and at least one customer record.');
  const headers=grid[0].map(v=>String(v));
  if(headers.some(h=>!h.trim())||new Set(headers).size!==headers.length)throw new Error('Column headings must be present and unique.');
  const rows:string[][]=[];const numericCells:Record<string,number>={};
  grid.slice(1).forEach((row,i)=>{if(!row.some(v=>String(v).trim()))return;const next=rows.length;rows.push(headers.map((_,j)=>String(row[j]??'')));headers.forEach((_,j)=>{const c=sheet[XLSX.utils.encode_cell({r:i+1,c:j})];if(c?.t==='n')numericCells[`${next}:${j}`]=c.v as number;});});
  if(!rows.length||rows.length>500)throw new Error('Use between 1 and 500 customer records.');
  return {headers,rows,numericCells};
}
/** Explicit file representation adapter. Invalid strings remain invalid for the sole server planner. */
export function customerProposals(file:CustomerFile,mapping:Record<string,string>) {
  return file.rows.map((row,i)=>Object.fromEntries(Object.entries(mapping).filter(([,column])=>column&&file.headers.includes(column)).map(([field,column])=>{
    const j=file.headers.indexOf(column);let value:string|number|boolean=row[j]??'';
    if(['customer_code','source_record_id'].includes(field)&&Object.hasOwn(file.numericCells,`${i}:${j}`))value=file.numericCells[`${i}:${j}`];
    else if(['po_required','order_guide_enabled','is_historical'].includes(field)) {if(value.trim().toLowerCase()==='true')value=true;else if(value.trim().toLowerCase()==='false')value=false;}
    else if(field==='order_guide_retention_days'&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value)))value=Number(value);
    return [field,value];
  })));
}

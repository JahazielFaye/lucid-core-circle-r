import {planCustomerImport} from '../src/lib/integrations/customer-import-planner.ts';
import {proposed,customer,request,snapshot} from './customer-import-planner.fixtures.mjs';
export function manifestSource(){return [
 proposed({source_record_id:'0000001',customer_code:'0000001',name:'SYNTHETIC PRIVATE NAME'}),
 proposed({phone:'SYNTHETIC_PRIVATE_PHONE'}),
 proposed({source_record_id:'QA-NO-CHANGE',customer_code:'QA-NO-CHANGE'}),
 proposed({source_record_id:'QA-SKIP',customer_code:'QA-SKIP',status:'inactive'}),
 proposed({source_record_id:'QA-CONFLICT',customer_code:'QA-NATIVE'}),
];}
export function manifestExisting(){return [customer(),customer({id:'unchanged-id',source_record_id:'QA-NO-CHANGE',customer_code:'QA-NO-CHANGE'}),customer({id:'native-id',source_system:'lucid_core',source_record_id:null,customer_code:'QA-NATIVE'})];}
export const relatedEvidence=[
 {entity:'ship_tos',source_record_id:'QA-SHIP-01',parent_customer_source_record_id:'0000001',source_status:'active',proposed_record:{location_code:'QA-SHIP-01',name:'SYNTHETIC_PRIVATE_LOCATION',address_line_1:'SYNTHETIC_PRIVATE_ADDRESS'}},
 {entity:'contacts',source_record_id:'QA-CONTACT-01',parent_customer_source_record_id:'0000001',source_status:'active',proposed_record:{name:'SYNTHETIC_PRIVATE_PERSON',email:'<redacted>'}},
 {entity:'customer_identifiers',source_record_id:'QA-ID-01',parent_customer_source_record_id:'0000001',proposed_record:{identifier_type:'other',identifier_value:'0000999'}},
 {entity:'customer_items',source_record_id:'QA-SKU-01',parent_customer_source_record_id:'0000001',ship_to_source_record_id:'QA-SHIP-01',proposed_record:{customer_sku:'0000009',customer_uom:'CS'}},
];
export function manifestInput(overrides={}){const rows=manifestSource();return {plan:planCustomerImport(request(rows),snapshot(manifestExisting())),sourceRows:rows,relatedRecords:relatedEvidence,datasetVersion:'SYNTHETIC-v1',generatedAt:'2026-10-31T18:00:00.000Z',generatedBy:'synthetic-admin',environment:'test',...overrides};}
export function changedInput(rows,existing=manifestExisting(),extra={}){return manifestInput({sourceRows:rows,plan:planCustomerImport(request(rows),snapshot(existing)),...extra});}

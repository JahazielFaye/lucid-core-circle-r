// Synthetic, deterministic review artifacts only; never writes operational data.
import {writeFileSync,existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createCustomerManifest,customerManifestSummary} from '../src/lib/integrations/customer-review-manifest.ts';
import {reviewDraft} from '../src/lib/integrations/customer-review-manifest-contract.ts';
import {manifestInput,manifestSource,manifestExisting,changedInput} from './customer-review-manifest.fixtures.mjs';
const directory=process.argv[2];if(!directory)throw Error('Choose an output directory for synthetic artifacts.');
const first=createCustomerManifest(manifestInput());const rows=manifestSource();rows[0]={...rows[0],name:'SYNTHETIC_PRIVATE_CHANGED'};
const second=createCustomerManifest(changedInput(rows,manifestExisting(),{previousManifest:first,generatedAt:'2026-10-31T19:00:00.000Z'}));
function save(name,body){const path=resolve(directory,name);if(existsSync(path)){if(readFileSync(path,'utf8')!==body)throw Error('Refusing to overwrite a different artifact.');return;}writeFileSync(path,body,{flag:'wx'});}
for(const m of [first,second]){save(`customer-review-manifest-v${m.manifest_version}.json`,JSON.stringify(m,null,2)+'\n');save(`customer-review-manifest-v${m.manifest_version}-summary.txt`,customerManifestSummary(m)+'\n');}
save('customer-review-manifest-review-draft.json',JSON.stringify({manifest:first,review_draft:reviewDraft(first,{[first.customers[0].record_key]:'APPROVE',[first.customers[1].record_key]:'NEEDS_REVIEW'},'2026-10-31T19:00:00.000Z')},null,2)+'\n');
console.log('Synthetic manifest versions and unverified review draft exported; no operational writes.');

# API security matrix

Static review, 2026-11-03. `PASS` means the route delegates authentication, organization scoping, role enforcement, and audit behavior to the named server helper/RPC. It is not runtime RLS proof.

| Route | Method | Read/Mutation | Auth | Roles | Org validation | Runtime validation | Server-derived actor/org | Audit | External integration | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| `/api/customer-manifests/register` | POST | Mutation | required | admin | registry RPC | request + contract | yes | registry ledger | none | PASS |
| `/api/customer-manifests/[id]` | GET | Read | required | active profile | registry helper | id | yes | N/A | none | PASS |
| `/api/customer-manifests/[id]/decisions` | POST | Mutation | required | RPC enforced | registry RPC | identity/hash/decision | yes | ledger | none | PASS |
| `/api/customer-manifests/[id]/invalidate` | POST | Mutation | required | admin RPC | registry RPC | reason | yes | ledger | none | PASS |
| `/api/food-connex/customers` | GET | Read | required | active profile | profile org | query bounded by helper | yes | N/A | Food Connex read-only | PASS |
| `/api/food-connex/customers/[customerId]/ship-tos` | GET | Read | required | active profile | profile org | customer ID | yes | N/A | Food Connex read-only | PASS |
| `/api/food-connex/items` | GET | Read | required | active profile | profile org | query bounded by helper | yes | N/A | Food Connex read-only | PASS |
| `/api/food-connex/test-auth` | GET | Read | required | active profile | profile org | none | yes | N/A | Food Connex auth diagnostic | PASS |
| `/api/food-connex/test-auth-diagnostic` | GET | Read | required | active profile | profile org | none | yes | N/A | Food Connex auth diagnostic | PASS |
| `/api/operations/[action]` | POST | Mutation/read | required | dispatcher/RPC | RPC | action dispatcher | yes | workflow-specific | none | PARTIAL |
| `/api/production/cases/[id]/label-printed` | POST | Mutation | required | production helper/RPC | RPC | case ID | yes | print audit | none | PASS |
| `/api/production/cases/[id]/void` | POST | Mutation | required | production helper/RPC | RPC | case ID/reason | yes | audit | none | PASS |
| `/api/production/orders/[id]/cases` | POST | Mutation | required | production helper/RPC | RPC | line/lot/weight/key | yes | audit | none | PASS |
| `/api/production/orders/[id]/complete` | POST | Mutation | required | production helper/RPC | RPC | order ID | yes | audit | none | PASS |
| `/api/production/orders/[id]/pallets` | POST | Mutation | required | production helper/RPC | RPC | order ID | yes | audit | none | PASS |
| `/api/production/orders/[id]/start` | POST | Mutation | required | production helper/RPC | RPC | order ID | yes | audit | none | PASS |
| `/api/production/pallets/[id]/cases` | POST | Mutation | required | production helper/RPC | RPC | pallet/case ID | yes | audit | none | PASS |
| `/api/production/pallets/[id]/cases/[caseId]/remove` | POST | Mutation | required | production helper/RPC | RPC | pallet/case ID | yes | audit | none | PASS |
| `/api/production/pallets/[id]/complete` | POST | Mutation | required | production helper/RPC | RPC | pallet ID | yes | audit | none | PASS |
| `/api/production/pallets/[id]/reopen` | POST | Mutation | required | production helper/RPC | RPC | pallet/reason | yes | audit | none | PASS |
| `/api/qa/create-order` | POST | Mutation | required | lucid_admin | explicit fixture/org checks | QA prefix/quantity | yes | RPC audit | none | PASS |
| `/api/qa/prepare-test-data` | POST | Mutation | required | lucid_admin | seed RPC | none | yes | RPC audit | none | PASS |
| `/api/sps/exceptions/[id]/resolve` | POST | Mutation | required | resolution helper/RPC | RPC | action | yes | audit/RPC | SPS none | PASS |
| `/api/sps/exceptions/[id]/map-customer` | POST | Mutation | required | mapping helper/RPC | RPC | mapping body | yes | audit/RPC | SPS none | PASS |
| `/api/sps/exceptions/[id]/map-ship-to` | POST | Mutation | required | mapping helper/RPC | RPC | mapping body | yes | audit/RPC | SPS none | PASS |
| `/api/sps/exceptions/[id]/map-item` | POST | Mutation | required | mapping helper/RPC | RPC | mapping body | yes | audit/RPC | SPS none | PASS |
| `/api/sps/import-sandbox-po` | GET | Mutation | required | active profile | staging helper | fixed sandbox path | yes | staging audit | SPS GET only | PASS |
| `/api/sps/import-new-sandbox-pos` | GET | Mutation | required | active profile | staging helper | bounded discovery | yes | staging audit | SPS GET only | PASS |
| `/api/sps/reimport-canonical-sandbox-po` | GET | Mutation | required | active profile | staging helper | fixed canonical source | yes | staging audit | SPS GET only | PASS |
| `/api/sps/staged-orders/[id]/send-to-production` | POST | Mutation | required | promotion RPC | RPC | staged ID | yes | promotion audit | none | PASS |
| `/api/sps/test-auth` | GET | Read | required | lucid_admin | session profile | none | yes | N/A | SPS sandbox auth | PASS |
| `/api/sps/test-circle-r-mapping` | GET | Read | required | lucid_admin | session profile | none | yes | N/A | none | PASS |
| `/api/sps/test-discovered-po-identities` | GET | Read | required | lucid_admin | session profile | none | yes | N/A | SPS GET only | PASS |
| `/api/sps/test-po` | GET | Read | required | lucid_admin | session profile | none | yes | N/A | SPS GET only | PASS |
| `/api/sps/test-po-normalized` | GET | Read | required | lucid_admin | session profile | none | yes | N/A | SPS GET only | PASS |
| `/api/sps/test-stage-circle-r` | GET | Mutation | required | lucid_admin | session profile + staging helper | fixed fixture | yes | staging audit | none | PASS |
| `/api/sps/test-transactions` | GET | Read | required | lucid_admin | session profile | none | yes | N/A | SPS GET only | PASS |
| `/api/sps/test-transactions-in` | GET | Read | required | lucid_admin | session profile | none | yes | N/A | SPS GET only | PASS |
| `/api/sps/test-transactions-out` | GET | Read | required | lucid_admin | session profile | none | yes | N/A | SPS GET only | PASS |
| `/api/sps/test-transactions-po` | GET | Read | required | lucid_admin | session profile | none | yes | N/A | SPS GET only | PASS |

## Follow-up

`/api/operations/[action]` is intentionally marked **PARTIAL**: it centralizes authentication through its dispatcher, but its dynamic action selection needs a route-by-route runtime test matrix before it can be elevated to PASS. No route sets permissive CORS headers; private routes use same-origin browser requests. Server-to-server integrations are authenticated at their own upstream boundary and are not CORS consumers.

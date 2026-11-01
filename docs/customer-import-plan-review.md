# Customer Import Plan Review — local, read-only

The existing Imports navigation now mounts a Customer-only plan review. It reuses
Lucid's existing surface, header, form and responsive styles and the existing
Customer Master field configuration. The legacy import workspace is retained as
an unexported/unmounted function, preserving earlier drafts without exposing its
commit controls in this review. Other operational features are unchanged.

The interface calls only the existing `preview-historical-import` operation with
`entity=customers`, `mode=current` and the entered source reference. The server
planner remains the sole authority for CREATE, UPDATE, SKIP and BLOCK. Browser
helpers only adapt file representations, validate response integrity, filter and
format; they never match records, infer active status or decide imports.

## Features and bounds

- Real planner counts, plain-language decision explanations and row findings.
- Search by original code/source ID; decision/severity filters; 25-row pagination.
- Expandable current/proposed field comparisons with private values hidden until
  explicitly revealed. Source redaction placeholders stay protected even on reveal.
- Source reference, original IDs, matched destination IDs, plan version and hashes.
- File and response errors, initial/empty/no-results states, live loading notices.
- Native keyboard disclosures, labeled controls, focus indicators and accessible
  comparison table with a keyboard-focusable horizontal scrolling region on mobile.
- Changes to file, mapping or reference invalidate/abort prior requests; late replies
  cannot replace newer reviews. Upload races are also ignored.
- Up to 500 proposals, 100 columns, 5 MB. CSV is parsed as text; numeric XLSX identity
  cells are passed as numbers for the server to reject rather than guessing lost
  zeros. Only explicit true/false and nonnegative integer representations are typed.
- Only mapped columns are sent; nothing is imported. Record numbering refers to
  the ordered proposals, not physical file lines (blank file rows are omitted).

## Safety

The review has no import, save, edit or commit action and no commit request. The
existing Customer Master commit function rejects **every mode**, including historical
or omitted mode, before authentication/batch creation. Tests exercise the existing
workflow dispatcher to prevent bypass by changing mode. No write endpoint, database
migration, executor or approval ledger was introduced. Other entity APIs outside
Customer Master were not converted to read-only and are not certified by this work.

Only Lucid Admin can see upload/build controls; existing server authorization also
rejects Office, Production and Leadership preview requests. Production permissions
were not changed or tested. No Food Connex or production access is needed to run
this feature's synthetic validation.

## Tests and local visual preview

```sh
npm run test:import-review
node_modules/.bin/tsc --noEmit --incremental false
npm run preview:import-review
```

The preview binds only `127.0.0.1:4179`, loads the actual component and calls the
actual planner/preview integration with a synthetic authenticated read/write-spy
context. It does not start Next, load `.env`, connect to Supabase, or expose a commit
endpoint. The browser bundle contains only client components/presentation helpers;
server planner imports in the UI are type-only. Its fixture-loading/role-toggle
controls exist only in `tests/`, never in the application workspace.

The synthetic fixture produces 7 records: CREATE 1, UPDATE 1, SKIP 3, BLOCK 2.
Reference `SYNTHETIC-FAILURE` exercises failure feedback; `SYNTHETIC-SLOW` exercises
loading and cancellation. Stop the local harness after visual QA.

## Remaining limits / next step

No full screen-reader or formal WCAG audit has been performed. Desktop and 390px
mobile visual/keyboard checks and structural accessibility tests are covered.
Comparison tables scroll horizontally inside their labeled region on small screens;
there is no page-wide horizontal overflow. This is an isolated synthetic preview,
not a production deployment or full authenticated Next end-to-end test.

Next smallest step: add a versioned, privacy-aware review-manifest export for
source-owner decisions on a small Customer-only candidate set, with commits disabled. Immutable reviewed
plan storage, transactional revalidation, approved execution, before-image rollback,
and unresolved source/model holds remain separately gated. SPS, QuickBooks,
SharePoint and carrier ownership boundaries are unchanged.

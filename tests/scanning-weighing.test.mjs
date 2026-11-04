import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGs1, isValidGtin } from '../src/lib/scanning/gs1.ts';
import { resolveIdentifier } from '../src/lib/scanning/resolver.ts';
import { resolveProductionOrderLine } from '../src/lib/scanning/production-order.ts';
import { manualWeightReading, validateWeight, validateWeightBand, ZM303_STATION } from '../src/lib/scanning/weight.ts';
import { prepareCasePrintRequest } from '../src/lib/scanning/print-request.ts';
import { renderBrowserCaseLabel } from '../src/lib/production/case-label.ts';
import { isDuplicateScan, shouldQueueNoSuffixScan } from '../src/lib/scanning/capture-guard.ts';
import { readFileSync } from 'node:fs';

const productionWorkspace = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');

const aliases = [
  { item_id: 'pork', identifier_type: 'gtin', identifier_value: '000000000010174082', uom: 'CS', verified: false, status: 'active', item: { item_code: '10174082', description: 'Pork Belly', status: 'active' } },
  { item_id: 'pork', identifier_type: 'other', identifier_value: '000000000010174082-EA', uom: 'EA', verified: false, status: 'active', item: { item_code: '10174082', description: 'Pork Belly', status: 'active' } },
  { item_id: 'beef', identifier_type: 'gtin', identifier_value: '4006381333931', uom: 'CS', verified: true, status: 'active', item: { item_code: '10133913', description: 'Beef Brisket', status: 'active' } },
];

test('leading-zero CS and distinct EA source aliases resolve without rewriting values', () => {
  const cs = resolveIdentifier('000000000010174082', 'physical_scanner', aliases);
  const ea = resolveIdentifier('000000000010174082-EA', 'manual', aliases);
  assert.equal(cs.itemCode, '10174082'); assert.equal(cs.uom, 'CS'); assert.equal(cs.matchedIdentifier, '000000000010174082');
  assert.equal(ea.uom, 'EA'); assert.equal(ea.identifierProvenance, 'native');
});
test('an operational source alias that fails GTIN validation warns rather than blocks', () => {
  const result = resolveIdentifier('000000000010174082', 'physical_scanner', aliases);
  assert.equal(result.validationStatus, 'warning'); assert.match(result.warnings[0], /not standards-validated GTIN/);
  assert.equal(isValidGtin('4006381333931'), true);
});
test('unknown, inactive, and ambiguous identifiers are blocked', () => {
  assert.equal(resolveIdentifier('missing', 'manual', aliases).validationStatus, 'blocked');
  assert.equal(resolveIdentifier('inactive', 'manual', [...aliases, {...aliases[0], identifier_value:'inactive', status:'inactive'}]).validationStatus, 'blocked');
  const ambiguous = resolveIdentifier('same', 'manual', [...aliases, {...aliases[0], item_id:'other', identifier_value:'same'}, {...aliases[1], item_id:'else', identifier_value:'same'}]);
  assert.equal(ambiguous.validationStatus, 'blocked');
});
test('an exact active native item code resolves only after configured aliases', () => {
  const nativeCode = { item_id: 'qa-item', identifier_type: 'internal_item_code', identifier_value: 'QA-ITEM-WORK-001', uom: null, verified: true, status: 'active', item: { item_code: 'QA-ITEM-WORK-001', description: 'QA Validation Item', status: 'active' } };
  const result = resolveIdentifier('QA-ITEM-WORK-001', 'manual', [...aliases, nativeCode]);
  assert.equal(result.validationStatus, 'accepted');
  assert.equal(result.itemId, 'qa-item');
  assert.equal(result.itemCode, 'QA-ITEM-WORK-001');
  assert.equal(result.uom, undefined);
  assert.equal(result.identifierType, 'internal_item_code');
  const configuredWins = resolveIdentifier('QA-ITEM-WORK-001', 'manual', [...aliases, nativeCode, { ...aliases[0], item_id: 'configured-item', identifier_value: 'QA-ITEM-WORK-001', uom: 'CS' }]);
  assert.equal(configuredWins.itemId, 'configured-item');
  assert.equal(configuredWins.uom, 'CS');
});
test('production scan selection is exact, order-scoped, and UOM-safe before Weigh Mode', () => {
  const qaScan = resolveIdentifier('QA-ITEM-WORK-001', 'manual', [{ item_id: 'qa-item', identifier_type: 'internal_item_code', identifier_value: 'QA-ITEM-WORK-001', uom: null, verified: true, status: 'active', item: { item_code: 'QA-ITEM-WORK-001', description: 'QA Validation Item', status: 'active' } }]);
  const currentOrder = [{ id: 'qa-line', nativeItemId: 'qa-item', itemCode: 'QA-ITEM-WORK-001', externalSku: 'QA-SKU-WORK-001', uom: 'CS' }];
  assert.equal(resolveProductionOrderLine(qaScan, currentOrder).line?.id, 'qa-line');
  assert.match(resolveProductionOrderLine(qaScan, [{ id: 'foreign-line', nativeItemId: 'other-item', itemCode: 'OTHER', uom: 'CS' }]).error, /not on this production order/);
  const uomAlias = { ...qaScan, uom: 'EA', identifierType: 'other' };
  assert.match(resolveProductionOrderLine(uomAlias, currentOrder).error, /not on this production order/);
  assert.match(resolveProductionOrderLine(qaScan, [...currentOrder, { ...currentOrder[0], id: 'qa-line-ea', uom: 'EA' }]).error, /more than one order line/);
});
test('a failed production item resolution stops before Weigh Mode or any mutation path', () => {
  const unknown = resolveIdentifier('NOT-ON-ORDER', 'manual', aliases);
  assert.match(resolveProductionOrderLine(unknown, [{ id: 'qa-line', nativeItemId: 'qa-item', itemCode: 'QA-ITEM-WORK-001', uom: 'CS' }]).error, /Barcode not recognized/);
  assert.match(productionWorkspace, /if \(!resolution\.line\) \{ setScanStatus\(scan\); setError\(resolution\.error\); return; \}/);
  assert.match(productionWorkspace, /setScanStatus\(scan\); setError\(null\); startWeighMode\(line\);/);
});
test('GS1 only parses explicit AI streams, including FNC1 separated variable fields', () => {
  const gs = parseGs1(`010123456789012313261001320200176821SERIAL${String.fromCharCode(29)}10LOT-1`);
  assert.equal(gs?.itemIdentifier, '01234567890123'); assert.equal(gs?.netWeight, 17.68); assert.equal(gs?.weightUom, 'LB'); assert.equal(gs?.serial, 'SERIAL'); assert.equal(gs?.lot, 'LOT-1');
  assert.equal(parseGs1('01234567890123'), null);
  assert.equal(parseGs1('(01)01234567890123(13)261001'), null);
  assert.equal(parseGs1('010123456789012313261332'), null);
});
test('manual and station-compatible weight rules block zero, negative, stale, and consumed readings', () => {
  assert.equal(validateWeight(manualWeightReading(17.68)).valid, true);
  assert.match(validateWeight(manualWeightReading(0)).errors[0], /positive/);
  assert.match(validateWeight(manualWeightReading(-1)).errors[0], /positive/);
  const stale = {...manualWeightReading(17.68), capturedAt: new Date(Date.now() - 360000).toISOString()}; assert.match(validateWeight(stale).errors.join(' '), /stale/);
  const consumed = {...manualWeightReading(17.68), freshness:'consumed'}; assert.match(validateWeight(consumed).errors.join(' '), /fresh/);
  assert.equal(ZM303_STATION.intervalLb, .02);
  const manual = manualWeightReading(17.68);
  assert.equal(manual.source, 'manual'); assert.equal(manual.zeroState, 'unknown'); assert.equal(manual.tareState, 'unknown');
});
test('weight reading does not double-tare when physical zero state is known', () => {
  const physicalZero = {...manualWeightReading(17.68), source:'station', zeroState:'physical_zero_confirmed', tareState:'packaging_adjusted'};
  assert.equal(validateWeight(physicalZero).valid, true);
  assert.equal(physicalZero.netWeight, 17.68);
});
test('identifier class metadata remains conservative for source aliases', () => {
  const alias = resolveIdentifier('000000000010174082', 'manual', [{...aliases[0], identifier_class:'source_alias', standards_validated:false}]);
  assert.equal(alias.identifierProvenance, 'legacy_source_alias');
  const standard = resolveIdentifier('4006381333931', 'manual', [{...aliases[2], identifier_class:'standards_validated', standards_validated:true}]);
  assert.equal(standard.validationStatus, 'accepted');
});
test('keyboard-wedge no-suffix handling ignores normal typing and accepts rapid scanner input', () => {
  assert.equal(shouldQueueNoSuffixScan(3), false);
  assert.equal(shouldQueueNoSuffixScan(4), true);
  assert.equal(shouldQueueNoSuffixScan(12), true);
});
test('scanner duplicate cooldown suppresses repeated physical and camera values without blocking a later scan', () => {
  const prior = { value:'000000000010174082', at:1000 };
  assert.equal(isDuplicateScan(prior, prior.value, 1500), true);
  assert.equal(isDuplicateScan(prior, prior.value, 1901), false);
  assert.equal(isDuplicateScan(prior, 'other', 1200), false);
});
test('print preparation stays preview-only and never fabricates missing GS1 data', () => {
  const request = prepareCasePrintRequest({ itemDescription:'QA Validation Item', itemId:'QA-ITEM', caseIdentifier:'QA-CASE', packDate:'11/02/2026', productionCode:'QA-PROD', netWeight:17.68, netWeightUom:'LB', gtin:null, gs1BarcodeValue:null, gs1HumanReadable:null });
  assert.equal(request.adapterStatus, 'preview_only'); assert.equal(request.barcodePayload, undefined); assert.equal(request.humanReadableAi, undefined);
});
test('case label preview renders without a printer adapter and never initiates browser printing', () => {
  const label = { itemDescription:'QA Validation Item', itemId:'QA-ITEM-WORK-001', caseIdentifier:'QA-CASE-001', packDate:'11/04/2026', productionCode:'QA-PROD-001', netWeight:20, netWeightUom:'LB', gtin:null, gs1BarcodeValue:null, gs1HumanReadable:null };
  const request = prepareCasePrintRequest(label);
  const preview = renderBrowserCaseLabel(label);
  assert.equal(request.adapterStatus, 'preview_only');
  assert.match(preview, /QA-ITEM-WORK-001/);
  assert.match(preview, /QA Validation Item/);
  assert.match(preview, /QA-CASE-001/);
  assert.match(preview, /GS1 barcode data unavailable/);
  assert.doesNotMatch(preview, /window\.print|<script/i);
});
test('weight bands do not leak between items and may warn or block only when configured', () => {
  assert.deepEqual(validateWeightBand(3, null), { errors: [], warnings: [] });
  assert.deepEqual(validateWeightBand(3, { minimumWeight: 5, policyMode: 'warning' }), { errors: [], warnings: ['Weight outside allowed range.'] });
  assert.deepEqual(validateWeightBand(3, { minimumWeight: 5, policyMode: 'block' }), { errors: ['Weight outside allowed range.'], warnings: [] });
});

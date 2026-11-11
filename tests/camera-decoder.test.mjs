import {test} from 'node:test';
import assert from 'node:assert/strict';
import { Code128Reader, MultiFormatReader, RGBLuminanceSource, HybridBinarizer, BinaryBitmap } from '@zxing/library';
import { cameraDecodeHints, selectCode128Detector } from '../src/lib/scanning/camera-decoder.ts';
import {parseGs1} from '../src/lib/scanning/gs1.ts';
import {resolveIdentifier} from '../src/lib/scanning/resolver.ts';
// Generated test-only Code 128 symbols; no real customer, case, or GTIN.
export const gs1Fixture='0114000000000006132610013202001768219000000001';
export function barcodePixels(text, gs1=false) {
 const codes=gs1 ? [105,102,...text.split('\x1d').flatMap((part,index)=>[...(index ? [102] : []),...part.match(/../g).map(Number)])] : [104,...[...text].map(c=>c.charCodeAt(0)-32)];
 let checksum=codes[0];for(let i=1;i<codes.length;i++)checksum+=codes[i]*i;codes.push(checksum%103,106);
 const bars=[];for(const code of codes){let black=true;for(const w of Code128Reader.CODE_PATTERNS[code]){for(let x=0;x<w*3;x++)bars.push(black);black=!black;}}
 const width=bars.length+60,height=180,pixels=new Uint8ClampedArray(width*height);pixels.fill(255);
 for(let y=20;y<160;y++)for(let x=0;x<bars.length;x++)if(bars[x])pixels[y*width+x+30]=0;
 return {pixels,width,height};
}
function decode(text,gs1){const {pixels,width,height}=barcodePixels(text,gs1);const reader=new MultiFormatReader();reader.setHints(cameraDecodeHints());return reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels,width,height)))).getText();}
test('absent, QR-only, failing, or unknown native support selects fallback',async()=>{
 assert.equal(await selectCode128Detector(),null);
 for(const formats of [[],['qr_code']]){class Native{static async getSupportedFormats(){return formats;}}assert.equal(await selectCode128Detector(Native),null);}
 class Bad{static async getSupportedFormats(){throw Error('unsupported');}}assert.equal(await selectCode128Detector(Bad),null);
});
test('native requires explicit Code 128 capability',async()=>{class Native{static async getSupportedFormats(){return ['code_128','unknown'];}constructor(options){this.options=options;}}assert.deepEqual((await selectCode128Detector(Native)).options,{formats:['code_128']});});
test('compatible decoder reads plain Code 128',()=>assert.equal(decode('QA-CASE-ONLY-001',false),'QA-CASE-ONLY-001'));
test('compatible decoder preserves GS1 prefix, date, net weight, serial',()=>{const raw=decode(gs1Fixture,true);assert.equal(raw,']C1'+gs1Fixture);assert.deepEqual(parseGs1(raw),{warnings:[],itemIdentifier:'14000000000006',packDate:'2026-10-01',netWeight:17.68,weightUom:'LB',serial:'9000000001'});});
test('decoded GS1 can resolve only an exact configured item; missing mapping is rejected',()=>{const raw=decode(gs1Fixture,true);assert.equal(resolveIdentifier(raw,'phone_camera',[]).validationStatus,'blocked');const result=resolveIdentifier(raw,'phone_camera',[{item_id:'qa-item',identifier_type:'gtin',identifier_value:'14000000000006',uom:'CS',verified:true,status:'active',item:{item_code:'QA-ITEM',description:'Synthetic item',status:'active'}}]);assert.notEqual(result.validationStatus,'blocked');assert.equal(result.serial,'9000000001');assert.equal(result.uom,'CS');});
test('decoder diagnostics distinguish attempts/errors and case mapping without logging payloads',async()=>{const{readFile}=await import('node:fs/promises');const source=await readFile(new URL('../src/components/scan-capture.tsx',import.meta.url),'utf8');assert.match(source,/frames checked · no barcode detected/);assert.match(source,/Decoder inactive/);assert.match(source,/Barcode decoded but rejected/);assert.match(source,/configured case-ID mapping/);assert.doesNotMatch(source,/console\.(log|error|warn)/);});

test('GS1 fallback retains embedded FNC1 between variable-length fields',()=>{const value='0114000000000006108800\x1d219001';const raw=decode(value,true);assert.equal(raw,']C1'+value);assert.equal(parseGs1(raw).lot,'8800');assert.equal(parseGs1(raw).serial,'9001');});
test('GS1 case rejection precedes duplicate cooldown and mutation callback',async()=>{const{readFile}=await import('node:fs/promises');const source=await readFile(new URL('../src/components/scan-capture.tsx',import.meta.url),'utf8');const start=source.indexOf('const complete =');const block=source.indexOf('if (onRawCapture && parseGs1',start);assert.ok(block>start);assert.ok(block<source.indexOf('if (isDuplicateScan',start));assert.ok(block<source.indexOf('if (onRawCapture?.',start));});

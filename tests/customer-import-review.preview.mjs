// Isolated localhost-only visual test harness; never starts Next or loads .env/production clients.
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {previewHistoricalImport} from '../src/lib/integrations/historical-import.ts';
import {resetContext,stats} from './customer-import-context.stub.mjs';
import {customer} from './customer-import-planner.fixtures.mjs';
const require=createRequire(import.meta.url);const webpack=require('next/dist/compiled/webpack/webpack').webpack;
const output=resolve(process.env.REVIEW_PREVIEW_OUTPUT||'/private/tmp/lucid-customer-review');mkdirSync(output,{recursive:true});
await new Promise((done,reject)=>webpack({mode:'development',devtool:false,entry:resolve('tests/customer-import-review.browser.tsx'),output:{path:output,filename:'review.js'},resolve:{extensions:['.tsx','.ts','.mjs','.js','.json']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:resolve('tests/customer-import-review.loader.cjs')}]},optimization:{minimize:false}},(err,result)=>err||result.hasErrors()?reject(err||new Error(result.toString({all:false,errors:true}))):done()));
const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lucid Customer Review · Synthetic Local QA</title><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/review.js"></script></body></html>';
const server=createServer(async(req,res)=>{try{
 if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html');return res.end(html);}
 if(req.method==='GET'&&req.url==='/styles.css'){res.setHeader('Content-Type','text/css');return res.end(readFileSync('src/app/globals.css'));}
 if(req.method==='GET'&&req.url==='/review.js'){res.setHeader('Content-Type','application/javascript');return res.end(readFileSync(output+'/review.js'));}
 if(req.method==='GET'&&req.url==='/qa-stats'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(stats));}
 if(req.method==='POST'&&req.url==='/api/operations/preview-historical-import'){let content='';for await(const chunk of req){content+=chunk;if(content.length>1000000)throw Error('Too large');}const body=JSON.parse(content);if(body.sourceReference==='SYNTHETIC-FAILURE')throw Error('Synthetic failure');if(body.sourceReference==='SYNTHETIC-SLOW')await new Promise(done=>setTimeout(done,15000));resetContext([customer(),customer({id:'native-id',source_record_id:null,source_system:'lucid_core',customer_code:'QA-NATIVE'}),customer({id:'protected-id',source_record_id:'QA-PROTECTED',customer_code:'QA-PROTECTED',name:'Synthetic Protected',phone:'555-0199'})]);const data=await previewHistoricalImport(body);res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({success:true,data}));}
 res.statusCode=405;res.end('No write or other endpoint exists in this synthetic harness.');
 }catch{res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:false,error:'Synthetic preview failure'}));}});
server.listen(4179,'127.0.0.1',()=>console.log('Synthetic review ready: http://127.0.0.1:4179 (all production clients replaced; no writes)'));

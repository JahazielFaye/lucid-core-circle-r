// Node tests execute in a server context. Resolve Next's marker to its bundled server entry.
// The application keeps the real server-only import and Next's client-boundary protection.
import { registerHooks, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const serverEntry = pathToFileURL(require.resolve('next/dist/compiled/server-only/empty.js')).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/utils/supabase/server') return { url: new URL('./customer-import-context.stub.mjs', import.meta.url).href, shortCircuit: true };
  if (specifier === '@/lib/integrations/historical-import') return {url:new URL('../src/lib/integrations/historical-import.ts',import.meta.url).href,shortCircuit:true};
  if (specifier === '@/lib/security/route-auth') return {url:new URL('../src/lib/security/route-auth.ts',import.meta.url).href,shortCircuit:true};
  if (specifier === '@/lib/integrations/customer-import-planner') return { url: new URL('../src/lib/integrations/customer-import-planner.ts', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('.') && context.parentURL && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    for (const ext of ['.ts','.tsx']) { const url=new URL(specifier+ext,context.parentURL); if(existsSync(url)) return {url:url.href,shortCircuit:true}; }
  }
  return specifier === 'server-only' ? { url: serverEntry, shortCircuit: true } : nextResolve(specifier, context);
}, load(url,context,nextLoad) {
  if(url.endsWith('.tsx')) return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText};
  return nextLoad(url,context);
} });

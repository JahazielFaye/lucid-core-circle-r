import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {restoreWorkspaceSession,resolveWorkspaceProfile,withAuthTimeout} from '../src/lib/auth/bootstrap.ts';
const profile={id:'qa-user',organization_id:'qa-org',display_name:'QA Test',role:'office',active:true};
function client({session={user:{id:'qa-user'}},sessionError=null,user={id:'qa-user'},userError=null,data=profile,profileError=null,sessionCall,userCall,profileCall}={}){
 const calls={session:0,user:0,profile:0};
 return {calls,auth:{getSession(){calls.session++;return sessionCall?sessionCall():Promise.resolve({data:{session},error:sessionError});},getUser(){calls.user++;return userCall?userCall():Promise.resolve({data:{user},error:userError});}},from(table){assert.equal(table,'profiles');return{select(fields){assert.equal(fields,'id, organization_id, display_name, role, active');return{eq(key,id){assert.equal(key,'id');assert.equal(id,'qa-user');return{maybeSingle(){calls.profile++;return profileCall?profileCall():Promise.resolve({data,error:profileError});}};}};}};}};
}

test('unauthenticated session immediately resolves to login without user/profile requests',async()=>{
 const c=client({session:null});assert.deepEqual(await restoreWorkspaceSession(c),{profile:null,error:''});assert.deepEqual(c.calls,{session:1,user:0,profile:0});
});
for(const role of ['lucid_admin','office','leadership','production'])test(`verified active ${role} resolves workspace`,async()=>{
 const p={...profile,role};const c=client({data:p});assert.deepEqual(await restoreWorkspaceSession(c),{profile:p,error:''});assert.equal(c.calls.user,1);
});
test('invalid or expired cached session resolves login',async()=>{
 for(const options of [{sessionError:new Error('expired')},{user:null,userError:new Error('invalid JWT')},{user:{id:'different-user'}}]){
  const c=client(options);const result=await restoreWorkspaceSession(c);assert.equal(result.profile,null);assert.ok(result.error);assert.equal(c.calls.profile,0);
 }
});
test('missing/inactive/unsupported profile or missing organization never opens workspace',async()=>{
 for(const data of [null,{...profile,active:false},{...profile,role:'unknown'},{...profile,organization_id:''}]){
  const result=await restoreWorkspaceSession(client({data}));assert.equal(result.profile,null);assert.match(result.error,/not active/);
 }
});
test('profile authorization/network errors provide a recoverable login state',async()=>{
 const result=await restoreWorkspaceSession(client({profileError:new Error('permission denied')}));assert.equal(result.profile,null);assert.match(result.error,/try signing in again/);
});
test('rejected SDK promises are caught at session, verification and profile stages',async()=>{
 for(const name of ['sessionCall','userCall','profileCall']){
  const result=await restoreWorkspaceSession(client({[name]:()=>Promise.reject(new Error('sensitive internal error'))}));assert.equal(result.profile,null);assert.ok(result.error);assert.ok(!result.error.includes('sensitive'));
 }
});
test('unresolved session, user and profile promises have a bounded login/error outcome',async()=>{
 for(const name of ['sessionCall','userCall','profileCall']){
  const result=await restoreWorkspaceSession(client({[name]:()=>new Promise(()=>{})}),5);assert.equal(result.profile,null);assert.ok(result.error);
 }
});
test('late completion cannot replace a timed-out result',async()=>{
 let complete;const c=client({profileCall:()=>new Promise(resolve=>{complete=resolve;})});const pending=restoreWorkspaceSession(c,5);const result=await pending;
 complete({data:profile,error:null});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(result.profile,null);assert.ok(result.error);
});
test('profile refresh verifies identity without redundantly reading stored session',async()=>{
 const c=client();assert.deepEqual(await resolveWorkspaceProfile(c,'qa-user'),{profile,error:''});assert.equal(c.calls.session,0);
});
test('sign-in deadline rejects and completes rather than leaving pending forever',async()=>{
 await assert.rejects(withAuthTimeout(()=>new Promise(()=>{}),5),/took too long/);
});
test('auth-event requests are deferred; stale/unmounted results cannot commit',()=>{
 const page=readFileSync(new URL('../src/app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/scheduled = setTimeout\(\(\) => \{[\s\S]*?resolveWorkspaceProfile/);
 assert.match(page,/!active \|\| version !== authRequestVersion.current/);assert.match(page,/subscription.unsubscribe\(\)/);
 assert.match(page,/finally \{\s+setAuthPending\(false\)/);
 assert.doesNotMatch(page,/await supabase.auth.signOut\(\);\s+setProfile\(null\)/);
});
test('Webpack eval is permitted in development only; production CSP stays strict',async()=>{
 const originalMode=process.env.NODE_ENV;const originalURL=process.env.NEXT_PUBLIC_SUPABASE_URL;
 try{
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://auth-test.invalid';
  for(const mode of ['development','production']){
   process.env.NODE_ENV=mode;const {default:config}=await import(`../next.config.ts?auth-csp=${mode}`);
   const headers=await config.headers();const csp=headers[0].headers.find(x=>x.key==='Content-Security-Policy').value;
   assert.equal(csp.includes("'unsafe-eval'"),mode==='development');assert.ok(csp.includes('https://auth-test.invalid'));
  }
 }finally{
  if(originalMode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=originalMode;
  if(originalURL===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=originalURL;
 }
});

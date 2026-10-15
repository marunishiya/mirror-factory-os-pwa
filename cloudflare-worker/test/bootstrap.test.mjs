import bootstrap from '../src/bootstrap.js';
import assert from 'node:assert/strict';
let pass=0;
async function test(name,fn){await fn(); console.log('PASS bootstrap '+name);pass++}
const url='https://mirror-social-scheduler.projectmirror-ai.workers.dev/health';
const make=(method,path='/health')=>new Request('https://example.workers.dev'+path,{method});
const ready={DB:{prepare:()=>({first:async()=>({n:2})})}};
await test('health ready with two tables',async()=>{const r=await bootstrap.fetch(make('GET'),ready);const x=await r.json();assert.equal(r.status,200);assert.equal(x.databaseReady,true);assert.equal(x.publishingEnabled,false);assert.equal(x.jobSubmissionEnabled,false)});
await test('health rejects missing binding',async()=>{assert.equal((await bootstrap.fetch(make('GET'),{})).status,503)});
await test('health rejects missing tables',async()=>{assert.equal((await bootstrap.fetch(make('GET'),{DB:{prepare:()=>({first:async()=>({n:0})})}})).status,503)});
await test('POST always rejects',async()=>{assert.equal((await bootstrap.fetch(make('POST','/jobs'),ready)).status,405)});
await test('unknown route rejected',async()=>{assert.equal((await bootstrap.fetch(make('GET','/jobs'),ready)).status,404)});
await test('scheduled is a noop',async()=>{await bootstrap.scheduled();});
console.log('RESULT bootstrap '+pass+'/6 PASS');
if(pass!==6)process.exitCode=1;

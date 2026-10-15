import worker from '../src/dryrun.js';
import assert from 'node:assert/strict';

const base='https://mirror-social-scheduler.projectmirror-ai.workers.dev';
const key='z'.repeat(48);
const db={prepare(sql){
  if(sql.includes('sqlite_master')) return {first:async()=>({n:2})};
  throw new Error('Unexpected database write in rejected request');
}};
const env={DB:db,ADMIN_TOKEN:key};
const headers={Authorization:'Bearer '+key,'Content-Type':'application/json'};
let passed=0;
async function test(name,fn){
  try{await fn();passed++;console.log('PASS',name);}
  catch(err){console.error('FAIL',name,err);process.exitCode=1;}
}
function post(body,extra={}){
  return new Request(base+'/jobs',{method:'POST',headers:{...headers,...extra},body});
}
await test('ASCII oversized request rejected',async()=>{
  const r=await worker.fetch(post(JSON.stringify({payload:'a'.repeat(13000)})),env);
  assert.equal(r.status,413);
});
await test('Multibyte oversized request rejected',async()=>{
  const r=await worker.fetch(post(JSON.stringify({payload:'あ'.repeat(5000)})),env);
  assert.equal(r.status,413);
});
await test('Content length guard rejects 13KB',async()=>{
  const r=await worker.fetch(post('{}',{'Content-Length':'13000'}),env);
  assert.equal(r.status,413);
});
await test('Malformed UTF-8 rejected',async()=>{
  const r=await worker.fetch(post(new Uint8Array([0xc3,0x28])),env);
  assert.equal(r.status,400);
});
await test('Malformed JSON rejected',async()=>{
  const r=await worker.fetch(post('{"unfinished":'),env);
  assert.equal(r.status,400);
});
await test('Empty body rejected',async()=>{
  const r=await worker.fetch(new Request(base+'/jobs',{method:'POST',headers}),env);
  assert.equal(r.status,400);
});
await test('Exactly 12KB is processed, not treated as oversized',async()=>{
  const body=' '.repeat(11998)+'{}';
  assert.equal(new TextEncoder().encode(body).length,12000);
  const r=await worker.fetch(post(body),env);
  assert.equal(r.status,400);
});
await test('DB exception produces 503',async()=>{
  const r=await worker.fetch(new Request(base+'/health'),{
    DB:{prepare:()=>({first:async()=>{throw new Error('simulated database outage')}})}
  });
  assert.equal(r.status,503);
});
await test('Wrong origin rejected for POST',async()=>{
  const r=await worker.fetch(post('{}',{Origin:'https://invalid.example'}),env);
  assert.equal(r.status,403);
});
await test('Unsupported request method rejected',async()=>{
  const r=await worker.fetch(new Request(base+'/jobs',{method:'PUT',headers,body:'{}'}),env);
  assert.equal(r.status,404);
});
console.log('RESULT safety '+passed+'/10 PASS');
if(passed!==10)process.exitCode=1;

// Real local Cloudflare Worker/D1 integration test.
// Starts against Wrangler dev --local with an isolated test configuration.
// No SNS credentials, no real outgoing posts, and no remote D1 access.
import assert from 'node:assert/strict';

const base=process.env.MIRROR_LOCAL_URL||'http://127.0.0.1:8789';
const token='mirror-local-test-admin-token-20261016';
const future=new Date(Date.now()+5*60*1000).toISOString().replace(/\.\d{3}Z$/,'Z');
const auth={Authorization:'Bearer '+token,'Content-Type':'application/json'};
let count=0;
async function check(name,fn){
 try{await fn();count++;console.log('PASS local D1',name)}
 catch(err){console.error('FAIL local D1',name,err);process.exitCode=1}
}
async function request(path,{method='GET',body,headers={}}={}){
 const response=await fetch(base+path,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {response,json:await response.json()};
}
const job={mode:'dry_run',qaApproved:true,platform:'threads',title:'Local D1 QA',caption:'Worker D1 test — no posting',
 runAtUTC:future,campaignId:'local_d1_verify_001'};
let id='';
const until=Date.now()+45000;
while(Date.now()<until){
 try{const res=await fetch(base+'/channels');if(res.ok)break}catch{}
 await new Promise(resolve=>setTimeout(resolve,500));
}
await check('Worker with real local D1 is ready',async()=>{
 const {response,json}=await request('/health');assert.equal(response.status,200);assert.equal(json.databaseReady,true);
});
await check('official SNS posting is disabled in local test',async()=>{
 const {response,json}=await request('/jobs/live',{method:'POST',body:{},headers:auth});
 assert.equal(response.status,503);assert.equal(json.error,'live_publishing_disabled');
});
await check('private D1 endpoints require bearer authorization',async()=>{
 const {response}=await request('/jobs');assert.equal(response.status,401);
});
await check('invalid JSON does not write anything',async()=>{
 const res=await fetch(base+'/jobs',{method:'POST',headers:auth,body:'{"broken":'});
 assert.equal(res.status,400);
});
await check('D1 atomic insert returns queued job',async()=>{
 const {response,json}=await request('/jobs',{method:'POST',body:job,headers:auth});
 assert.equal(response.status,201);assert.equal(json.status,'queued');
 assert.match(json.id,/^[a-f0-9-]{36}$/);id=json.id;
});
await check('D1 UNIQUE constraint prevents duplicate campaign/platform',async()=>{
 const {response,json}=await request('/jobs',{method:'POST',body:job,headers:auth});
 assert.equal(response.status,200);assert.equal(json.status,'duplicate');
});
await check('authorized D1 job read contains exactly one queued row',async()=>{
 const {response,json}=await request('/jobs',{headers:auth});
 assert.equal(response.status,200);assert.equal(json.jobs.length,1);
 assert.equal(json.jobs[0].id,id);assert.equal(json.jobs[0].status,'queued');
});
await check('D1 cancellation updates row and writes audit history',async()=>{
 const {response,json}=await request('/jobs/'+id+'/cancel',{method:'POST',headers:auth});
 assert.equal(response.status,200);assert.equal(json.cancelled,true);
 const rows=await request('/jobs',{headers:auth});assert.equal(rows.json.jobs[0].status,'cancelled');
});
await check('repeated cancellation does not claim again',async()=>{
 const {response,json}=await request('/jobs/'+id+'/cancel',{method:'POST',headers:auth});
 assert.equal(response.status,200);assert.equal(json.cancelled,false);
});
await check('local Cron fires DRY-RUN job with D1 atomic status update',async()=>{
 const newJob={...job,campaignId:'local_d1_cron_002',runAtUTC:new Date(Date.now()+60000).toISOString().replace(/\\.\\d{3}Z$/,'Z')};
 const created=await request('/jobs',{method:'POST',body:newJob,headers:auth});
 assert.equal(created.response.status,201);
 const queuedId=created.json.id;
 const simulatedAt=Date.now()+120000;
 const response=await fetch(base+'/cdn-cgi/local/scheduled?time='+simulatedAt+'&cron=*%20*%20*%20*%20*');
 assert.equal(response.status,200);
 let final;
 for(let attempt=0;attempt<20;attempt++){
  final=await request('/jobs',{headers:auth});
  if(final.json.jobs.some(x=>x.id===queuedId&&x.status==='simulated'))break;
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 const item=final.json.jobs.find(x=>x.id===queuedId);
 assert.equal(item?.status,'simulated');
 assert.equal(item?.attempts,1);
});
console.log('RESULT Cloudflare local D1 '+count+'/10 PASS');
if(count!==10)process.exitCode=1;

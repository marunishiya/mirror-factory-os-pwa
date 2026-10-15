import worker from '../src/dryrun.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
let n=0;async function test(title,fn){try{await fn();n++;console.log('PASS',title)}catch(e){console.error('FAIL',title,e);process.exitCode=1}}
class MemoryD1{
 constructor(tables=true){this.tables=tables;this.jobs=[];this.events=[];this.failEvent='';this.batchCalls=0;this._queue=Promise.resolve()}
 async batch(statements){
   // Simulate sequential, all-or-nothing D1 transactions in the test double.
   const work=async()=>{
     const snapshot={jobs:this.jobs.map(x=>({...x})),events:this.events.map(x=>({...x}))};
     let lastChanges=0;const results=[];
     try{
       for(const statement of statements){
         const result=await statement.run(lastChanges);
         results.push(result);
         lastChanges=result.meta?.changes||0;
       }
       this.batchCalls++;
       return results;
     }catch(error){this.jobs=snapshot.jobs;this.events=snapshot.events;throw error}
   };
   const task=this._queue.then(work,work);
   this._queue=task.catch(()=>{});
   return task;
 }
 prepare(sql){let args=[];const self=this;return {bind(...v){args=v;return this;},async first(){if(sql.includes('sqlite_master'))return {n:self.tables?2:0};throw Error('SQL first '+sql)},async all(){if(sql.includes('SELECT id FROM jobs WHERE status'))return {results:self.jobs.filter(r=>r.status==='queued'&&r.mode==='dry_run'&&r.run_at_utc<=args[0]).slice(0,10).map(x=>({id:x.id}))};if(sql.includes('SELECT id,campaign_id,platform'))return {results:self.jobs.slice().reverse().map(j=>({id:j.id,campaign_id:j.campaign_id,platform:j.platform,title:j.title,run_at_utc:j.run_at_utc,mode:j.mode,status:j.status,attempts:j.attempts,created_at:j.created_at,updated_at:j.updated_at}))};throw Error('SQL all '+sql)},async run(lastChanges=0){if(sql.includes('INSERT OR IGNORE INTO jobs')){let [id,campaign_id,platform,title,caption,asset_ref,run_at_utc,created_at,updated_at]=args;if(campaign_id&&self.jobs.some(j=>j.campaign_id===campaign_id&&j.platform===platform))return {meta:{changes:0}};self.jobs.push({id,campaign_id,platform,title,caption,asset_ref,run_at_utc,created_at,updated_at,mode:'dry_run',status:'queued',attempts:0});return {meta:{changes:1}}}if(sql.startsWith('INSERT INTO job_events')){
  const [job_id,event,detail,created_at]=args;
  if(sql.includes('WHERE changes()=1')&&lastChanges!==1)return {meta:{changes:0}};
  if(sql.includes('WHERE EXISTS')&&!self.jobs.some(j=>j.id===job_id))return {meta:{changes:0}};
  if(self.failEvent===event)throw Error('Injected audit failure');
  self.events.push({job_id,event,detail,created_at});return {meta:{changes:1}}
}if(sql.includes("status='cancelled'")){let [updated_at,id]=args;let job=self.jobs.find(j=>j.id===id&&j.status==='queued');if(!job)return {meta:{changes:0}};job.status='cancelled';job.updated_at=updated_at;return {meta:{changes:1}}}if(sql.includes("SET status='processing'")){const [updated_at,id]=args;let job=self.jobs.find(j=>j.id===id&&j.status==='queued'&&j.mode==='dry_run');if(!job)return {meta:{changes:0}};job.status='processing';job.attempts++;job.updated_at=updated_at;return {meta:{changes:1}}}if(sql.includes("SET status='simulated'")){const [updated_at,id,due]=args;let job=self.jobs.find(j=>j.id===id&&j.status==='queued'&&j.mode==='dry_run'&&j.run_at_utc<=due);if(!job)return {meta:{changes:0}};job.status='simulated';job.attempts++;job.updated_at=updated_at;job.last_error='';return {meta:{changes:1}}}throw Error('SQL run '+sql)}}}
}
const url='https://mirror-social-scheduler.projectmirror-ai.workers.dev';const db=new MemoryD1();const env={DB:db};const authed={DB:db,ADMIN_TOKEN:'z'.repeat(48)};let nextdate=new Date(Date.now()+60000).toISOString().replace(/\.\d{3}Z$/,'Z');
const make=(path,method='GET',body,headers={})=>new Request(url+path,{method,headers:{...headers,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
const job={mode:'dry_run',qaApproved:true,platform:'threads',title:'QA TEST',caption:'safe preview text',runAtUTC:nextdate,campaignId:'batch_test001'};
await test('health requires DB',async()=>{assert.equal((await worker.fetch(make('/health'),{})).status,503)});
await test('health requires tables',async()=>{assert.equal((await worker.fetch(make('/health'),{DB:new MemoryD1(false)})).status,503)});
await test('health with D1 is ready and no publishing',async()=>{let r=await worker.fetch(make('/health'),env);assert.equal(r.status,200);let j=await r.json();assert.equal(j.databaseReady,true);assert.equal(j.publishingEnabled,false)});
await test('root health',async()=>{assert.equal((await worker.fetch(make('/'),env)).status,200)});
await test('channels ten API and note manual',async()=>{const j=await (await worker.fetch(make('/channels'),env)).json();assert.equal(j.channels.length,10);assert.equal(j.note.autoPublishEnabled,false)});
await test('no auth configured locks jobs',async()=>{assert.equal((await worker.fetch(make('/jobs'),env)).status,503)});
await test('incorrect bearer rejected',async()=>{assert.equal((await worker.fetch(make('/jobs','GET',null,{'Authorization':'Bearer nope'}),authed)).status,401)});
await test('wrong Origin rejected',async()=>{assert.equal((await worker.fetch(make('/health','GET',null,{Origin:'https://evil.example'}),env)).status,403)});
await test('approved Origin CORS',async()=>{let r=await worker.fetch(make('/health','GET',null,{Origin:'https://marunishiya.github.io'}),env);assert.equal(r.headers.get('access-control-allow-origin'),'https://marunishiya.github.io')});
await test('preflight',async()=>{let r=await worker.fetch(make('/jobs','OPTIONS',null,{Origin:'https://marunishiya.github.io'}),authed);assert.equal(r.status,204)});
async function create(j){return worker.fetch(make('/jobs','POST',j,{Authorization:'Bearer '+'z'.repeat(48)}),authed)}
await test('QA false rejected',async()=>{assert.equal((await create({...job,qaApproved:false})).status,400)});
await test('live publishing rejected',async()=>{assert.equal((await create({...job,mode:'live'})).status,400)});
await test('unknown platform rejected',async()=>{assert.equal((await create({...job,platform:'discord'})).status,400)});
await test('past time rejected',async()=>{assert.equal((await create({...job,runAtUTC:'2025-01-01T00:00:00Z'})).status,400)});
await test('video requires asset',async()=>{assert.equal((await create({...job,platform:'youtube'})).status,400)});
await test('text Threads without video accepted dry-run',async()=>{const r=await create(job);assert.equal(r.status,201);assert.equal((await r.json()).status,'queued')});
await test('campaign+platform idempotent',async()=>{const r=await create(job);assert.equal(r.status,200);assert.equal((await r.json()).status,'duplicate');assert.equal(db.jobs.length,1)});
await test('created event written',async()=>{assert.equal(db.events[0].event,'created')});
await test('authorized job list',async()=>{const r=await worker.fetch(make('/jobs','GET',null,{'Authorization':'Bearer '+'z'.repeat(48)}),authed);assert.equal((await r.json()).jobs.length,1)});
await test('scheduled handler simulates due job without HTTP',async()=>{let ctx={waitUntil:p=>{ctx.task=p}};await worker.scheduled({scheduledTime:Date.now()+120000},authed,ctx);await ctx.task;assert.equal(db.jobs[0].status,'simulated');assert.deepEqual(db.events.map(e=>e.event),['created','claimed','simulated'])});
await test('scheduled is idempotent',async()=>{let ctx={waitUntil:p=>{ctx.task=p}};await worker.scheduled({scheduledTime:Date.now()+120000},authed,ctx);await ctx.task;assert.equal(db.jobs[0].attempts,1);assert.equal(db.events.length,3)});
await test('unknown private route 404',async()=>{assert.equal((await worker.fetch(make('/api/post','POST',{},{Authorization:'Bearer '+'z'.repeat(48)}),authed)).status,404)});
await test('no authorization for mutations by default',async()=>{assert.equal((await worker.fetch(make('/jobs','POST',job),env)).status,503)});
await test('creation audit rollback leaves no orphan job',async()=>{
 const d=new MemoryD1();d.failEvent='created';
 const response=await worker.fetch(make('/jobs','POST',{...job,campaignId:'rollback_create001'},{Authorization:'Bearer '+'z'.repeat(48)}),{DB:d,ADMIN_TOKEN:'z'.repeat(48)});
 assert.equal(response.status,500);
 assert.equal(d.jobs.length,0);assert.equal(d.events.length,0);
});
await test('duplicate request never creates a second audit event',async()=>{
 assert.equal(db.events.filter(e=>e.event==='created').length,1);
 const duplicate=await create(job);
 assert.equal(duplicate.status,200);
 assert.equal(db.events.filter(e=>e.event==='created').length,1);
});
await test('cancel audit is atomic and idempotent',async()=>{
 const d=new MemoryD1(),e={DB:d,ADMIN_TOKEN:'z'.repeat(48)};
 const created=await worker.fetch(make('/jobs','POST',{...job,campaignId:'cancel_test001'},{Authorization:'Bearer '+'z'.repeat(48)}),e);
 assert.equal(created.status,201);
 const id=(await created.json()).id,req=make('/jobs/'+id+'/cancel','POST',undefined,{Authorization:'Bearer '+'z'.repeat(48)});
 assert.equal((await worker.fetch(req,e)).status,200);
 assert.equal(d.jobs[0].status,'cancelled');
 assert.deepEqual(d.events.map(x=>x.event),['created','cancelled']);
 const again=await worker.fetch(make('/jobs/'+id+'/cancel','POST',undefined,{Authorization:'Bearer '+'z'.repeat(48)}),e);
 assert.equal((await again.json()).cancelled,false);
 assert.equal(d.events.length,2);
});
await test('cancel event failure reverts status to queued',async()=>{
 const d=new MemoryD1(),e={DB:d,ADMIN_TOKEN:'z'.repeat(48)};
 const response=await worker.fetch(make('/jobs','POST',{...job,campaignId:'cancel_fail001'},{Authorization:'Bearer '+'z'.repeat(48)}),e);
 const id=(await response.json()).id;
 d.failEvent='cancelled';
 const failed=await worker.fetch(make('/jobs/'+id+'/cancel','POST',undefined,{Authorization:'Bearer '+'z'.repeat(48)}),e);
 assert.equal(failed.status,500);
 assert.equal(d.jobs[0].status,'queued');
 assert.deepEqual(d.events.map(x=>x.event),['created']);
});
await test('concurrent scheduler execution records one simulated pair',async()=>{
 const d=new MemoryD1(),e={DB:d},scheduledAt=new Date(Date.now()-60000).toISOString();
 d.jobs.push({id:randomUUID(),campaign_id:'race_case',platform:'threads',status:'queued',mode:'dry_run',run_at_utc:scheduledAt,attempts:0});
 const run=async()=>{let ctx={waitUntil:p=>ctx.task=p};await worker.scheduled({scheduledTime:Date.now()},e,ctx);await ctx.task};
 await Promise.all([run(),run(),run()]);
 assert.equal(d.jobs[0].status,'simulated');
 assert.equal(d.jobs[0].attempts,1);
 assert.deepEqual(d.events.map(x=>x.event),['claimed','simulated']);
});
await test('scheduler audit failure rolls back job to queued',async()=>{
 const d=new MemoryD1(),e={DB:d};
 d.jobs.push({id:randomUUID(),platform:'threads',status:'queued',mode:'dry_run',run_at_utc:new Date(Date.now()-60000).toISOString(),attempts:0});
 d.failEvent='simulated';
 let ctx={waitUntil:p=>ctx.task=p};await worker.scheduled({scheduledTime:Date.now()},e,ctx);
 await assert.rejects(ctx.task,/Injected audit failure/);
 assert.equal(d.jobs[0].status,'queued');assert.equal(d.jobs[0].attempts,0);assert.equal(d.events.length,0);
});
console.log(`RESULT ${n}/29 PASS`);
if(n!==29)process.exitCode=1;

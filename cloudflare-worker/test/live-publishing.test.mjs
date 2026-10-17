import assert from 'node:assert/strict';
import worker from '../src/dryrun.js';
import {processLiveDue,validateLive} from '../src/live-publishing.js';
let n=0;
async function test(name,fn){try{await fn();n++;console.log('PASS',name)}catch(e){console.error('FAIL',name,e);process.exitCode=1}}
const future=new Date(Date.now()+60000).toISOString().replace(/\.\d{3}Z$/,'Z');
const past=new Date(Date.now()-60000).toISOString().replace(/\.\d{3}Z$/,'Z');
const job={id:'f8c713bd-8d1b-4537-9dbd-4b5a42899222',platform:'mastodon',caption:'PROJECT MIRROR test',asset_ref:'',mode:'live',status:'queued',run_at_utc:past,attempts:0};
const enabled={LIVE_PUBLISHING_ENABLED:'true',MASTODON_BASE_URL:'https://mastodon.social',MASTODON_ACCESS_TOKEN:'fake_test_token'};
class MockD1{
 constructor(rows=[]){this.jobs=rows.map(x=>({...x}));this.events=[];this.batchCount=0;this.q=Promise.resolve()}
 prepare(sql){const db=this;let args=[];
   return {bind(...a){args=a;return this},
    async all(){
     if(sql.includes("mode='live'"))return {results:db.jobs.filter(x=>x.status==='queued'&&x.mode==='live'&&x.run_at_utc<=args[0]).map(x=>({...x}))};
     throw Error('Unexpected query '+sql);
    },
    async run(previous=0){
     if(sql.includes("SET status='dispatching'")){const row=db.jobs.find(x=>x.id===args[1]&&x.status==='queued'&&x.mode==='live'&&x.run_at_utc<=args[2]);if(!row)return {meta:{changes:0}};row.status='dispatching';row.attempts++;return {meta:{changes:1}}}
     if(sql.includes("status='published'")){const row=db.jobs.find(x=>x.id===args[1]&&x.status==='dispatching');if(!row)return {meta:{changes:0}};row.status='published';return {meta:{changes:1}}}
     if(sql.includes("status='needs_review'")){const row=db.jobs.find(x=>x.id===args[1]&&x.status==='dispatching');if(!row)return {meta:{changes:0}};row.status='needs_review';row.last_error='delivery_unconfirmed';return {meta:{changes:1}}}
     if(sql.includes('INSERT INTO job_events')){if(!previous)return {meta:{changes:0}};db.events.push({id:args[0],event:args[1],detail:args[2]});return {meta:{changes:1}}}
     throw Error('Unexpected write '+sql);
    }};
 }
 async batch(statements){
  const task=async()=>{
   const oldJobs=this.jobs.map(x=>({...x})),oldEvents=this.events.slice();let prev=0,results=[];
   try{for(const q of statements){const result=await q.run(prev);prev=result.meta.changes;results.push(result)}this.batchCount++;return results}
   catch(e){this.jobs=oldJobs;this.events=oldEvents;throw e}
  };
  const promise=this.q.then(task,task);this.q=promise.catch(()=>{});return promise;
 }
}
await test('default scheduler has no external API calls',async()=>{
 let calls=0;const db=new MockD1([job]);
 const result=await processLiveDue(db,{LIVE_PUBLISHING_ENABLED:'false'},past,async()=>{calls++;throw Error('unexpected network')});
 assert.equal(result.blocked,true);assert.equal(calls,0);assert.equal(db.jobs[0].status,'queued');
});
await test('missing platform secret leaves queue intact',async()=>{
 const db=new MockD1([job]),r=await processLiveDue(db,{LIVE_PUBLISHING_ENABLED:'true'},past,()=>{throw Error('unexpected network')});
 assert.equal(r.sent,0);assert.equal(db.jobs[0].attempts,0);
});
await test('send once, record provider receipt and final status',async()=>{
 const db=new MockD1([job]);let calls=0;
 const result=await processLiveDue(db,enabled,past,async()=>{calls++;return Response.json({id:'19283'})});
 assert.equal(result.sent,1);assert.equal(calls,1);assert.equal(db.jobs[0].status,'published');assert.equal(db.jobs[0].attempts,1);
 assert.deepEqual(db.events.map(x=>x.event),['dispatching','published']);
 assert.equal(db.events[1].detail,'19283');
});
await test('duplicate concurrent schedule runs are claimed once',async()=>{
 const db=new MockD1([job]);let calls=0;
 const sender=async()=>{calls++;return Response.json({id:'receipt'})};
 await Promise.all([processLiveDue(db,enabled,past,sender),processLiveDue(db,enabled,past,sender),processLiveDue(db,enabled,past,sender)]);
 assert.equal(calls,1);assert.equal(db.jobs[0].attempts,1);
 assert.deepEqual(db.events.map(x=>x.event),['dispatching','published']);
});
await test('rate-limit response needs human review, no auto retry',async()=>{
 const db=new MockD1([job]);let calls=0;
 const transport=async()=>{calls++;return new Response('limited',{status:429})};
 const first=await processLiveDue(db,enabled,past,transport);
 assert.equal(first.review,1);assert.equal(db.jobs[0].status,'needs_review');
 const second=await processLiveDue(db,enabled,past,transport);assert.equal(second.sent,0);assert.equal(calls,1);
});
await test('ambiguous network error needs human review and no resend',async()=>{
 const db=new MockD1([job]);let calls=0;
 const transport=async()=>{calls++;throw Error('network timeout')};
 await processLiveDue(db,enabled,past,transport);
 assert.equal(db.jobs[0].status,'needs_review');
 assert.equal(db.jobs[0].last_error,'delivery_unconfirmed');
 await processLiveDue(db,enabled,past,transport);assert.equal(calls,1);
});
await test('live payload rejects unapproved QA',async()=>{
 assert.throws(()=>validateLive({mode:'live',qaApproved:false}),/manual_qa_required/);
});
await test('live payload rejects unconnected video networks',async()=>{
 assert.throws(()=>validateLive({mode:'live',qaApproved:true,platform:'youtube'}),/live_platform_unavailable/);
});
await test('live payload requires stable campaign ID and limits content',async()=>{
 const base={mode:'live',qaApproved:true,platform:'bluesky',title:'qa',caption:'test',runAtUTC:future,campaignId:'campaign_test01'};
 assert.equal(validateLive(base).platform,'bluesky');
 assert.throws(()=>validateLive({...base,campaignId:''}),/campaign_id_required/);
 assert.throws(()=>validateLive({...base,caption:'あ'.repeat(301)}),/post_too_long/);
});
await test('live HTTP registration locked by default',async()=>{
 const response=await worker.fetch(new Request('https://mirror-social-scheduler.example/jobs/live',{method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(48)},body:'{}'}),{ADMIN_TOKEN:'x'.repeat(48),DB:{prepare(){return {first:async()=>({n:2})}}}});
 assert.equal(response.status,503);
 assert.equal((await response.json()).error,'live_publishing_disabled');
});
console.log('RESULT independent queue '+n+'/10 PASS');
if(n!==10)process.exitCode=1;

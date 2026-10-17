import assert from 'node:assert/strict';
import worker from '../src/dryrun.js';

const origin='https://mirror-social-scheduler.example';
const secret='q'.repeat(48);
const utc=new Date(Date.now()+120000).toISOString().replace(/\.\d{3}Z$/,'Z');
const good={mode:'live',qaApproved:true,platform:'mastodon',title:'Approved',caption:'Test payload not published',runAtUTC:utc,campaignId:'campaign_live001'};
class QueueDB{
 constructor(){this.rows=[];this.events=[];this.writes=0}
 prepare(sql){
  let args=[],self=this;
  return {bind(...v){args=v;return this;},async first(){if(sql.includes('sqlite_master'))return {n:2};throw Error('unexpected first')},
    async run(){
     if(sql.includes('INSERT OR IGNORE INTO jobs')){
       if(self.rows.some(x=>x.campaignId===args[1]&&x.platform===args[2]))return {meta:{changes:0}};
       self.rows.push({id:args[0],campaignId:args[1],platform:args[2],caption:args[4],mode:'live',status:'queued'});
       self.writes++;
       return {meta:{changes:1}};
     }
     if(sql.includes('INSERT INTO job_events')){
       if(!self.rows.some(x=>x.id===args[4]))return {meta:{changes:0}};
       self.events.push({id:args[0],event:args[1]});
       return {meta:{changes:1}};
     }
     throw Error('unexpected run '+sql);
    }
  }
 }
 async batch(stmts){const result=[];for(const x of stmts)result.push(await x.run());return result}
}
const db=new QueueDB();
const env={DB:db,ADMIN_TOKEN:secret,LIVE_PUBLISHING_ENABLED:'true',MASTODON_ACCESS_TOKEN:'test_only',MASTODON_BASE_URL:'https://mastodon.social'};
function req(body,headers={}){return new Request(origin+'/jobs/live',{method:'POST',headers:{Authorization:'Bearer '+secret,'content-type':'application/json',...headers},body:JSON.stringify(body)})}
let n=0;
async function t(name,fn){try{await fn();n++;console.log('PASS',name)}catch(e){console.error('FAIL',name,e);process.exitCode=1}}
await t('live queue stores approved Mastodon text but never calls SNS',async()=>{
 const r=await worker.fetch(req(good),env);assert.equal(r.status,201);
 const j=await r.json();assert.equal(j.status,'queued');assert.equal(j.mode,'live');
 assert.equal(db.rows.length,1);assert.equal(db.events[0].event,'created');
});
await t('same campaign cannot enqueue twice',async()=>{
 const r=await worker.fetch(req(good),env);assert.equal(r.status,200);
 assert.equal((await r.json()).status,'duplicate');assert.equal(db.rows.length,1);
});
await t('wrong bearer token cannot register a post',async()=>{
 const r=await worker.fetch(req({...good,campaignId:'campaign_live002'},{Authorization:'Bearer wrong'}),env);
 assert.equal(r.status,401);assert.equal(db.rows.length,1);
});
await t('incorrect Origin blocks queue access',async()=>{
 const r=await worker.fetch(req(good,{Origin:'https://attacker.invalid'}),env);
 assert.equal(r.status,403);
});
await t('missing QA approval refuses live queue',async()=>{
 const r=await worker.fetch(req({...good,qaApproved:false,campaignId:'campaign_live003'}),env);
 assert.equal(r.status,400);assert.equal(db.rows.length,1);
});
await t('non-ready platform is rejected',async()=>{
 const r=await worker.fetch(req({...good,platform:'instagram',campaignId:'campaign_live004'}),env);
 assert.equal(r.status,400);assert.equal(db.rows.length,1);
});
await t('missing credentials leave queue unchanged',async()=>{
 const r=await worker.fetch(req({...good,campaignId:'campaign_live005'}),{DB:db,ADMIN_TOKEN:secret,LIVE_PUBLISHING_ENABLED:'true'});
 assert.equal(r.status,503);assert.equal(db.rows.length,1);
});
await t('no enable switch leaves queue unchanged',async()=>{
 const r=await worker.fetch(req({...good,campaignId:'campaign_live006'}),{...env,LIVE_PUBLISHING_ENABLED:'false'});
 assert.equal(r.status,503);assert.equal(db.rows.length,1);
});
console.log('RESULT independent registration '+n+'/8 PASS');
if(n!==8)process.exitCode=1;

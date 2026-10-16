import assert from 'node:assert/strict';
const stage=process.env.DEPLOY_STAGE;
assert.ok(['bootstrap','dry-run'].includes(stage),'Invalid DEPLOY_STAGE');
const expected=stage==='bootstrap'?'0.4-bootstrap':'0.4-dry-run';
const url='https://mirror-social-scheduler.projectmirror-ai.workers.dev/health';
let error;
for(let attempt=1;attempt<=10;attempt++){
 try {
  const controller=new AbortController();const id=setTimeout(()=>controller.abort(),8000);
  const r=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});clearTimeout(id);
  const body=await r.json();
  assert.equal(r.status,200);
  assert.equal(body.service,'MIRROR SOCIAL ENGINE');
  assert.equal(body.version,expected);
  assert.equal(body.databaseReady,true);
  assert.equal(body.publishingEnabled,false);
  if(stage==='bootstrap')assert.equal(body.jobSubmissionEnabled,false);
  // Even if a future ADMIN_TOKEN secret exists, unsigned requests must never allow job access.
  const jobs=await fetch('https://mirror-social-scheduler.projectmirror-ai.workers.dev/jobs');
  assert.ok([401,503].includes(jobs.status),'Anonymous /jobs must be locked');
  console.log('PASS deployed '+expected+' /health + anonymous /jobs locked');
  process.exit(0);
 }catch(e){error=e;console.log('Verification pending '+attempt+': '+e.message);await new Promise(resolve=>setTimeout(resolve,2500));}
}
console.error('DEPLOYED HEALTH CHECK FAILED:',error?.message);
process.exit(1);

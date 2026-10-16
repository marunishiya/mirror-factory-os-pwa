/**
 * MIRROR SOCIAL ENGINE | Worker v0.4 | DRY RUN ONLY
 * D1 binding: DB => mirror-social-db
 * Optional future secret: ADMIN_TOKEN (at least 32 characters)
 * Public: GET /, /health, /channels. Private routes LOCKED unless ADMIN_TOKEN exists.
 * No SNS OAuth, no outgoing network calls, no actual publishing or billing.
 */
const CHANNELS = ['youtube','instagram','tiktok','threads','bluesky','tumblr','x','pinterest','mastodon','facebook'];
const VIDEO_ONLY = ['youtube','instagram','tiktok'];
const ORIGIN = 'https://marunishiya.github.io';
const JSON_HEADERS = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
function json(obj,status=200,origin='') {
  const h={...JSON_HEADERS};
  if(origin===ORIGIN){h['access-control-allow-origin']=ORIGIN;h['vary']='Origin';}
  return new Response(JSON.stringify(obj),{status,headers:h});
}
function validUTC(s) {
  if(typeof s!=='string'|| !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s))return false;
  const d=new Date(s);return !Number.isNaN(d.getTime())&&d.toISOString().replace('.000Z','Z')===s;
}
function authorized(request,env){
  const token=env.ADMIN_TOKEN;
  return typeof token==='string'&&token.length>=32&&request.headers.get('Authorization')==='Bearer '+token;
}
async function readyDB(db){
  if(!db)return false;
  const r=await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('jobs','job_events')").first();
  return Number(r?.n)===2;
}
function validation(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('invalid_json');
  if(input.mode!=='dry_run')throw Error('live_publishing_disabled');
  if(input.qaApproved!==true)throw Error('manual_qa_approval_required');
  if(!CHANNELS.includes(input.platform))throw Error('unsupported_platform');
  if(typeof input.title!=='string'||!input.title.trim()||input.title.length>150)throw Error('invalid_title');
  if(typeof input.caption!=='string'||!input.caption.trim()||input.caption.length>2200)throw Error('invalid_caption');
  if(!validUTC(input.runAtUTC))throw Error('invalid_utc_time');
  if(Date.parse(input.runAtUTC)<Date.now()-30000)throw Error('scheduled_time_in_past');
  if(input.assetRef!==undefined&&(typeof input.assetRef!=='string'||input.assetRef.length>500))throw Error('invalid_asset_ref');
  if(VIDEO_ONLY.includes(input.platform)&&!String(input.assetRef||'').trim())throw Error('video_asset_required');
  const campaignId=input.campaignId||'';
  if(typeof campaignId!=='string'||(campaignId&&!/^[a-zA-Z0-9_-]{6,80}$/.test(campaignId)))throw Error('invalid_campaign_id');
  return {platform:input.platform,title:input.title.trim(),caption:input.caption.trim(),assetRef:input.assetRef||'',runAtUTC:input.runAtUTC,campaignId};
}
async function handler(request,env){
  const url=new URL(request.url),path=url.pathname,origin=request.headers.get('Origin')||'';
  if(origin && origin!==ORIGIN)return json({error:'origin_not_allowed'},403);
  if(request.method==='OPTIONS'){
    if(origin!==ORIGIN)return json({error:'origin_not_allowed'},403);
    return new Response(null,{status:204,headers:{'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Authorization,Content-Type','access-control-max-age':'600','vary':'Origin'}});
  }
  if(request.method==='GET'&&(path==='/'||path==='/health')){
    const dbReady=await readyDB(env.DB);
    return json({service:'MIRROR SOCIAL ENGINE',version:'0.4-dry-run',status:dbReady?'ready':'storage_unavailable',databaseReady:dbReady,publishingEnabled:false,snsConnected:false,cronConfigured:'not_verified'},dbReady?200:503,origin);
  }
  if(request.method==='GET'&&path==='/channels'){
    return json({channels:CHANNELS.map(id=>({id,connected:false,autoPublishEnabled:false})),note:{autoPublishEnabled:false,mode:'manual_handoff'}},200,origin);
  }
  if(typeof env.ADMIN_TOKEN!=='string'||env.ADMIN_TOKEN.length<32)return json({error:'admin_access_not_configured'},503,origin);
  if(!authorized(request,env))return json({error:'unauthorized'},401,origin);
  if(!await readyDB(env.DB))return json({error:'storage_unavailable'},503,origin);
  if(request.method==='GET'&&path==='/jobs'){
    const r=await env.DB.prepare('SELECT id,campaign_id,platform,title,run_at_utc,mode,status,attempts,created_at,updated_at FROM jobs ORDER BY created_at DESC LIMIT 100').all();
    return json({jobs:r.results||[],dryRunOnly:true},200,origin);
  }
  if(request.method==='POST'&&path==='/jobs'){
    if(Number(request.headers.get('content-length')||0)>12000)return json({error:'body_too_large'},413,origin);
    const body=await request.text(); if(body.length>12000)return json({error:'body_too_large'},413,origin);
    let job;try{job=validation(JSON.parse(body));}catch(e){return json({error:e.message||'invalid_job'},400,origin);}
    const now=new Date().toISOString(),id=crypto.randomUUID();
    const result=await env.DB.prepare(`INSERT OR IGNORE INTO jobs(id,campaign_id,platform,title,caption,asset_ref,run_at_utc,mode,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'dry_run','queued',?,?)`).bind(id,job.campaignId,job.platform,job.title,job.caption,job.assetRef,job.runAtUTC,now,now).run();
    if(!result.meta?.changes)return json({status:'duplicate',note:'Previously queued campaign/platform unchanged. No SNS post.'},200,origin);
    await env.DB.prepare('INSERT INTO job_events(job_id,event,detail,created_at) VALUES(?,?,?,?)').bind(id,'created','DRY RUN ONLY',now).run();
    return json({id,status:'queued',mode:'dry_run',publishingEnabled:false},201,origin);
  }
  const cancel=path.match(/^\/jobs\/([a-f0-9-]{36})\/cancel$/);
  if(request.method==='POST'&&cancel){
    const now=new Date().toISOString();const r=await env.DB.prepare("UPDATE jobs SET status='cancelled',updated_at=? WHERE id=? AND status='queued'").bind(now,cancel[1]).run();
    if(r.meta?.changes)await env.DB.prepare('INSERT INTO job_events(job_id,event,detail,created_at) VALUES(?,?,?,?)').bind(cancel[1],'cancelled','manual_cancel',now).run();
    return json({cancelled:Boolean(r.meta?.changes)},200,origin);
  }
  return json({error:'not_found'},404,origin);
}
async function processDue(db,now){
  if(!await readyDB(db))throw Error('storage_unavailable');
  const r=await db.prepare("SELECT id FROM jobs WHERE status='queued' AND mode='dry_run' AND run_at_utc<=? ORDER BY run_at_utc LIMIT 10").bind(now).all();
  let simulated=0;
  for(const row of r.results||[]){
    const claimed=await db.prepare("UPDATE jobs SET status='processing',attempts=attempts+1,updated_at=? WHERE id=? AND status='queued' AND mode='dry_run'").bind(now,row.id).run();
    if(!claimed.meta?.changes)continue;
    await db.prepare('INSERT INTO job_events(job_id,event,detail,created_at) VALUES(?,?,?,?)').bind(row.id,'claimed','internal_scheduler',now).run();
    await db.prepare("UPDATE jobs SET status='simulated',last_error='',updated_at=? WHERE id=? AND status='processing'").bind(now,row.id).run();
    await db.prepare('INSERT INTO job_events(job_id,event,detail,created_at) VALUES(?,?,?,?)').bind(row.id,'simulated','No SNS API called; nothing published.',now).run();
    simulated++;
  }
  return simulated;
}
export default {
  async fetch(request,env){try{return await handler(request,env)}catch(e){console.error('worker_error',e?.message||'unknown');return json({error:'internal_error'},500,request.headers.get('Origin')||'');}},
  async scheduled(controller,env,ctx){ctx.waitUntil(processDue(env.DB,new Date(controller.scheduledTime).toISOString()));}
};

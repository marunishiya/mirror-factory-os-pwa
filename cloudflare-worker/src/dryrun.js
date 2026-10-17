import {processLiveDue,validateLive,liveAuthorized} from './live-publishing.js';
import {videoReadiness} from './video-official.js';
import {videoTablesReady,registerVideoJob,listVideoJobs,cancelVideoJob,dispatchVideoDue,reconcileVideoPending} from './video-queue.js';
/**
 * MIRROR SOCIAL ENGINE | Worker v0.6 independent SNS pilot, live off by default
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
  try {
    const r=await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('jobs','job_events')").first();
    return Number(r?.n)===2;
  } catch {
    // D1 can be temporarily unavailable. Report 503 without exposing database internals.
    return false;
  }
}
/**
 * Read at most 12KB of UTF-8 JSON. Content-Length cannot be trusted:
 * stream and count actual bytes before buffering the request.
 */
async function readLimitedBody(request,maxBytes=12000){
  const claimed=Number(request.headers.get('content-length'));
  if(Number.isFinite(claimed)&&claimed>maxBytes)return null;
  if(!request.body)return '';
  const reader=request.body.getReader(),parts=[];
  let size=0;
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    size+=value.byteLength;
    if(size>maxBytes){
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const data=new Uint8Array(size);
  let at=0;
  for(const part of parts){data.set(part,at);at+=part.byteLength;}
  return new TextDecoder('utf-8',{fatal:true}).decode(data);
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
    return json({service:'MIRROR SOCIAL ENGINE',version:'0.8-video-reservation-gated',status:dbReady?'ready':'storage_unavailable',databaseReady:dbReady,publishingEnabled:liveAuthorized(env,'bluesky')||liveAuthorized(env,'mastodon'),snsConnected:false,cronConfigured:'not_verified'},dbReady?200:503,origin);
  }
  if(request.method==='GET'&&path==='/channels'){
    return json({channels:CHANNELS.map(id=>({id,connected:false,autoPublishEnabled:false})),note:{autoPublishEnabled:false,mode:'manual_handoff'}},200,origin);
  }
  if(typeof env.ADMIN_TOKEN!=='string'||env.ADMIN_TOKEN.length<32)return json({error:'admin_access_not_configured'},503,origin);
  if(!authorized(request,env))return json({error:'unauthorized'},401,origin);
  if(!await readyDB(env.DB))return json({error:'storage_unavailable'},503,origin);
  if(request.method==='GET'&&path==='/video-readiness'){
    return json(videoReadiness(env),200,origin);
  }
  if(request.method==='GET'&&path==='/video/jobs'){
    if(!await videoTablesReady(env.DB))return json({error:'video_schema_unavailable'},503,origin);
    return json({jobs:await listVideoJobs(env.DB),enabled:env.VIDEO_QUEUE_ENABLED==='true',autoPublishConfigured:env.LIVE_PUBLISHING_ENABLED==='true'&&env.VIDEO_LIVE_ENABLED==='true'&&env.VIDEO_DISPATCH_APPROVED==='true'},200,origin);
  }
  if(request.method==='POST'&&path==='/video/jobs'){
    let body;
    try{body=await readLimitedBody(request)}catch{return json({error:'invalid_json'},400,origin)}
    if(body===null)return json({error:'body_too_large'},413,origin);
    let parsed;try{parsed=JSON.parse(body)}catch{return json({error:'invalid_json'},400,origin)}
    try{
      const result=await registerVideoJob(env.DB,parsed,env);
      return json(result,result.created?201:200,origin);
    }catch(e){
      const code=String(e?.message||'video_job_failed');
      const status=code==='video_queue_disabled'||code==='video_schema_unavailable'?503:code==='video_campaign_conflict'?409:400;
      return json({error:code},status,origin);
    }
  }
  const vc=path.match(/^\/video\/jobs\/([a-f0-9-]{36})\/cancel$/);
  if(request.method==='POST'&&vc){
    if(!await videoTablesReady(env.DB))return json({error:'video_schema_unavailable'},503,origin);
    return json({cancelled:await cancelVideoJob(env.DB,vc[1])},200,origin);
  }
  if(request.method==='GET'&&path==='/jobs'){
    const r=await env.DB.prepare('SELECT id,campaign_id,platform,title,run_at_utc,mode,status,attempts,created_at,updated_at FROM jobs ORDER BY created_at DESC LIMIT 100').all();
    return json({jobs:r.results||[],dryRunOnly:true},200,origin);
  }
  if(request.method==='POST'&&path==='/jobs/live'){
    if(env.LIVE_PUBLISHING_ENABLED!=='true')return json({error:'live_publishing_disabled'},503,origin);
    let body;
    try {body=await readLimitedBody(request);}
    catch {return json({error:'invalid_json'},400,origin);}
    if(body===null)return json({error:'body_too_large'},413,origin);
    let job;
    try {job=validateLive(JSON.parse(body));}
    catch(e){return json({error:e.message||'invalid_live_job'},400,origin);}
    if(!liveAuthorized(env,job.platform))return json({error:'platform_credentials_missing'},503,origin);
    const now=new Date().toISOString(),id=crypto.randomUUID();
    const [insert]=await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO jobs(id,campaign_id,platform,title,caption,asset_ref,run_at_utc,mode,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'live','queued',?,?)`).bind(id,job.campaignId,job.platform,job.title,job.caption,'',job.runAtUTC,now,now),
      env.DB.prepare("INSERT INTO job_events(job_id,event,detail,created_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM jobs WHERE id=?)").bind(id,'created','LIVE PILOT: approved, queued only',now,id)
    ]);
    if(!insert.meta?.changes)return json({status:'duplicate',publishingEnabled:true},200,origin);
    return json({id,status:'queued',mode:'live',publishingEnabled:true},201,origin);
  }
  if(request.method==='POST'&&path==='/jobs'){
    let body;
    try { body=await readLimitedBody(request); }
    catch { return json({error:'invalid_json'},400,origin); }
    if(body===null)return json({error:'body_too_large'},413,origin);
    let job;
    try { job=validation(JSON.parse(body)); }
    catch(e){return json({error:e.message||'invalid_job'},400,origin);}
    const now=new Date().toISOString(),id=crypto.randomUUID();
    // One D1 transaction: never persist a job without its creation audit event.
    const [result]=await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO jobs(id,campaign_id,platform,title,caption,asset_ref,run_at_utc,mode,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'dry_run','queued',?,?)`).bind(id,job.campaignId,job.platform,job.title,job.caption,job.assetRef,job.runAtUTC,now,now),
      env.DB.prepare("INSERT INTO job_events(job_id,event,detail,created_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM jobs WHERE id=?)").bind(id,'created','DRY RUN ONLY',now,id)
    ]);
    if(!result.meta?.changes)return json({status:'duplicate',note:'Previously queued campaign/platform unchanged. No SNS post.'},200,origin);
    return json({id,status:'queued',mode:'dry_run',publishingEnabled:false},201,origin);
  }
  const cancel=path.match(/^\/jobs\/([a-f0-9-]{36})\/cancel$/);
  if(request.method==='POST'&&cancel){
    const now=new Date().toISOString();
    const [r]=await env.DB.batch([
      env.DB.prepare("UPDATE jobs SET status='cancelled',updated_at=? WHERE id=? AND status='queued'").bind(now,cancel[1]),
      // SQLite changes() refers to the preceding UPDATE in this transaction.
      env.DB.prepare("INSERT INTO job_events(job_id,event,detail,created_at) SELECT ?,?,?,? WHERE changes()=1").bind(cancel[1],'cancelled','manual_cancel',now)
    ]);
    return json({cancelled:Boolean(r.meta?.changes)},200,origin);
  }
  return json({error:'not_found'},404,origin);
}
async function processDue(db,now){
  if(!await readyDB(db))throw Error('storage_unavailable');
  const r=await db.prepare("SELECT id FROM jobs WHERE status='queued' AND mode='dry_run' AND run_at_utc<=? ORDER BY run_at_utc LIMIT 10").bind(now).all();
  let simulated=0;
  for(const row of r.results||[]){
    // DRY RUN ONLY: no outgoing API call. Atomically simulate and audit to avoid
    // abandoned 'processing' jobs; a concurrent scheduled invocation loses the CAS.
    const [claimed]=await db.batch([
      db.prepare("UPDATE jobs SET status='simulated',attempts=attempts+1,last_error='',updated_at=? WHERE id=? AND status='queued' AND mode='dry_run' AND run_at_utc<=?").bind(now,row.id,now),
      db.prepare("INSERT INTO job_events(job_id,event,detail,created_at) SELECT ?,?,?,? WHERE changes()=1").bind(row.id,'claimed','internal_scheduler',now),
      db.prepare("INSERT INTO job_events(job_id,event,detail,created_at) SELECT ?,?,?,? WHERE changes()=1").bind(row.id,'simulated','No SNS API called; nothing published.',now)
    ]);
    if(claimed.meta?.changes)simulated++;
  }
  return simulated;
}
export default {
  async fetch(request,env){try{return await handler(request,env)}catch(e){console.error('worker_error',e?.message||'unknown');return json({error:'internal_error'},500,request.headers.get('Origin')||'');}},
  async scheduled(controller,env,ctx){
    // Persisted run_at_utc is second-precision ISO-Z; use the same precision in comparisons.
    const now=new Date(controller.scheduledTime).toISOString().replace(/\.\d{3}Z$/,'Z');
    // The two job modes cannot overlap. Default config only simulates; no HTTP.
    ctx.waitUntil((async()=>{
      await processDue(env.DB,now);
      if(env.LIVE_PUBLISHING_ENABLED==='true')await processLiveDue(env.DB,env,now);
      // Isolated media queue; no provider traffic without three manual switches
      // and the correct official platform credentials.
      await reconcileVideoPending(env.DB,env,now);
      await dispatchVideoDue(env.DB,env,now);
    })());
  }
};

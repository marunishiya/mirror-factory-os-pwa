/**
 * MIRROR video reservation engine (D1) — no Metricool.
 * Distinct video_jobs tables allow additive opt-in rollout without touching
 * legacy jobs/MASTER. Separate queue enable, dispatch enable and OAuth gates.
 * API POST calls are at-most-once: ambiguous results are NEVER retried.
 */
import {
 approvedR2Key,verifiedVideoUrl,createInstagramReel,instagramContainerStatus,
 publishInstagramReadyReel,submitTikTokVideo,tiktokVideoStatus,
 uploadYoutubeVideo,youtubeVideoStatus,instagramPublishedMediaStatus
} from './video-official.js';

const PLATFORMS=['youtube','instagram','tiktok'];
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const VIDEO_FIELDS='id,campaign_id,platform,title,run_at_utc,status,phase,provider_id,published_id,attempts,check_attempts,last_error,created_at,updated_at';

export function validTime(s){
 return typeof s==='string'&&ISO.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,19)+'Z'===s;
}
function approved(s){return typeof s==='string'&&/^[a-zA-Z0-9_-]{6,80}$/.test(s)}
export function videoQueueReady(env){return env.VIDEO_QUEUE_ENABLED==='true'}
export function videoDispatchReady(env,platform){
 if(env.LIVE_PUBLISHING_ENABLED!=='true'||env.VIDEO_LIVE_ENABLED!=='true'||env.VIDEO_DISPATCH_APPROVED!=='true')return false;
 if(platform==='youtube')return Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.YOUTUBE_REFRESH_TOKEN&&env.VIDEO_R2?.get);
 if(platform==='instagram')return Boolean(env.INSTAGRAM_ACCESS_TOKEN&&env.INSTAGRAM_IG_USER_ID&&env.INSTAGRAM_GRAPH_VERSION&&env.INSTAGRAM_CONTENT_PUBLISH_SCOPE_CONFIRMED==='true');
 if(platform==='tiktok')return Boolean(env.TIKTOK_USER_ACCESS_TOKEN&&env.TIKTOK_APP_AUDITED==='true'&&env.TIKTOK_DOMAIN_VERIFIED==='true'&&env.TIKTOK_VIDEO_PUBLISH_SCOPE_CONFIRMED==='true');
 return false;
}
export function validateVideoJob(input,env,now=Date.now()){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('invalid_video_job');
 if(input.qaApproved!==true||input.mediaApproved!==true||input.publishApproved!==true)throw Error('video_explicit_approval_required');
 if(!PLATFORMS.includes(input.platform))throw Error('unsupported_video_platform');
 if(!approved(input.campaignId))throw Error('campaign_id_required');
 if(typeof input.title!=='string'||!input.title.trim()||input.title.length>150)throw Error('invalid_title');
 if(typeof input.caption!=='string'||!input.caption.trim()||input.caption.length>2200)throw Error('invalid_caption');
 if(typeof input.isAigc!=='boolean')throw Error('ai_generated_disclosure_required');
 if(!validTime(input.runAtUTC)||Date.parse(input.runAtUTC)<now+30000)throw Error('invalid_scheduled_time');
 if(input.platform==='youtube'){
  approvedR2Key(input.assetRef);
  if(input.videoUrl)throw Error('youtube_uses_private_r2_only');
  if(!['private','unlisted','public'].includes(input.privacyStatus))throw Error('youtube_privacy_required');
  if(input.privacyStatus==='public'&&env.YOUTUBE_PUBLIC_ALLOWED!=='true')throw Error('youtube_public_not_approved');
 }else{
  verifiedVideoUrl(input.videoUrl,env);
  if(input.assetRef)throw Error('video_asset_ref_not_allowed');
  if(input.platform==='tiktok'&&!['PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','SELF_ONLY'].includes(input.privacyLevel))throw Error('tiktok_privacy_required');
 }
 return {platform:input.platform,campaignId:input.campaignId,title:input.title.trim(),caption:input.caption.trim(),
  assetRef:input.platform==='youtube'?input.assetRef:'',videoUrl:input.platform==='youtube'?'':input.videoUrl,
  privacy:input.platform==='youtube'?input.privacyStatus:input.platform==='tiktok'?input.privacyLevel:'',
  isAigc:input.isAigc,runAtUTC:input.runAtUTC};
}
export async function videoTablesReady(db){
 if(!db)return false;
 try{const x=await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('video_jobs','video_job_events')").first();return Number(x?.n)===2}
 catch{return false}
}
const publicView=r=>({
 id:r.id,campaignId:r.campaign_id,platform:r.platform,title:r.title,
 runAtUTC:r.run_at_utc,status:r.status,phase:r.phase,providerId:r.provider_id||null,
 publishedId:r.published_id||null,attempts:r.attempts,checkAttempts:r.check_attempts,
 lastError:r.last_error||'',updatedAt:r.updated_at
});
export async function listVideoJobs(db){
 const x=await db.prepare('SELECT '+VIDEO_FIELDS+' FROM video_jobs ORDER BY created_at DESC LIMIT 100').all();
 return (x.results||[]).map(publicView);
}
export async function registerVideoJob(db,input,env,now=new Date()){
 if(!videoQueueReady(env))throw Error('video_queue_disabled');
 if(!await videoTablesReady(db))throw Error('video_schema_unavailable');
 const a=validateVideoJob(input,env,now.getTime()),id=crypto.randomUUID(),stamp=now.toISOString();
 const [r]=await db.batch([
  db.prepare("INSERT OR IGNORE INTO video_jobs(id,campaign_id,platform,title,caption,asset_ref,video_url,privacy_level,ai_generated,run_at_utc,status,phase,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'queued','waiting_schedule',?,?)")
    .bind(id,a.campaignId,a.platform,a.title,a.caption,a.assetRef,a.videoUrl,a.privacy,a.isAigc?1:0,a.runAtUTC,stamp,stamp),
  db.prepare("INSERT INTO video_job_events(job_id,event,detail,created_at) SELECT ?,'queued','APPROVED_VIDEO_RESERVATION',? WHERE EXISTS(SELECT 1 FROM video_jobs WHERE id=?)").bind(id,stamp,id)
 ]);
 if(r.meta?.changes)return {id,status:'queued',liveReady:videoDispatchReady(env,a.platform),created:true};
 const existing=await db.prepare("SELECT id,platform,title,caption,asset_ref,video_url,privacy_level,ai_generated,run_at_utc,status FROM video_jobs WHERE campaign_id=? AND platform=?").bind(a.campaignId,a.platform).first();
 if(!existing)throw Error('video_duplicate_unknown');
 if(existing.title!==a.title||existing.caption!==a.caption||existing.asset_ref!==a.assetRef||existing.video_url!==a.videoUrl||existing.privacy_level!==a.privacy||existing.ai_generated!==(a.isAigc?1:0)||existing.run_at_utc!==a.runAtUTC)
  throw Error('video_campaign_conflict');
 return {id:existing.id,status:existing.status,created:false,liveReady:videoDispatchReady(env,a.platform)};
}
export async function cancelVideoJob(db,id,now=new Date()){
 if(!/^[a-f0-9-]{36}$/.test(id))throw Error('invalid_video_id');
 const at=now.toISOString();
 const [r]=await db.batch([
  db.prepare("UPDATE video_jobs SET status='cancelled',updated_at=? WHERE id=? AND status='queued'").bind(at,id),
  db.prepare("INSERT INTO video_job_events(job_id,event,detail,created_at) SELECT ?,'cancelled','owner_cancelled',? WHERE changes()=1").bind(id,at)
 ]);
 return Boolean(r.meta?.changes);
}
function payloadFrom(row){
 return {title:row.title,caption:row.caption,isAigc:Boolean(row.ai_generated),
  qaApproved:true,mediaApproved:true,assetRef:row.asset_ref,videoUrl:row.video_url,
  privacyStatus:row.privacy_level,privacyLevel:row.privacy_level,
  commentEnabled:false,duetEnabled:false,stitchEnabled:false};
}
async function transition(db,row,to,phase,receipt,now,from){
 const [r]=await db.batch([
  db.prepare("UPDATE video_jobs SET status=?,phase=?,provider_id=?,updated_at=?,last_error='' WHERE id=? AND status=?").bind(to,phase,receipt,now,row.id,from),
  db.prepare("INSERT INTO video_job_events(job_id,event,detail,created_at) SELECT ?,?,?,? WHERE changes()=1").bind(row.id,to,phase,now)
 ]);
 return Boolean(r.meta?.changes);
}
async function uncertain(db,row,now,from){
 await db.batch([
  db.prepare("UPDATE video_jobs SET status='needs_review',last_error='delivery_unconfirmed',updated_at=? WHERE id=? AND status=?").bind(now,row.id,from),
  db.prepare("INSERT INTO video_job_events(job_id,event,detail,created_at) SELECT ?,'needs_review','NO_AUTOMATIC_RETRY',? WHERE changes()=1").bind(row.id,now)
 ]);
}
export async function dispatchVideoDue(db,env,now,transport=fetch){
 if(!await videoTablesReady(db))return {queued:0,dispatched:0,blocked:'video_schema_unavailable'};
 if(env.LIVE_PUBLISHING_ENABLED!=='true'||env.VIDEO_LIVE_ENABLED!=='true'||env.VIDEO_DISPATCH_APPROVED!=='true')
  return {queued:0,dispatched:0,blocked:'live_dispatch_disabled'};
 const due=await db.prepare("SELECT * FROM video_jobs WHERE status='queued' AND run_at_utc<=? ORDER BY run_at_utc LIMIT 3").bind(now).all();
 let dispatched=0;
 for(const row of due.results||[]){
  if(!videoDispatchReady(env,row.platform))continue;
  const [claim]=await db.batch([
   db.prepare("UPDATE video_jobs SET status='dispatching',attempts=attempts+1,updated_at=? WHERE id=? AND status='queued' AND run_at_utc<=?").bind(now,row.id,now),
   db.prepare("INSERT INTO video_job_events(job_id,event,detail,created_at) SELECT ?,'dispatching','OFFICIAL_VIDEO_API',? WHERE changes()=1").bind(row.id,now)
  ]);
  if(!claim.meta?.changes)continue;
  dispatched++;
  try{
   const job=payloadFrom(row);
   let result,phase,state;
   if(row.platform==='instagram'){
    result=await createInstagramReel(job,env,transport);phase='instagram_container';state='processing';
    await transition(db,row,state,phase,result.containerId,now,'dispatching');
   }else if(row.platform==='tiktok'){
    result=await submitTikTokVideo(job,env,transport);phase='tiktok_status';state='processing';
    await transition(db,row,state,phase,result.publishId,now,'dispatching');
   }else{
    result=await uploadYoutubeVideo(job,env,transport);phase='youtube_processing';state='processing';
    await transition(db,row,state,phase,result.providerId,now,'dispatching');
   }
  }catch(e){
   // One POST may have reached the provider; do not retry automatically.
   await uncertain(db,row,now,'dispatching');
  }
 }
 return {dispatched,blocked:null};
}
async function markVerified(db,row,status,phase,verifiedId,now){
 const [changed]=await db.batch([
  db.prepare("UPDATE video_jobs SET status=?,phase=?,published_id=?,last_error='',updated_at=? WHERE id=? AND status=?")
    .bind(status,phase,verifiedId||row.published_id||'',now,row.id,row.status),
  db.prepare("INSERT INTO video_job_events(job_id,event,detail,created_at) SELECT ?,?,?,? WHERE changes()=1")
    .bind(row.id,status,phase,now)
 ]);
 return Boolean(changed.meta?.changes);
}
export async function reconcileVideoPending(db,env,now,transport=fetch){
 if(!await videoTablesReady(db))return {checked:0,blocked:'video_schema_unavailable'};
 if(env.LIVE_PUBLISHING_ENABLED!=='true'||env.VIDEO_LIVE_ENABLED!=='true'||env.VIDEO_DISPATCH_APPROVED!=='true')
  return {checked:0,blocked:'live_dispatch_disabled'};
 // The deadline never initiates another POST. It only requests manual review.
 const exhausted=await db.prepare("SELECT * FROM video_jobs WHERE status IN ('processing','submitted') AND check_attempts>=288 ORDER BY updated_at LIMIT 5").all();
 for(const row of exhausted.results||[])await uncertain(db,row,now,row.status);

 const open=await db.prepare("SELECT * FROM video_jobs WHERE status IN ('processing','submitted') AND (next_check_utc='' OR next_check_utc<=?) ORDER BY updated_at LIMIT 5").bind(now).all();
 let checked=0;
 for(const row of open.results||[]){
  if(!videoDispatchReady(env,row.platform))continue;
  // Rate limit: any provider read error is deferred. Reads are safe to retry.
  const next=new Date(Date.parse(now)+5*60000).toISOString().slice(0,19)+'Z';
  const [claim]=await db.batch([
   db.prepare("UPDATE video_jobs SET next_check_utc=?,check_attempts=check_attempts+1,updated_at=? WHERE id=? AND status=? AND (next_check_utc='' OR next_check_utc<=?) AND check_attempts<288").bind(next,now,row.id,row.status,now),
   db.prepare("INSERT INTO video_job_events(job_id,event,detail,created_at) SELECT ?,'checking','read_only_status_poll',? WHERE changes()=1").bind(row.id,now)
  ]);
  if(!claim.meta?.changes)continue;
  checked++;
  try{
   let result;
   if(row.phase==='instagram_container'){
    result=await instagramContainerStatus(row.provider_id,env,transport);
    if(result.failed){await uncertain(db,row,now,'processing');continue}
    if(result.ready){
     // Transition BEFORE media_publish: prevents duplicate publish after crash.
     const safe=await transition(db,row,'finalizing','instagram_media_publish',row.provider_id,now,'processing');
     if(!safe)continue;
     try{
      const result2=await publishInstagramReadyReel(payloadFrom(row),row.provider_id,env,transport);
      if(result2.status==='SUBMITTED'){
       await db.batch([
        db.prepare("UPDATE video_jobs SET status='submitted',phase='instagram_verification',published_id=?,updated_at=?,next_check_utc='' WHERE id=? AND status='finalizing'").bind(result2.providerId,now,row.id),
        db.prepare("INSERT INTO video_job_events(job_id,event,detail,created_at) SELECT ?,'submitted','instagram_media_receipt',? WHERE changes()=1").bind(row.id,now)
       ]);
      }else await uncertain(db,row,now,'finalizing');
     }catch{await uncertain(db,row,now,'finalizing')}
    }
   }else if(row.phase==='instagram_verification'){
    result=await instagramPublishedMediaStatus(row.published_id,env,transport);
    if(result.verified)await markVerified(db,row,'published','verified_instagram',row.published_id,now);
   }else if(row.phase==='tiktok_status'){
    result=await tiktokVideoStatus(row.provider_id,env,transport);
    if(result.published)await markVerified(db,row,row.privacy_level==='PUBLIC_TO_EVERYONE'?'published':'verified_nonpublic',
      'verified_tiktok',result.providerIds?.[0]||'',now);
    else if(result.failed)await uncertain(db,row,now,'processing');
   }else if(row.phase==='youtube_processing'){
    result=await youtubeVideoStatus(row.provider_id,env,transport);
    if(result.rejected)await uncertain(db,row,now,'processing');
    else if(result.processed)await markVerified(db,row,result.privacyStatus==='public'?'published':'verified_nonpublic','verified_youtube',row.provider_id,now);
   }
  }catch{
   // Read-only polling fails temporarily; allow a later poll, NEVER resend POST.
  }
 }
 return {checked,blocked:null};
}

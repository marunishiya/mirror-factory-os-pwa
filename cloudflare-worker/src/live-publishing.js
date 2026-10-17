// Isolated live posting coordinator for PROJECT MIRROR (no Metricool).
// Fail-closed: never post until LIVE_PUBLISHING_ENABLED='true' and the relevant
// platform credentials are configured. All uncertain deliveries need human review.
import {credentialsReady,publishText} from './platforms.js';

export const LIVE_CHANNELS=['bluesky','mastodon'];

export function liveAuthorized(env,platform){
 return env.LIVE_PUBLISHING_ENABLED==='true'&&LIVE_CHANNELS.includes(platform)&&credentialsReady(platform,env);
}
export function validateLive(payload){
 if(!payload||payload.mode!=='live'||payload.qaApproved!==true)throw Error('manual_qa_required');
 if(!LIVE_CHANNELS.includes(payload.platform))throw Error('live_platform_unavailable');
 if(typeof payload.caption!=='string'||!payload.caption.trim())throw Error('invalid_caption');
 if(payload.assetRef)throw Error('live_media_not_supported');
 if(typeof payload.campaignId!=='string'||!/^[a-zA-Z0-9_-]{6,80}$/.test(payload.campaignId))throw Error('campaign_id_required');
 if(typeof payload.title!=='string'||!payload.title.trim()||payload.title.length>150)throw Error('invalid_title');
 if(typeof payload.runAtUTC!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(payload.runAtUTC)||
    Number.isNaN(Date.parse(payload.runAtUTC))||new Date(payload.runAtUTC).toISOString()!==payload.runAtUTC.replace('Z','.000Z'))
   throw Error('invalid_utc_time');
 if(Date.parse(payload.runAtUTC)<Date.now()-30000)throw Error('scheduled_time_in_past');
 const count=Array.from(new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(payload.caption.trim())).length;
 if(count>(payload.platform==='bluesky'?300:500))throw Error('post_too_long');
 return {platform:payload.platform,title:payload.title.trim(),caption:payload.caption.trim(),runAtUTC:payload.runAtUTC,campaignId:payload.campaignId};
}

// For a confirmed external delivery, write provider receipt and published state.
// A DB write failure AFTER the HTTP request leaves 'dispatching' and requires
// manual reconciliation. Never retry automatically: it could duplicate a post.
export async function processLiveDue(db,env,utcNow,transport=fetch){
 if(env.LIVE_PUBLISHING_ENABLED!=='true')return {sent:0,review:0,blocked:true};
 const results=await db.prepare("SELECT id,platform,caption,asset_ref FROM jobs WHERE status='queued' AND mode='live' AND run_at_utc<=? ORDER BY run_at_utc LIMIT 5").bind(utcNow).all();
 let sent=0,review=0;
 for(const row of results.results||[]){
  if(!liveAuthorized(env,row.platform))continue;
  const [claim]=await db.batch([
   db.prepare("UPDATE jobs SET status='dispatching',attempts=attempts+1,updated_at=? WHERE id=? AND status='queued' AND mode='live' AND run_at_utc<=?").bind(utcNow,row.id,utcNow),
   db.prepare("INSERT INTO job_events(job_id,event,detail,created_at) SELECT ?,?,?,? WHERE changes()=1").bind(row.id,'dispatching','official_api_attempt',utcNow)
  ]);
  if(!claim.meta?.changes)continue;
  try{
   const published=await publishText(row,env,transport);
   await db.batch([
    db.prepare("UPDATE jobs SET status='published',last_error='',updated_at=? WHERE id=? AND status='dispatching'").bind(utcNow,row.id),
    db.prepare("INSERT INTO job_events(job_id,event,detail,created_at) SELECT ?,?,?,? WHERE changes()=1").bind(row.id,'published',published.providerId,utcNow)
   ]);
   sent++;
  }catch(e){
   // Never log API responses, access tokens, app passwords, or post text.
   await db.batch([
    db.prepare("UPDATE jobs SET status='needs_review',last_error='delivery_unconfirmed',updated_at=? WHERE id=? AND status='dispatching'").bind(utcNow,row.id),
    db.prepare("INSERT INTO job_events(job_id,event,detail,created_at) SELECT ?,?,?,? WHERE changes()=1").bind(row.id,'needs_review','delivery_unconfirmed; do not auto-retry',utcNow)
   ]);
   review++;
  }
 }
 return {sent,review,blocked:false};
}

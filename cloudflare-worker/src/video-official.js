/**
 * PROJECT MIRROR official video API adapters — no Metricool or reposting relay.
 *
 * Intentionally NOT called by the production scheduler yet. Separate
 * ENABLE+approval gates block real traffic until OAuth, video storage, user
 * consent, D1 state machine, production-schema QA, and app audits are ready.
 * These helpers return SUBMITTED/PROCESSING, NEVER claim a publish succeeded
 * based only on an upload or container creation.
 */
function safeError(provider,code){return new Error(provider+'_'+code)}
function ensureEnabled(env){
 if(env.LIVE_PUBLISHING_ENABLED!=='true'||env.VIDEO_LIVE_ENABLED!=='true')throw Error('video_publishing_disabled');
}
function required(v,code){if(typeof v!=='string'||!v.trim())throw Error(code);return v.trim()}
async function jsonResponse(response,name){
 if(!response?.ok)throw safeError(name,'http_'+(response?.status||'unknown'));
 try{return await response.json()}catch{throw safeError(name,'invalid_json')}
}
function approvedJob(job){
 if(!job||job.qaApproved!==true||job.mediaApproved!==true)throw Error('video_qa_and_media_approval_required');
 required(job.title,'video_title_required');required(job.caption,'video_caption_required');
 if(job.isAigc!==true&&job.isAigc!==false)throw Error('video_ai_disclosure_required');
}
export function verifiedVideoUrl(raw,env){
 const prefix=required(env.VIDEO_PUBLIC_PREFIX,'video_verified_prefix_not_configured');
 let u,p;
 try{u=new URL(raw);p=new URL(prefix)}catch{throw Error('invalid_video_url')}
 if(p.protocol!=='https:'||p.username||p.password||p.port||p.search||p.hash||!p.pathname.endsWith('/'))
  throw Error('invalid_video_verified_prefix');
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||
    u.hostname!==p.hostname||!u.pathname.startsWith(p.pathname)||u.pathname===p.pathname||!u.pathname.toLowerCase().endsWith('.mp4'))
  throw Error('video_outside_verified_prefix');
 // No query strings, redirects or arbitrary host fetches. Asset hosting must be
 // independently verified with TikTok and reachable by Meta.
 return u.href;
}
function videoUrl(job,env){approvedJob(job);return verifiedVideoUrl(job.videoUrl,env)}
function igSettings(env){
 ensureEnabled(env);
 required(env.INSTAGRAM_ACCESS_TOKEN,'instagram_credentials_missing');
 if(!/^\d{6,25}$/.test(String(env.INSTAGRAM_IG_USER_ID||'')))throw Error('instagram_id_missing');
 const ver=required(env.INSTAGRAM_GRAPH_VERSION,'instagram_api_version_missing');
 if(!/^v\d{1,2}\.\d{1,2}$/.test(ver))throw Error('instagram_invalid_version');
 return {base:'https://graph.facebook.com/'+ver,igId:env.INSTAGRAM_IG_USER_ID,token:env.INSTAGRAM_ACCESS_TOKEN};
}
export async function createInstagramReel(job,env,transport=fetch){
 const cfg=igSettings(env),url=videoUrl(job,env);
 const body=new URLSearchParams({media_type:'REELS',video_url:url,caption:job.caption,share_to_feed:'true'});
 const data=await jsonResponse(await transport(cfg.base+'/'+cfg.igId+'/media',{method:'POST',
   headers:{Authorization:'Bearer '+cfg.token,'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()}),'instagram');
 if(!/^\d+$/.test(String(data.id||'')))throw Error('instagram_invalid_container');
 return {status:'PROCESSING',containerId:String(data.id)};
}
export async function instagramContainerStatus(containerId,env,transport=fetch){
 const cfg=igSettings(env);
 if(!/^\d+$/.test(String(containerId||'')))throw Error('instagram_invalid_container');
 const endpoint=cfg.base+'/'+containerId+'?fields=status_code';
 const data=await jsonResponse(await transport(endpoint,{headers:{Authorization:'Bearer '+cfg.token}}),'instagram');
 const status=String(data.status_code||'UNKNOWN');
 return {status,ready:status==='FINISHED',failed:['ERROR','EXPIRED'].includes(status)};
}
export async function publishInstagramReadyReel(job,containerId,env,transport=fetch){
 approvedJob(job);
 const cfg=igSettings(env),state=await instagramContainerStatus(containerId,env,transport);
 if(!state.ready)return {status:state.failed?'FAILED':'PROCESSING',containerId};
 const body=new URLSearchParams({creation_id:containerId});
 const data=await jsonResponse(await transport(cfg.base+'/'+cfg.igId+'/media_publish',{method:'POST',
   headers:{Authorization:'Bearer '+cfg.token,'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()}),'instagram');
 if(!/^\d+$/.test(String(data.id||'')))throw Error('instagram_invalid_media_receipt');
 return {status:'SUBMITTED',providerId:String(data.id),note:'Media publishing ID returned; verify the post separately'};
}
const TIKTOK='https://open.tiktokapis.com/v2/post/publish';
function tiktokToken(env){ensureEnabled(env);return required(env.TIKTOK_USER_ACCESS_TOKEN,'tiktok_credentials_missing')}
async function tiktokPost(url,payload,env,transport){
 const token=tiktokToken(env);
 const response=await jsonResponse(await transport(url,{method:'POST',headers:{
  Authorization:'Bearer '+token,'Content-Type':'application/json; charset=UTF-8'
 },body:JSON.stringify(payload)}),'tiktok');
 if(response.error?.code!=='ok')throw Error('tiktok_api_'+String(response.error?.code||'unknown').replace(/[^a-z0-9_]/gi,'').slice(0,80));
 return response.data||{};
}
export async function tiktokCreatorInfo(env,transport=fetch){
 const data=await tiktokPost(TIKTOK+'/creator_info/query/',{},env,transport);
 if(!Array.isArray(data.privacy_level_options))throw Error('tiktok_privacy_options_missing');
 return {privacyOptions:data.privacy_level_options,commentsDisabled:Boolean(data.comment_disabled),
   duetsDisabled:Boolean(data.duet_disabled),stitchesDisabled:Boolean(data.stitch_disabled)};
}
export async function submitTikTokVideo(job,env,transport=fetch){
 const url=videoUrl(job,env);
 // Creator info must be queried before every Direct Post, including displaying
 // privacy choices in the future UX. Require a choice explicitly approved for
 // this particular posting: never guess PUBLIC_TO_EVERYONE.
 const creator=await tiktokCreatorInfo(env,transport);
 const privacy=required(job.privacyLevel,'tiktok_privacy_choice_required');
 if(!creator.privacyOptions.includes(privacy))throw Error('tiktok_privacy_choice_unavailable');
 if(job.duetEnabled&&creator.duetsDisabled)throw Error('tiktok_duet_unavailable');
 if(job.commentEnabled&&creator.commentsDisabled)throw Error('tiktok_comments_unavailable');
 if(job.stitchEnabled&&creator.stitchesDisabled)throw Error('tiktok_stitches_unavailable');
 const result=await tiktokPost(TIKTOK+'/video/init/',{
  post_info:{title:job.caption,privacy_level:privacy,is_aigc:job.isAigc,
   disable_comment:!job.commentEnabled,disable_duet:!job.duetEnabled,disable_stitch:!job.stitchEnabled},
  source_info:{source:'PULL_FROM_URL',video_url:url}
 },env,transport);
 const id=String(result.publish_id||'');
 if(!id||id.length>64)throw Error('tiktok_invalid_publish_id');
 return {status:'PROCESSING',publishId:id};
}
export async function tiktokVideoStatus(publishId,env,transport=fetch){
 if(typeof publishId!=='string'||!publishId||publishId.length>64)throw Error('tiktok_invalid_publish_id');
 const data=await tiktokPost(TIKTOK+'/status/fetch/',{publish_id:publishId},env,transport);
 const status=String(data.status||'UNKNOWN');
 const published=status==='PUBLISH_COMPLETE',failed=status==='FAILED';
 return {status,published,failed,providerIds:published&&Array.isArray(data.publicaly_available_post_id)?
  data.publicaly_available_post_id.map(String):[],
  note:'PUBLISH_COMPLETE means TikTok reports publication; public visibility may depend on moderation'};
}
const GOOGLE_TOKEN='https://oauth2.googleapis.com/token';
async function googleAccessToken(env,transport){
 ensureEnabled(env);
 const client=required(env.GOOGLE_CLIENT_ID,'youtube_oauth_missing');
 const secret=required(env.GOOGLE_CLIENT_SECRET,'youtube_oauth_missing');
 const refresh=required(env.YOUTUBE_REFRESH_TOKEN,'youtube_oauth_missing');
 const response=await jsonResponse(await transport(GOOGLE_TOKEN,{method:'POST',headers:{
  'Content-Type':'application/x-www-form-urlencoded'
 },body:new URLSearchParams({client_id:client,client_secret:secret,refresh_token:refresh,grant_type:'refresh_token'}).toString()}),'youtube');
 return required(response.access_token,'youtube_token_refresh_failed');
}
export function approvedR2Key(raw){
 if(typeof raw!=='string'||!/^approved-videos\/[a-zA-Z0-9][a-zA-Z0-9_/-]{0,180}\.mp4$/.test(raw)||raw.includes('..')||raw.includes('//'))
  throw Error('video_r2_key_not_approved');
 return raw;
}
function youtubeSessionUrl(s){
 let u;try{u=new URL(s)}catch{throw Error('youtube_upload_session_invalid')}
 if(u.protocol!=='https:'||u.username||u.password||u.hostname!=='www.googleapis.com'||u.port||
    !u.pathname.startsWith('/upload/youtube/v3/videos'))throw Error('youtube_upload_session_invalid');
 return u.href;
}
export async function uploadYoutubeVideo(job,env,transport=fetch){
 approvedJob(job);ensureEnabled(env);
 // The media is supplied exclusively from the owner's explicitly approved R2
 // path — no fetching arbitrary HTTPS URLs or exposing unpublished MASTERs.
 const key=approvedR2Key(job.assetRef);
 if(!env.VIDEO_R2?.get)throw Error('video_r2_binding_missing');
 const privacy=job.privacyStatus||'private';
 if(!['private','unlisted','public'].includes(privacy))throw Error('youtube_invalid_privacy');
 if(privacy==='public'&&env.YOUTUBE_PUBLIC_ALLOWED!=='true')throw Error('youtube_public_not_approved');
 const object=await env.VIDEO_R2.get(key);
 if(!object?.body||!Number.isSafeInteger(object.size)||object.size<=0)throw Error('video_asset_missing');
 // A pilot safeguard against large runtime transfers. Multi-chunk resumable
 // sessions are a separate milestone; do not retry an ambiguous upload.
 if(object.size>50*1024*1024)throw Error('video_exceeds_pilot_limit');
 if(object.httpMetadata?.contentType&&object.httpMetadata.contentType!=='video/mp4')throw Error('video_invalid_mime');
 const token=await googleAccessToken(env,transport);
 const start=await transport('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{
   method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json; charset=UTF-8',
    'X-Upload-Content-Length':String(object.size),'X-Upload-Content-Type':'video/mp4'},
   body:JSON.stringify({snippet:{title:job.title,description:job.caption,categoryId:'1'},
     status:{privacyStatus:privacy,selfDeclaredMadeForKids:false}})
 });
 if(!start.ok)throw safeError('youtube','session_http_'+start.status);
 const uploadUrl=youtubeSessionUrl(start.headers.get('location'));
 const uploaded=await transport(uploadUrl,{
  method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'video/mp4',
   'Content-Length':String(object.size)},body:object.body,duplex:'half'
 });
 if(uploaded.status===308)throw Error('youtube_upload_incomplete_requires_reconciliation');
 const result=await jsonResponse(uploaded,'youtube');
 if(!/^[a-zA-Z0-9_-]{6,32}$/.test(String(result.id||'')))throw Error('youtube_invalid_video_receipt');
 return {status:'SUBMITTED',providerId:String(result.id),privacy,
  note:'YouTube accepted the video; confirm processing and live visibility separately'};
}

/**
 * No external calls. Shows installation prerequisites, not account connection.
 * "ready" is intentionally NOT returned: tokens being present do not prove
 * OAuth scopes, app audit, successful upload, or delivery.
 */
export function videoReadiness(env={}){
 const switchOn=env.LIVE_PUBLISHING_ENABLED==='true'&&env.VIDEO_LIVE_ENABLED==='true';
 const prefix=typeof env.VIDEO_PUBLIC_PREFIX==='string'&&env.VIDEO_PUBLIC_PREFIX.startsWith('https://')&&
  env.VIDEO_PUBLIC_PREFIX.endsWith('/');
 const report=(requirements)=>({
  configured:requirements.every(([_,ok])=>Boolean(ok)),
  missing:requirements.filter(([_,ok])=>!ok).map(([k])=>k),
  connected:false,publishingVerified:false
 });
 return {
  videoPublishingSwitchOn:switchOn,
  note:'Configured does NOT mean authenticated, app-audited, deployed or published.',
  youtube:report([
   ['live_approval',switchOn],['google_oauth_client',env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET],
   ['youtube_refresh_token',env.YOUTUBE_REFRESH_TOKEN],['video_r2_binding',env.VIDEO_R2?.get],
   ['youtube_public_audit_confirmed',env.YOUTUBE_PUBLIC_AUDIT_CONFIRMED==='true']
  ]),
  instagram:report([
   ['live_approval',switchOn],['instagram_access_token',env.INSTAGRAM_ACCESS_TOKEN],
   ['instagram_professional_account_id',/^\d{6,25}$/.test(String(env.INSTAGRAM_IG_USER_ID||''))],
   ['graph_api_version',/^v\d+\.\d+$/.test(String(env.INSTAGRAM_GRAPH_VERSION||''))],
   ['public_video_prefix',prefix],['instagram_permissions_confirmed',env.INSTAGRAM_CONTENT_PUBLISH_SCOPE_CONFIRMED==='true']
  ]),
  tiktok:report([
   ['live_approval',switchOn],['tiktok_user_access_token',env.TIKTOK_USER_ACCESS_TOKEN],
   ['public_video_prefix',prefix],['tiktok_domain_verified',env.TIKTOK_DOMAIN_VERIFIED==='true'],
   ['tiktok_app_audited',env.TIKTOK_APP_AUDITED==='true'],
   ['tiktok_publish_scope_confirmed',env.TIKTOK_VIDEO_PUBLISH_SCOPE_CONFIRMED==='true']
  ])
 };
}

/** Read-only publication checks. All publication receipts require independent verification. */
export async function instagramPublishedMediaStatus(mediaId,env,transport=fetch){
 const cfg=igSettings(env);
 if(!/^\d+$/.test(String(mediaId||'')))throw Error('instagram_invalid_media_receipt');
 const response=await jsonResponse(await transport(cfg.base+'/'+mediaId+'?fields=id,permalink,media_type,timestamp',{
  method:'GET',headers:{Authorization:'Bearer '+cfg.token}
 }),'instagram');
 return {verified:String(response.id||'')===String(mediaId)&&typeof response.permalink==='string'&&response.permalink.startsWith('https://'),
  permalink:typeof response.permalink==='string'&&response.permalink.startsWith('https://')?response.permalink:null};
}
export async function youtubeVideoStatus(videoId,env,transport=fetch){
 if(!/^[a-zA-Z0-9_-]{6,32}$/.test(String(videoId||'')))throw Error('youtube_invalid_video_receipt');
 const token=await googleAccessToken(env,transport);
 const url='https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id='+encodeURIComponent(videoId);
 const result=await jsonResponse(await transport(url,{method:'GET',headers:{Authorization:'Bearer '+token}}),'youtube');
 const video=Array.isArray(result.items)?result.items.find(v=>v.id===videoId):null;
 if(!video)return {processed:false,rejected:false,missing:true,privacyStatus:'unknown'};
 const upload=video.status?.uploadStatus||'unknown';
 const processing=video.processingDetails?.processingStatus||'unknown';
 const rejected=['rejected','failed','deleted'].includes(upload)||['failed','terminated'].includes(processing);
 const processed=upload==='processed'&&['succeeded','unknown'].includes(processing);
 return {processed,rejected,privacyStatus:video.status?.privacyStatus||'unknown'};
}

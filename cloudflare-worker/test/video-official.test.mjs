import assert from 'node:assert/strict';
import {
 verifiedVideoUrl,approvedR2Key,createInstagramReel,instagramContainerStatus,publishInstagramReadyReel,
 tiktokCreatorInfo,submitTikTokVideo,tiktokVideoStatus,uploadYoutubeVideo
} from '../src/video-official.js';

const base={LIVE_PUBLISHING_ENABLED:'true',VIDEO_LIVE_ENABLED:'true',VIDEO_PUBLIC_PREFIX:'https://media.example.com/approved/'};
const job={qaApproved:true,mediaApproved:true,isAigc:true,title:'MIRROR short QA',
 caption:'PROJECT MIRROR 公式API接続確認',videoUrl:'https://media.example.com/approved/test.mp4',
 assetRef:'approved-videos/test.mp4',privacyLevel:'SELF_ONLY',commentEnabled:false,duetEnabled:false,stitchEnabled:false};
const ig={...base,INSTAGRAM_ACCESS_TOKEN:'mock_ig_token',INSTAGRAM_IG_USER_ID:'17841400000000000',INSTAGRAM_GRAPH_VERSION:'v24.0'};
const tiktok={...base,TIKTOK_USER_ACCESS_TOKEN:'mock_tiktok_token'};
const yt={...base,GOOGLE_CLIENT_ID:'test_client',GOOGLE_CLIENT_SECRET:'test_secret',YOUTUBE_REFRESH_TOKEN:'test_refresh',
 VIDEO_R2:{async get(){return {size:3,body:new Response('MP4').body,httpMetadata:{contentType:'video/mp4'}}}}};
let n=0;
async function check(name,fn){try{await fn();n++;console.log('PASS video',name)}catch(e){console.error('FAIL video',name,e);process.exitCode=1}}
const json=(data,status=200)=>Response.json(data,{status});
await check('media URL requires project-verified HTTPS path',async()=>{
 assert.equal(verifiedVideoUrl(job.videoUrl,base),job.videoUrl);
 for(const value of ['http://media.example.com/approved/test.mp4',
  'https://media.example.com.evil.invalid/approved/test.mp4',
  'https://media.example.com/other/test.mp4',
  'https://media.example.com/approved/test.mp4?signature=x',
  'https://user:pass@media.example.com/approved/test.mp4',
  'https://media.example.com/approved/not_video.txt']){
   assert.throws(()=>verifiedVideoUrl(value,base));
 }
});
await check('video upload cannot use unapproved source key',async()=>{
 assert.equal(approvedR2Key('approved-videos/test.mp4'),'approved-videos/test.mp4');
 for(const x of ['masters/private.mp4','approved-videos/../private.mp4','approved-videos/test.txt']){
  assert.throws(()=>approvedR2Key(x));
 }
});
await check('default OFF blocks all video official API operations',async()=>{
 let calls=0;const no={...ig,VIDEO_LIVE_ENABLED:'false'};
 await assert.rejects(createInstagramReel(job,no,async()=>{calls++;throw Error('bad')}),/disabled/);
 await assert.rejects(submitTikTokVideo(job,{...tiktok,VIDEO_LIVE_ENABLED:'false'},async()=>{calls++;throw Error('bad')}),/disabled/);
 await assert.rejects(uploadYoutubeVideo(job,{...yt,VIDEO_LIVE_ENABLED:'false'},async()=>{calls++;throw Error('bad')}),/disabled/);
 assert.equal(calls,0);
});
await check('must approve both post content and video asset',async()=>{
 await assert.rejects(createInstagramReel({...job,mediaApproved:false},ig,()=>{throw Error('bad')}),/media_approval_required/);
 await assert.rejects(submitTikTokVideo({...job,qaApproved:false},tiktok,()=>{throw Error('bad')}),/media_approval_required/);
 await assert.rejects(uploadYoutubeVideo({...job,isAigc:undefined},yt,()=>{throw Error('bad')}),/ai_disclosure_required/);
});
await check('Instagram creates a reel container and does not publish immediately',async()=>{
 let calls=[];
 const out=await createInstagramReel(job,ig,async(url,init)=>{calls.push({url,init});return json({id:'18270815569115548'})});
 assert.equal(out.status,'PROCESSING');assert.equal(calls.length,1);assert.match(calls[0].url,/\/media$/);
 assert.match(calls[0].init.body,/media_type=REELS/);assert.match(calls[0].init.body,/video_url=https%3A/);
});
await check('Instagram container processing blocks final media_publish',async()=>{
 let calls=0;
 const state=await publishInstagramReadyReel(job,'18270815569115548',ig,async()=>{
  calls++;return json({status_code:'IN_PROGRESS'});
 });
 assert.equal(calls,1);assert.equal(state.status,'PROCESSING');
});
await check('Instagram media_publish only after FINISHED',async()=>{
 const calls=[];
 const out=await publishInstagramReadyReel(job,'18270815569115548',ig,async(url,init)=>{
  calls.push({url,init});
  return url.includes('fields=')?json({status_code:'FINISHED'}):json({id:'1800000000'});
 });
 assert.equal(out.status,'SUBMITTED');assert.equal(out.providerId,'1800000000');
 assert.equal(calls.length,2);assert.match(calls[1].url,/\/media_publish$/);
 assert.match(calls[1].init.body,/creation_id=18270815569115548/);
});
await check('Instagram ERROR/EXPIRED does not publish',async()=>{
 for(const status of ['ERROR','EXPIRED']){
  let calls=0;
  const state=await publishInstagramReadyReel(job,'18270815569115548',ig,async()=>{
   calls++;return json({status_code:status});
  });
  assert.equal(calls,1);assert.equal(state.status,'FAILED');
 }
});
await check('Instagram prevents invalid account IDs',async()=>{
 await assert.rejects(createInstagramReel(job,{...ig,INSTAGRAM_IG_USER_ID:'123?x'},()=>{throw Error('bad')}),/instagram_id_missing/);
});
await check('TikTok creator info is requested through official endpoint',async()=>{
 let calls=[];
 const creator=await tiktokCreatorInfo(tiktok,async(url,init)=>{calls.push({url,init});return json({
  data:{privacy_level_options:['SELF_ONLY'],comment_disabled:true},error:{code:'ok'}
 })});
 assert.deepEqual(creator.privacyOptions,['SELF_ONLY']);assert.equal(calls.length,1);
 assert.match(calls[0].url,/creator_info\/query/);
});
await check('TikTok API never initializes without creator privacy choice',async()=>{
 let calls=0;
 await assert.rejects(submitTikTokVideo({...job,privacyLevel:'PUBLIC_TO_EVERYONE'},tiktok,async()=>{
  calls++;return json({data:{privacy_level_options:['SELF_ONLY']},error:{code:'ok'}});
 }),/tiktok_privacy_choice_unavailable/);
 assert.equal(calls,1);
});
await check('TikTok PULL_FROM_URL requires creator info and confirmed AI flag',async()=>{
 const calls=[];
 const result=await submitTikTokVideo(job,tiktok,async(url,init)=>{
  calls.push({url,body:JSON.parse(init.body)});
  if(url.includes('creator_info'))return json({data:{privacy_level_options:['SELF_ONLY']},error:{code:'ok'}});
  return json({data:{publish_id:'v_pub_url~v2.123'},error:{code:'ok'}});
 });
 assert.equal(result.status,'PROCESSING');assert.equal(calls.length,2);
 assert.equal(calls[1].body.source_info.source,'PULL_FROM_URL');
 assert.equal(calls[1].body.post_info.privacy_level,'SELF_ONLY');
 assert.equal(calls[1].body.post_info.is_aigc,true);
});
await check('TikTok non-ok body rejects even HTTP 200',async()=>{
 await assert.rejects(tiktokCreatorInfo(tiktok,async()=>json({error:{code:'scope_not_authorized'}})),/tiktok_api_scope_not_authorized/);
});
await check('TikTok download status is not successful publication',async()=>{
 const s=await tiktokVideoStatus('v_pub_url~v2.123',tiktok,async()=>json({
  data:{status:'PROCESSING_DOWNLOAD'},error:{code:'ok'}
 }));
 assert.equal(s.published,false);assert.equal(s.failed,false);
});
await check('TikTok PUBLISH_COMPLETE is confirmed distinct from PROCESSING',async()=>{
 const s=await tiktokVideoStatus('v_pub_url~v2.123',tiktok,async()=>json({
  data:{status:'PUBLISH_COMPLETE',publicaly_available_post_id:[123456789]},error:{code:'ok'}
 }));
 assert.equal(s.published,true);assert.deepEqual(s.providerIds,['123456789']);
});
await check('TikTok FAILED is not reported as posted',async()=>{
 const s=await tiktokVideoStatus('v_pub_url~v2.123',tiktok,async()=>json({
  data:{status:'FAILED',fail_reason:'file_format_check_failed'},error:{code:'ok'}
 }));
 assert.equal(s.failed,true);assert.equal(s.published,false);
});
await check('YouTube starts resumable upload with private default, no public post',async()=>{
 const calls=[];
 const transport=async(url,init)=>{
  calls.push({url,init});
  if(url.includes('oauth2'))return json({access_token:'mock_token'});
  if(init.method==='POST')return new Response(null,{status:200,headers:{
    location:'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=abc'
  }});
  return json({id:'v1dEo_ID00'},201);
 };
 const out=await uploadYoutubeVideo(job,yt,transport);
 assert.equal(out.status,'SUBMITTED');assert.equal(out.privacy,'private');assert.equal(out.providerId,'v1dEo_ID00');
 assert.equal(calls.length,3);
 const start=JSON.parse(calls[1].init.body);
 assert.equal(start.status.privacyStatus,'private');
 assert.equal(calls[2].init.method,'PUT');assert.equal(calls[2].init.headers['Content-Length'],'3');
});
await check('YouTube refuses public without explicit approval',async()=>{
 let calls=0;
 await assert.rejects(uploadYoutubeVideo({...job,privacyStatus:'public'},yt,async()=>{calls++;throw Error('bad')}),/youtube_public_not_approved/);
 assert.equal(calls,0);
});
await check('YouTube session URL cannot redirect upload to attacker',async()=>{
 const transport=async(url,init)=>{
  if(url.includes('oauth2'))return json({access_token:'mock'});
  if(init.method==='POST')return new Response(null,{status:200,headers:{location:'https://evil.invalid/steal'}});
  throw Error('unexpected PUT');
 };
 await assert.rejects(uploadYoutubeVideo(job,yt,transport),/upload_session_invalid/);
});
await check('YouTube 308 is unconfirmed upload not success',async()=>{
 const transport=async(url,init)=>{
  if(url.includes('oauth2'))return json({access_token:'mock'});
  if(init.method==='POST')return new Response(null,{status:200,headers:{location:'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=x'}});
  return new Response(null,{status:308});
 };
 await assert.rejects(uploadYoutubeVideo(job,yt,transport),/upload_incomplete_requires_reconciliation/);
});
await check('YouTube missing R2 binding is rejected before network',async()=>{
 let calls=0;
 await assert.rejects(uploadYoutubeVideo(job,{...yt,VIDEO_R2:undefined},async()=>{calls++;throw Error('bad')}),/r2_binding_missing/);
 assert.equal(calls,0);
});
await check('YouTube error after rejected Google refresh is not success',async()=>{
 await assert.rejects(uploadYoutubeVideo(job,yt,async()=>new Response('expired',{status:401})),/youtube_http_401/);
});
console.log('RESULT official video APIs '+n+'/22 PASS');
if(n!==22)process.exitCode=1;

import assert from 'node:assert/strict';
import {dispatchVideoDue,reconcileVideoPending,validateVideoJob,videoDispatchReady} from '../src/video-queue.js';
const now=new Date().toISOString().slice(0,19)+'Z';
const next=(offset)=>new Date(Date.now()+offset).toISOString().slice(0,19)+'Z';
const base={LIVE_PUBLISHING_ENABLED:'true',VIDEO_LIVE_ENABLED:'true',VIDEO_DISPATCH_APPROVED:'true',VIDEO_PUBLIC_PREFIX:'https://media.example.test/approved/'};
const ig={...base,INSTAGRAM_ACCESS_TOKEN:'fake_token',INSTAGRAM_IG_USER_ID:'1234567890',INSTAGRAM_GRAPH_VERSION:'v24.0',INSTAGRAM_CONTENT_PUBLISH_SCOPE_CONFIRMED:'true'};
const tt={...base,TIKTOK_USER_ACCESS_TOKEN:'fake_token',TIKTOK_APP_AUDITED:'true',TIKTOK_DOMAIN_VERIFIED:'true',TIKTOK_VIDEO_PUBLISH_SCOPE_CONFIRMED:'true'};
const yt={...base,GOOGLE_CLIENT_ID:'testid',GOOGLE_CLIENT_SECRET:'fake',YOUTUBE_REFRESH_TOKEN:'fake',VIDEO_R2:{async get(){return {size:4,body:new Response('MP4!').body,httpMetadata:{contentType:'video/mp4'}}}}};
const fixture=platform=>({id:'test-'+platform,campaign_id:'campaign_test01',platform,title:'QA',caption:'MIRROR',
 asset_ref:platform==='youtube'?'approved-videos/qa.mp4':'',
 video_url:platform==='youtube'?'':'https://media.example.test/approved/qa.mp4',
 privacy_level:platform==='youtube'?'private':platform==='tiktok'?'SELF_ONLY':'',
 ai_generated:1,run_at_utc:next(-100000),status:'queued',phase:'waiting_schedule',
 provider_id:'',published_id:'',attempts:0,check_attempts:0,next_check_utc:'',last_error:'',updated_at:now});
class DB {
 constructor(rows){this.rows=rows.map(x=>({...x}));this.events=[];this.serial=Promise.resolve();}
 prepare(sql){
  let args=[],db=this;
  return {
   bind(...a){args=a;return this},
   async first(){if(sql.includes('sqlite_master'))return {n:2};throw Error('unknown read '+sql)},
   async all(){
    if(sql.includes("status='queued'"))return {results:db.rows.filter(x=>x.status==='queued'&&x.run_at_utc<=args[0]).map(x=>({...x}))};
    if(sql.includes("check_attempts>=288"))return {results:db.rows.filter(x=>['processing','submitted'].includes(x.status)&&x.check_attempts>=288).map(x=>({...x}))};
    if(sql.includes("status IN ('processing','submitted')"))return {results:db.rows.filter(x=>['processing','submitted'].includes(x.status)&&(x.next_check_utc===''||x.next_check_utc<=args[0])).map(x=>({...x}))};
    throw Error('unknown list '+sql)
   },
   async run(changes){
    const row=()=>{
     const id=sql.includes("status='dispatching'")&&sql.includes('SET status=')?args[1]:
      sql.startsWith('UPDATE video_jobs SET status=?,')?args[4]:
      sql.includes("SET status='submitted'")?args[2]:
      sql.includes("SET status='needs_review'")?args[1]:
      sql.includes('SET next_check_utc=')?args[2]:null;
     return db.rows.find(x=>x.id===id);
    };
    if(sql.startsWith('INSERT INTO video_job_events')){
     if(!changes)return {meta:{changes:0}};
     db.events.push({event:args[1]||sql.match(/event,detail,created_at\) SELECT \?,'([^']+)'/)?.[1],detail:args[2]||'',job:args[0]});
     return {meta:{changes:1}};
    }
    const x=row();if(!x)return {meta:{changes:0}};
    if(sql.includes("SET status='dispatching'")){
     if(x.status!=='queued'||x.run_at_utc>args[2])return {meta:{changes:0}};
     x.status='dispatching';x.attempts++;x.updated_at=args[0];return {meta:{changes:1}}
    }
    if(sql.startsWith('UPDATE video_jobs SET status=?,phase=?')){
     if(x.status!==args[5])return {meta:{changes:0}};
     x.status=args[0];x.phase=args[1];x.provider_id=args[2];x.updated_at=args[3];return {meta:{changes:1}}
    }
    if(sql.includes("SET status='submitted'")){
     if(x.status!=='finalizing')return {meta:{changes:0}};
     x.status='submitted';x.phase='instagram_verification';x.published_id=args[0];x.next_check_utc='';return {meta:{changes:1}}
    }
    if(sql.includes("SET status='needs_review'")){
     if(x.status!==args[2])return {meta:{changes:0}};
     x.status='needs_review';x.last_error='delivery_unconfirmed';return {meta:{changes:1}}
    }
    if(sql.includes('SET next_check_utc=')){
     if(x.status!==args[3]||(x.next_check_utc&&x.next_check_utc>args[4]))return {meta:{changes:0}};
     x.next_check_utc=args[0];x.check_attempts++;return {meta:{changes:1}}
    }
    throw Error('unknown write '+sql);
   }
  }
 }
 async batch(q){
  const action=async()=>{let prior=0,out=[];for(const stmt of q){const res=await stmt.run(prior);prior=res.meta.changes;out.push(res)}return out};
  const promise=this.serial.then(action);this.serial=promise.catch(()=>{});return promise;
 }
}
let n=0;
async function check(name,fn){try{await fn();n++;console.log('PASS video queue',name)}catch(e){console.error('FAIL video queue',name,e);process.exitCode=1}}
await check('queue cannot publish without all explicit switches and scope flags',async()=>{
 assert.equal(videoDispatchReady({...ig,VIDEO_DISPATCH_APPROVED:'false'},'instagram'),false);
 assert.equal(videoDispatchReady({...tt,TIKTOK_APP_AUDITED:'false'},'tiktok'),false);
 assert.equal(videoDispatchReady({...yt,YOUTUBE_REFRESH_TOKEN:''},'youtube'),false);
});
await check('video reservation validates exact UTC and explicit approval',async()=>{
 const p={platform:'youtube',campaignId:'campaign_001',title:'QA',caption:'test',assetRef:'approved-videos/qa.mp4',
  privacyStatus:'private',isAigc:true,publishApproved:true,qaApproved:true,mediaApproved:true,runAtUTC:next(60000)};
 assert.equal(validateVideoJob(p,yt).platform,'youtube');
 assert.throws(()=>validateVideoJob({...p,mediaApproved:false},yt),/approval/);
 assert.throws(()=>validateVideoJob({...p,runAtUTC:'2030-01-01T00:00:00+09:00'},yt),/scheduled_time/);
});
await check('Instagram due reservation enters PROCESSING, one container only',async()=>{
 const db=new DB([fixture('instagram')]);let calls=0;
 const send=async(url)=>{calls++;assert.match(url,/\/media$/);return Response.json({id:'1234567890123456'})};
 const res=await dispatchVideoDue(db,ig,now,send);
 assert.equal(res.dispatched,1);assert.equal(calls,1);
 assert.equal(db.rows[0].status,'processing');assert.equal(db.rows[0].phase,'instagram_container');
 assert.equal(db.rows[0].provider_id,'1234567890123456');
 await dispatchVideoDue(db,ig,now,send);assert.equal(calls,1);
});
await check('Instagram FINISHED leads to single media_publish and later verification',async()=>{
 const db=new DB([fixture('instagram')]);let calls=[];
 await dispatchVideoDue(db,ig,now,async(url)=>Response.json({id:'1234567890123456'}));
 const transport=async(url,init)=>{
  calls.push(url);
  if(url.includes('fields=status_code'))return Response.json({status_code:'FINISHED'});
  if(url.includes('media_publish'))return Response.json({id:'1111111111111111'});
  if(url.includes('fields=id,permalink'))return Response.json({id:'1111111111111111',permalink:'https://instagram.com/p/example'});
  throw Error('unknown route '+url);
 };
 await reconcileVideoPending(db,ig,now,transport);
 assert.equal(db.rows[0].status,'submitted');assert.equal(db.rows[0].published_id,'1111111111111111');
 await reconcileVideoPending(db,ig,now,transport);
 assert.equal(db.rows[0].status,'published');
 assert.equal(calls.filter(x=>x.includes('media_publish')).length,1);
});
await check('TikTok submission remains processing, not success on publish ID',async()=>{
 const db=new DB([fixture('tiktok')]);let calls=0;
 const transport=async(url)=>{calls++;
  if(url.includes('creator_info'))return Response.json({error:{code:'ok'},data:{privacy_level_options:['SELF_ONLY']}});
  return Response.json({error:{code:'ok'},data:{publish_id:'pubid_123'}});
 };
 await dispatchVideoDue(db,tt,now,transport);
 assert.equal(calls,2);assert.equal(db.rows[0].status,'processing');
 assert.equal(db.rows[0].phase,'tiktok_status');
});
await check('TikTok verified completion becomes published, pending does not',async()=>{
 const db=new DB([{...fixture('tiktok'),status:'processing',phase:'tiktok_status',provider_id:'pubid_123'}]);
 await reconcileVideoPending(db,tt,now,async()=>Response.json({error:{code:'ok'},data:{status:'PROCESSING_DOWNLOAD'}}));
 assert.equal(db.rows[0].status,'processing');
 await reconcileVideoPending(db,tt,next(301000),async()=>Response.json({error:{code:'ok'},data:{status:'PUBLISH_COMPLETE',publicaly_available_post_id:['1234']}}));
 assert.equal(db.rows[0].status,'published');
});
await check('YouTube receipt is processing until read-only status confirms',async()=>{
 const db=new DB([fixture('youtube')]);let calls=0;
 const transport=async(url,init)=>{
  calls++;
  if(url.includes('oauth2'))return Response.json({access_token:'mock_access'});
  if(init.method==='POST')return new Response(null,{status:200,headers:{location:'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=xyz'}});
  return Response.json({id:'AbCdEf12345'});
 };
 await dispatchVideoDue(db,yt,now,transport);
 assert.equal(calls,3);assert.equal(db.rows[0].status,'processing');
 await reconcileVideoPending(db,yt,now,async(url)=>{
  if(url.includes('oauth2'))return Response.json({access_token:'mock_access'});
  return Response.json({items:[{id:'AbCdEf12345',status:{uploadStatus:'processed',privacyStatus:'private'},processingDetails:{processingStatus:'succeeded'}}]});
 });
 assert.equal(db.rows[0].status,'verified_nonpublic');
});
await check('uncertain provider error never triggers automatic second post',async()=>{
 const db=new DB([fixture('instagram')]);let calls=0;
 const fail=async()=>{calls++;throw Error('timeout')};
 await dispatchVideoDue(db,ig,now,fail);
 assert.equal(db.rows[0].status,'needs_review');assert.equal(calls,1);
 await dispatchVideoDue(db,ig,next(60000),fail);assert.equal(calls,1);
});
console.log('RESULT video queue orchestration '+n+'/8 PASS');if(n!==8)process.exitCode=1;

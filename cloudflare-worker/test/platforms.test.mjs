import assert from 'node:assert/strict';
import {publishText,credentialsReady} from '../src/platforms.js';
let count=0;
async function test(name,fn){try{await fn();count++;console.log('PASS',name)}catch(e){console.error('FAIL',name,e);process.exitCode=1}}
const job={id:'test-job-12',platform:'mastodon',caption:'PROJECT MIRROR — 安全なテスト投稿',asset_ref:''};
const mastodon={LIVE_PUBLISHING_ENABLED:'true',MASTODON_ACCESS_TOKEN:'unit_test_only',MASTODON_BASE_URL:'https://mastodon.social'};
const bsky={LIVE_PUBLISHING_ENABLED:'true',BLUESKY_HANDLE:'test.bsky.social',BLUESKY_APP_PASSWORD:'unit_test_only'};
await test('publish locked by default',async()=>{
 await assert.rejects(publishText(job,{...mastodon,LIVE_PUBLISHING_ENABLED:'false'},()=>{throw Error('fetch must not run')}),/disabled/)
});
await test('no secret means no network',async()=>{
 await assert.rejects(publishText(job,{LIVE_PUBLISHING_ENABLED:'true'},()=>{throw Error('fetch must not run')}),/credentials_missing/)
});
await test('unsupported network never connects',async()=>{
 await assert.rejects(publishText({...job,platform:'youtube'},mastodon,()=>{throw Error('fetch must not run')}),/unsupported_live_platform/)
});
await test('media attachments not silently dropped',async()=>{
 await assert.rejects(publishText({...job,asset_ref:'asset.mp4'},mastodon,()=>{throw Error('fetch must not run')}),/media_not_implemented/)
});
await test('Mastodon uses OAuth bearer and idempotency header',async()=>{
 let calls=[];
 let res=await publishText(job,mastodon,async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({id:'12345'}),{status:200})});
 assert.equal(res.providerId,'12345');
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://mastodon.social/api/v1/statuses');
 assert.equal(calls[0].init.headers['Idempotency-Key'],job.id);
 assert.match(calls[0].init.body,/status=/);
});
await test('Mastodon host rejects HTTP and local addresses',async()=>{
 for(const addr of ['http://mastodon.social','https://localhost','https://127.0.0.1','https://mastodon.social:8443']){
  await assert.rejects(publishText(job,{...mastodon,MASTODON_BASE_URL:addr},()=>{throw Error('fetch must not run')}),/invalid_mastodon_base_url/)
 }
});
await test('Mastodon 429 is failure, never a success',async()=>{
 await assert.rejects(publishText(job,mastodon,async()=>new Response('rate limited',{status:429})),/http_429/)
});
await test('Bluesky obtains session then creates app.bsky.feed.post',async()=>{
 let urls=[],posts=[];
 const transport=async(url,init)=>{
  urls.push(url);posts.push(JSON.parse(init.body));
  return new Response(JSON.stringify(url.endsWith('createSession')?{did:'did:plc:tester',accessJwt:'temporary'}:{uri:'at://did:plc:tester/app.bsky.feed.post/abc',cid:'cid'}),{status:200})
 };
 const response=await publishText({...job,platform:'bluesky'},bsky,transport);
 assert.match(response.providerId,/^at:\/\//);assert.equal(urls.length,2);
 assert.equal(posts[1].collection,'app.bsky.feed.post');
 assert.equal(posts[1].record.text,job.caption);
});
await test('Bluesky invalid session prevents record posting',async()=>{
 let calls=0;
 await assert.rejects(publishText({...job,platform:'bluesky'},bsky,async()=>{calls++;return Response.json({did:'did:plc:test'})}),/invalid_session/);
 assert.equal(calls,1);
});
await test('Bluesky length validator rejects oversized texts before network',async()=>{
 await assert.rejects(publishText({...job,platform:'bluesky',caption:'あ'.repeat(301)},bsky,()=>{throw Error('fetch must not run')}),/too_long/)
});
await test('Credentials are platform specific',async()=>{
 assert.equal(credentialsReady('mastodon',bsky),false);
 assert.equal(credentialsReady('bluesky',mastodon),false);
 assert.equal(credentialsReady('mastodon',mastodon),true);
});
console.log('RESULT independent platform adapter '+count+'/11 PASS');
if(count!==11)process.exitCode=1;

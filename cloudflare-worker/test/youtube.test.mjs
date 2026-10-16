import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handle, consumeState, claim, boundedBody } from '../src/youtube-worker.js';
import { validateJob, digest, seal, unseal, sessionURL, acknowledgedOffset } from '../src/youtube-api.js';

const channel = 'UC' + 'a'.repeat(22), videoId = 'abcDEF123_-';
const media = new TextEncoder().encode('fixture-video-content');
const publishAt = new Date(Date.now() + 2 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const fixture = { platform: 'youtube', campaignId: 'test_campaign', title: 'テスト動画', description: '説明',
  publishAt, madeForKids: false, syntheticMedia: true, size: media.byteLength, mime: 'video/mp4',
  sha256: await digest(media), qaApproved: true, publishApproved: true };
class D1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); this.sql.exec(readFileSync(new URL('../migrations/0001_youtube.sql', import.meta.url), 'utf8')); }
  prepare(q) { const s = this.sql.prepare(q); let values=[]; const prepared = {
    bind(...v) { values=v; return prepared; },
    async first() { return s.get(...values) || null; },
    async all() { return { results: s.all(...values) }; },
    async run() { const r=s.run(...values); return { meta: { changes: Number(r.changes) } }; }
  }; return prepared; }
}
function env() { return { DB: new D1(), ADMIN_TOKEN: 'unit-test-admin-token-never-used-in-production',
  TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_REDIRECT_URI: 'https://test.example/oauth/youtube/callback', YOUTUBE_CHANNEL_ID: channel, LIVE_PUBLISHING_ENABLED: 'true' }; }
function req(path, e, method='GET', body) { return new Request('https://test.example'+path,{method,
  headers:{authorization:'Bearer '+e.ADMIN_TOKEN},body:body===undefined?undefined:typeof body==='object'&&!(body instanceof Uint8Array)?JSON.stringify(body):body}); }
async function connected(e) {
  const encrypted=await seal({refresh_token:'fixture-refresh-token'},e,'oauth:'+channel);
  await e.DB.prepare('INSERT INTO mse_youtube_connection VALUES(?,?,?)').bind(channel,encrypted,'now').run();
}
function upstream(options={}) {
  const stats={starts:0, puts:0, reads:0, queries:0, lastBody:null, headers:null, offset:options.offset||0};
  const http=async(url,init={})=>{
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-access-token',refresh_token:'fixture-refresh-token'});
    if(url.includes('/channels?'))return Response.json({items:[{id:options.wrongChannel?'UC'+'b'.repeat(22):channel}]});
    if(url.includes('/youtube/v3/videos?part=')){stats.reads++;return Response.json({items:[{id:videoId,snippet:{channelId:channel},status:{privacyStatus:options.wrongStatus?'public':'private',publishAt,uploadStatus:'uploaded'}}]});}
    if(init.method==='POST'&&url.includes('uploadType=resumable')){stats.starts++;stats.lastBody=JSON.parse(init.body);if(options.lostStart)throw Error('fixture interruption');return new Response(null,{status:200,headers:{location:'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=fixture'}});}
    if(init.method==='PUT') {
      if(init.headers['content-range'].startsWith('bytes */')) {stats.queries++;if(stats.complete)return Response.json({id:videoId});return new Response(null,{status:308,headers:stats.offset?{range:'bytes=0-'+(stats.offset-1)}:{}});}
      stats.puts++;stats.headers=init.headers;stats.sent=new Uint8Array(init.body);
      if(options.lostFinal){stats.complete=true;throw Error('fixture lost final response');}
      if(options.partial){stats.offset=5;return new Response(null,{status:308,headers:{range:'bytes=0-4'}});}
      stats.complete=true;return Response.json({id:videoId},{status:201});
    }
    throw Error('Unexpected mocked endpoint');
  };return {http,stats};
}
async function create(e, x=fixture) { return (await handle(req('/api/jobs',e,'POST',x),e)).json(); }

test('invalid dates, no QA, immediate dates, missing declarations and oversize are rejected',()=>{
  for(const change of [{publishAt:'2026-99-99T00:00:00Z'},{qaApproved:false},{publishApproved:false},
    {publishAt:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')},{madeForKids:undefined},{syntheticMedia:undefined},
    {size:32*1024*1024+1},{platform:'instagram'},{title:'<bad>'},{sha256:'bad'}]) assert.throws(()=>validateJob({...fixture,...change}));
});
test('token encryption authenticates purpose and ciphertext',async()=>{
  const e=env(),cipher=await seal({test:'value'},e,'oauth:one');assert.deepEqual(await unseal(cipher,e,'oauth:one'),{test:'value'});
  assert.ok(!cipher.includes('value'));await assert.rejects(()=>unseal(cipher,e,'oauth:other'));
});
test('upload sessions reject other hosts, ports, paths and embedded credentials',()=>{
  for(const u of ['https://evil.example/upload/youtube/v3/videos?upload_id=a','https://www.googleapis.com.evil.example/upload/youtube/v3/videos?upload_id=a',
    'https://user:pass@www.googleapis.com/upload/youtube/v3/videos?upload_id=a','https://www.googleapis.com:444/upload/youtube/v3/videos?upload_id=a',
    'https://www.googleapis.com/other?upload_id=a']) assert.throws(()=>sessionURL(u));
});
test('range parser handles absent offsets and rejects malformed offsets',()=>{
  assert.equal(acknowledgedOffset(new Response(null,{status:308}),100),0);
  assert.equal(acknowledgedOffset(new Response(null,{status:308,headers:{range:'bytes=0-4'}}),100),5);
  assert.throws(()=>acknowledgedOffset(new Response(null,{status:308,headers:{range:'bytes=0-999'}}),100));
});
test('admin authorization and same-origin boundary prevent side effects',async()=>{
  const e=env(),m=upstream();await assert.rejects(()=>handle(new Request('https://test.example/api/jobs'),e,m.http),/unauthorized/);
  const r=req('/api/jobs',e,'POST',fixture);r.headers.set('origin','https://evil.example');await assert.rejects(()=>handle(r,e,m.http),/cross_origin/);assert.equal(m.stats.starts,0);
});
test('bounded streamed body rejects a missing-length oversized request',async()=>{
  await assert.rejects(()=>boundedBody(new Request('https://test.example',{method:'POST',body:new Uint8Array(100)}),99),/body_too_large/);
});
test('schema is additive and rerunnable with existing job records preserved',()=>{
  const db=new D1();db.sql.exec("CREATE TABLE jobs(id TEXT); INSERT INTO jobs VALUES('keep');");
  db.sql.exec(readFileSync(new URL('../migrations/0001_youtube.sql',import.meta.url),'utf8'));
  assert.equal(db.sql.prepare('SELECT id FROM jobs').get().id,'keep');
});
test('same campaign is idempotent and changed payload conflicts',async()=>{
  const e=env(),a=await create(e),b=await create(e);assert.equal(a.id,b.id);
  await assert.rejects(()=>create(e,{...fixture,title:'変更'}),/campaign_conflict/);
});
test('lease acquisition excludes concurrent upload and allows expired recovery',async()=>{
  const e=env(),j=await create(e);await claim(e.DB,j.id);await assert.rejects(()=>claim(e.DB,j.id),/job_busy/);
  e.DB.sql.prepare('UPDATE mse_youtube_jobs SET lease_until=1').run();await claim(e.DB,j.id);
});
test('OAuth browser binding, expiry and replay are checked atomically',async()=>{
  const e=env(),state='a'.repeat(43),browser='b'.repeat(43);
  await e.DB.prepare('INSERT INTO mse_youtube_oauth_states(state_hash,browser_hash,expires_at) VALUES(?,?,?)').bind(await digest(state),await digest(browser),Date.now()+10000).run();
  await assert.rejects(()=>consumeState(e.DB,state,'c'.repeat(43)),/expired_or_replayed/);
  await consumeState(e.DB,state,browser);await assert.rejects(()=>consumeState(e.DB,state,browser),/expired_or_replayed/);
});
test('OAuth start sets HttpOnly browser cookie and offline scoped consent',async()=>{
  const e=env(),r=await handle(req('/api/oauth/start',e,'POST',{}),e),j=await r.json(),u=new URL(j.url);
  assert.equal(u.origin,'https://accounts.google.com');assert.equal(u.searchParams.get('access_type'),'offline');
  assert.equal(u.searchParams.get('prompt'),'consent');assert.match(u.searchParams.get('scope'),/youtube.upload/);
  assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
});
test('OAuth callback pins channel, stores encrypted refresh token and cannot replay',async()=>{
  const e=env(),m=upstream(),r=await handle(req('/api/oauth/start',e,'POST',{}),e),{url}=await r.json();
  const state=new URL(url).searchParams.get('state'),cookie=r.headers.get('set-cookie').split(';')[0];
  const callback=()=>new Request('https://test.example/oauth/youtube/callback?code=fixture-code&state='+state,{headers:{cookie}});
  const result=await handle(callback(),e,m.http);assert.equal(result.status,303);
  const row=e.DB.sql.prepare('SELECT * FROM mse_youtube_connection').get();assert.ok(!row.encrypted_token.includes('fixture-refresh-token'));
  await assert.rejects(()=>handle(callback(),e,m.http),/expired_or_replayed/);
});
test('disabled live switch makes zero Google requests',async()=>{
  const e=env();e.LIVE_PUBLISHING_ENABLED='false';const j=await create(e),m=upstream();
  await assert.rejects(()=>handle(req('/api/jobs/'+j.id+'/upload',e,'POST',media),e,m.http),/live_publishing_disabled/);assert.equal(m.stats.starts,0);
});
test('wrong video file is rejected before any Google call',async()=>{
  const e=env(),j=await create(e),m=upstream();await assert.rejects(()=>handle(req('/api/jobs/'+j.id+'/upload',e,'POST',new Uint8Array(media.length)),e,m.http),/video_does_not_match/);assert.equal(m.stats.starts,0);
});
test('wrong channel cannot initiate an upload',async()=>{
  const e=env();await connected(e);const j=await create(e),m=upstream({wrongChannel:true});
  await assert.rejects(()=>handle(req('/api/jobs/'+j.id+'/upload',e,'POST',media),e,m.http),/channel_mismatch/);assert.equal(m.stats.starts,0);
});
test('full job creates private future schedule and verifies YouTube response',async()=>{
  const e=env();await connected(e);const j=await create(e),m=upstream();
  const result=await (await handle(req('/api/jobs/'+j.id+'/upload',e,'POST',media),e,m.http)).json();
  assert.equal(result.status,'youtube_scheduled');assert.equal(result.videoId,videoId);
  assert.equal(m.stats.lastBody.status.privacyStatus,'private');assert.equal(m.stats.lastBody.status.publishAt,publishAt);
  assert.equal(m.stats.lastBody.status.selfDeclaredMadeForKids,false);assert.equal(m.stats.lastBody.status.containsSyntheticMedia,true);
  assert.equal(m.stats.starts,1);assert.equal(m.stats.reads,1);assert.deepEqual(m.stats.sent,media);
  const list=await (await handle(req('/api/jobs',e),e)).text();assert.ok(!list.includes('session_cipher'));assert.ok(!list.includes('upload_id'));
  await handle(req('/api/jobs/'+j.id+'/upload',e,'POST',media),e,m.http);assert.equal(m.stats.puts,1);
});
test('Google offset controls resumed transfer instead of stale local offset',async()=>{
  const e=env();await connected(e);const j=await create(e),m=upstream({offset:5});
  await handle(req('/api/jobs/'+j.id+'/upload',e,'POST',media),e,m.http);
  assert.deepEqual(m.stats.sent,media.slice(5));assert.equal(m.stats.headers['content-range'],'bytes 5-'+(media.length-1)+'/'+media.length);
});
test('lost final response is resolved by probe with no second upload',async()=>{
  const e=env();await connected(e);const j=await create(e),m=upstream({lostFinal:true});
  await assert.rejects(()=>handle(req('/api/jobs/'+j.id+'/upload',e,'POST',media),e,m.http));
  const r=await (await handle(req('/api/jobs/'+j.id+'/probe',e,'POST'),e,m.http)).json();
  assert.equal(r.status,'youtube_scheduled');assert.equal(m.stats.starts,1);assert.equal(m.stats.puts,1);
});
test('lost initiation result cannot automatically start a second insertion',async()=>{
  const e=env();await connected(e);const j=await create(e),m=upstream({lostStart:true});
  await assert.rejects(()=>handle(req('/api/jobs/'+j.id+'/upload',e,'POST',media),e,m.http));
  await assert.rejects(()=>handle(req('/api/jobs/'+j.id+'/upload',e,'POST',media),e,m.http),/session_result_unknown/);assert.equal(m.stats.starts,1);
});
test('mismatched schedule is needs_review, never reported complete',async()=>{
  const e=env();await connected(e);const j=await create(e),m=upstream({wrongStatus:true});
  await assert.rejects(()=>handle(req('/api/jobs/'+j.id+'/upload',e,'POST',media),e,m.http),/schedule_not_verified/);
  const row=await e.DB.prepare('SELECT * FROM mse_youtube_jobs WHERE id=?').bind(j.id).first();assert.equal(row.status,'needs_review');assert.equal(row.video_id,videoId);
});
test('status page has CSP and never embeds credentials',async()=>{
  const e=env(),r=await handle(new Request('https://test.example/'),e);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const html=await r.text();assert.ok(!html.includes(e.ADMIN_TOKEN));assert.ok(!html.includes('localStorage'));assert.match(html,/日本時間/);
  // Syntax-check the exact emitted browser script without executing any DOM or network actions.
  const source=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];new Function(source);
});

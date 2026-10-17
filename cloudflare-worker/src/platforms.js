/**
 * PROJECT MIRROR owned SNS transports. No Metricool, no third-party posting relay.
 * These functions are inert until called by the guarded Worker scheduler.
 * Credentials must be Cloudflare encrypted Worker secrets, never in GitHub.
 */
const BSKY='https://bsky.social';
function requireText(text,network){
  if(typeof text!=='string'||!text.trim())throw Error('empty_post');
  const n=Array.from(new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(text)).length;
  if(n>(network==='bluesky'?300:500))throw Error('post_too_long');
  return text.trim();
}
async function parseResponse(resp,network){
  if(!resp.ok){
    // Do not expose provider response content or tokens in API/logs.
    const err=Error(network+'_provider_http_'+resp.status);
    err.httpStatus=resp.status;
    throw err;
  }
  try{return await resp.json()}catch{throw Error(network+'_malformed_response')}
}
export function credentialsReady(platform,env){
  if(platform==='bluesky')return Boolean(env.BLUESKY_HANDLE&&env.BLUESKY_APP_PASSWORD);
  if(platform==='mastodon')return Boolean(env.MASTODON_ACCESS_TOKEN&&env.MASTODON_BASE_URL);
  return false;
}
export async function publishText(job,env,transport=fetch){
  // Defense in depth; caller must additionally enforce admin auth and QA.
  if(env.LIVE_PUBLISHING_ENABLED!=='true')throw Error('publishing_disabled');
  if(!job?.id||!['bluesky','mastodon'].includes(job.platform))throw Error('unsupported_live_platform');
  if(!credentialsReady(job.platform,env))throw Error('platform_credentials_missing');
  const text=requireText(job.caption,job.platform);
  if(job.asset_ref)throw Error('media_not_implemented');
  if(job.platform==='bluesky'){
    // Standard bsky.social PDS. Custom PDS/OAuth can be implemented separately.
    const session=await parseResponse(await transport(BSKY+'/xrpc/com.atproto.server.createSession',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({identifier:env.BLUESKY_HANDLE,password:env.BLUESKY_APP_PASSWORD})
    }),'bluesky');
    if(!session.accessJwt||!session.did)throw Error('bluesky_invalid_session');
    const data=await parseResponse(await transport(BSKY+'/xrpc/com.atproto.repo.createRecord',{
      method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+session.accessJwt},
      body:JSON.stringify({
        repo:session.did,collection:'app.bsky.feed.post',
        record:{$type:'app.bsky.feed.post',text,createdAt:new Date().toISOString(),langs:['ja']}
      })
    }),'bluesky');
    if(typeof data.uri!=='string'||!data.uri.startsWith('at://'))throw Error('bluesky_invalid_post_response');
    return {providerId:data.uri};
  }
  const url=new URL(env.MASTODON_BASE_URL);
  // Only HTTPS Mastodon instances; no loopback/local or IP literal URLs.
  if(url.protocol!=='https:'||url.username||url.password||url.port||
     !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(url.hostname)||
     url.pathname!=='/'||url.search||url.hash)
    throw Error('invalid_mastodon_base_url');
  const data=await parseResponse(await transport(url.origin+'/api/v1/statuses',{
    method:'POST',headers:{
      'content-type':'application/x-www-form-urlencoded',
      Authorization:'Bearer '+env.MASTODON_ACCESS_TOKEN,
      'Idempotency-Key':job.id
    },
    body:new URLSearchParams({status:text,visibility:'public'}).toString()
  }),'mastodon');
  if(typeof data.id!=='string'&&!Number.isInteger(data.id))throw Error('mastodon_invalid_post_response');
  return {providerId:String(data.id)};
}

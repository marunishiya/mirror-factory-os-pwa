import { Fault, MAX_BYTES, validateJob, requireFuture, digest, random, seal, unseal,
  token, checkChannel, startUpload, sessionURL, acknowledgedOffset, verifyVideo } from './youtube-api.js';
import { page } from './youtube-ui.js';

const nowISO = () => new Date().toISOString();
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra } });
}
function setup(env, origin) {
  for (const name of ['DB', 'ADMIN_TOKEN', 'TOKEN_ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'YOUTUBE_CHANNEL_ID']) {
    if (!env[name]) throw new Fault('configuration_missing_' + name, 503);
  }
  if (env.ADMIN_TOKEN.length < 32) throw new Fault('admin_token_too_short', 503);
  const redirect = new URL(env.GOOGLE_REDIRECT_URI);
  if (redirect.origin !== origin || redirect.pathname !== '/oauth/youtube/callback' ||
      redirect.search || redirect.hash || redirect.protocol !== 'https:') throw new Fault('invalid_oauth_redirect_configuration', 503);
  if (!/^UC[\w-]{22}$/.test(env.YOUTUBE_CHANNEL_ID)) throw new Fault('invalid_channel_configuration', 503);
}
async function admin(request, env) {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) throw new Fault('admin_not_configured', 503);
  const actual = request.headers.get('authorization') || '';
  if (actual.length > 512 || await digest(actual) !== await digest('Bearer ' + env.ADMIN_TOKEN))
    throw new Fault('unauthorized', 401);
}
async function bodyJSON(request) {
  const buf = await boundedBody(request, 16000);
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { throw new Fault('invalid_json'); }
}
export async function boundedBody(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) throw new Fault('body_too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new Fault('empty_body');
  let total = 0; const chunks = [];
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new Fault('body_too_large', 413); }
    chunks.push(value);
  }
  const data = new Uint8Array(total); let i = 0;
  for (const c of chunks) { data.set(c, i); i += c.length; }
  return data.buffer;
}
const getJob = (db, id) => db.prepare('SELECT * FROM mse_youtube_jobs WHERE id=?').bind(id).first();
function summary(row) {
  const p = JSON.parse(row.payload);
  return { id: row.id, campaignId: row.campaign_id, title: p.title, publishAt: p.publishAt,
    status: row.status, size: p.size, offset: row.offset_bytes, videoId: row.video_id,
    error: row.last_error, sha256: p.sha256 };
}
async function access(env, http) {
  const conn = await env.DB.prepare('SELECT * FROM mse_youtube_connection WHERE channel_id=?').bind(env.YOUTUBE_CHANNEL_ID).first();
  if (!conn) throw new Fault('youtube_not_connected', 503);
  const saved = await unseal(conn.encrypted_token, env, 'oauth:' + env.YOUTUBE_CHANNEL_ID);
  const data = await token(env, { grant_type: 'refresh_token', refresh_token: saved.refresh_token }, http);
  // Pin the current OAuth identity before any upload operation.
  await checkChannel(data.access_token, env.YOUTUBE_CHANNEL_ID, http);
  return data.access_token;
}
async function saveConnection(env, data) {
  if (typeof data.refresh_token !== 'string') throw new Fault('refresh_token_missing_reconnect_with_consent', 409);
  const cipher = await seal({ refresh_token: data.refresh_token }, env, 'oauth:' + env.YOUTUBE_CHANNEL_ID);
  await env.DB.prepare('INSERT INTO mse_youtube_connection(channel_id,encrypted_token,updated_at) VALUES(?,?,?) ON CONFLICT(channel_id) DO UPDATE SET encrypted_token=excluded.encrypted_token,updated_at=excluded.updated_at')
    .bind(env.YOUTUBE_CHANNEL_ID, cipher, nowISO()).run();
}
export async function consumeState(db, state, browser) {
  if (!/^[\w-]{43}$/.test(state || '') || !/^[\w-]{43}$/.test(browser || '')) throw new Fault('invalid_oauth_state', 403);
  const result = await db.prepare('UPDATE mse_youtube_oauth_states SET consumed=1 WHERE state_hash=? AND browser_hash=? AND consumed=0 AND expires_at>?')
    .bind(await digest(state), await digest(browser), Date.now()).run();
  if (result.meta?.changes !== 1) throw new Fault('expired_or_replayed_oauth_state', 403);
}
async function createJob(env, payload) {
  const p = validateJob(payload); const fingerprint = await digest(JSON.stringify(p));
  const id = crypto.randomUUID(); const time = nowISO();
  await env.DB.prepare('INSERT OR IGNORE INTO mse_youtube_jobs(id,campaign_id,fingerprint,payload,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .bind(id, p.campaignId, fingerprint, JSON.stringify(p), 'draft', time, time).run();
  const row = await env.DB.prepare('SELECT * FROM mse_youtube_jobs WHERE campaign_id=?').bind(p.campaignId).first();
  if (row.fingerprint !== fingerprint) throw new Fault('campaign_conflict_use_original_job', 409);
  return summary(row);
}
export async function claim(db, id, time = Date.now()) {
  const r = await db.prepare('UPDATE mse_youtube_jobs SET lease_until=?,updated_at=? WHERE id=? AND lease_until<?')
    .bind(time + 120000, nowISO(), id, time).run();
  if (r.meta?.changes !== 1) throw new Fault('job_busy_try_status_later', 409);
}
async function markReview(env, id, code) {
  await env.DB.prepare("UPDATE mse_youtube_jobs SET status='needs_review',last_error=?,updated_at=? WHERE id=?")
    .bind(code, nowISO(), id).run();
}
async function uploadOperation(request, env, id, probeOnly, http) {
  if (env.LIVE_PUBLISHING_ENABLED !== 'true') throw new Fault('live_publishing_disabled', 503);
  let row = await getJob(env.DB, id); if (!row) throw new Fault('job_not_found', 404);
  if (row.status === 'youtube_scheduled') return summary(row);
  const job = JSON.parse(row.payload);
  // Validate media BEFORE claiming or calling any external endpoint.
  let bytes;
  if (!probeOnly) {
    bytes = await boundedBody(request, MAX_BYTES);
    if (bytes.byteLength !== job.size || await digest(bytes) !== job.sha256) throw new Fault('video_does_not_match_approved_file');
    requireFuture(job.publishAt);
  }
  await claim(env.DB, id);
  try {
    row = await getJob(env.DB, id);
    const bearer = await access(env, http);
    if (row.video_id) {
      await verifyVideo(row.video_id, job, env.YOUTUBE_CHANNEL_ID, bearer, http);
      await env.DB.prepare("UPDATE mse_youtube_jobs SET status='youtube_scheduled',last_error='',updated_at=? WHERE id=?")
        .bind(nowISO(), id).run();
      return summary(await getJob(env.DB, id));
    }
    if (!row.session_cipher) {
      if (probeOnly) return summary(row);
      // A lost initiation response MUST NOT start a second YouTube insertion.
      if (row.status !== 'draft') throw new Fault('session_result_unknown_manual_review_required', 409);
      await env.DB.prepare("UPDATE mse_youtube_jobs SET status='initiating',updated_at=? WHERE id=?").bind(nowISO(), id).run();
      const url = await startUpload(job, bearer, http);
      const cipher = await seal(url, env, 'upload:' + id);
      await env.DB.prepare("UPDATE mse_youtube_jobs SET session_cipher=?,status='uploading',updated_at=? WHERE id=?")
        .bind(cipher, nowISO(), id).run();
      row.session_cipher = cipher;
    }
    const url = sessionURL(await unseal(row.session_cipher, env, 'upload:' + id));
    const headers = { authorization: 'Bearer ' + bearer, 'content-range': 'bytes */' + job.size, 'content-length': '0' };
    const checked = await http(url, { method: 'PUT', headers, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    let result = checked;
    if (checked.status === 308) {
      const offset = acknowledgedOffset(checked, job.size);
      await env.DB.prepare('UPDATE mse_youtube_jobs SET offset_bytes=?,updated_at=? WHERE id=?').bind(offset, nowISO(), id).run();
      if (probeOnly) return summary(await getJob(env.DB, id));
      requireFuture(job.publishAt);
      if (offset >= job.size) throw new Fault('google_finalization_pending_probe_later', 409);
      result = await http(url, { method: 'PUT', redirect: 'manual', signal: AbortSignal.timeout(60000), headers: {
        authorization: 'Bearer ' + bearer, 'content-type': job.mime,
        'content-length': String(job.size - offset), 'content-range': 'bytes ' + offset + '-' + (job.size - 1) + '/' + job.size },
        body: bytes.slice(offset) });
    }
    if (result.status === 308) {
      const offset = acknowledgedOffset(result, job.size);
      await env.DB.prepare("UPDATE mse_youtube_jobs SET offset_bytes=?,status='uploading',last_error='',updated_at=? WHERE id=?")
        .bind(offset, nowISO(), id).run();
      return summary(await getJob(env.DB, id));
    }
    if (![200, 201].includes(result.status)) throw new Fault('youtube_upload_error_' + result.status, 502);
    const video = await result.json();
    if (!/^[\w-]{11}$/.test(video.id || '')) throw new Fault('upload_result_missing_video_id', 502);
    // Persist ID before verification so an interrupted verification never reuploads.
    await env.DB.prepare("UPDATE mse_youtube_jobs SET video_id=?,offset_bytes=?,status='verifying',updated_at=? WHERE id=?")
      .bind(video.id, job.size, nowISO(), id).run();
    await verifyVideo(video.id, job, env.YOUTUBE_CHANNEL_ID, bearer, http);
    await env.DB.prepare("UPDATE mse_youtube_jobs SET status='youtube_scheduled',last_error='',updated_at=? WHERE id=?")
      .bind(nowISO(), id).run();
    return summary(await getJob(env.DB, id));
  } catch (e) {
    await markReview(env, id, e instanceof Fault ? e.message : 'network_or_storage_uncertain_probe_before_retry');
    throw e;
  } finally {
    await env.DB.prepare('UPDATE mse_youtube_jobs SET lease_until=0 WHERE id=?').bind(id).run();
  }
}
export async function handle(request, env, http = fetch) {
  const url = new URL(request.url); const path = url.pathname;
  if (request.headers.has('origin') && request.headers.get('origin') !== url.origin) throw new Fault('cross_origin_forbidden', 403);
  if (request.method === 'GET' && path === '/') {
    const nonce = random();
    return new Response(page(nonce), { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } });
  }
  if (request.method === 'GET' && path === '/health') return json({ service: 'MIRROR YouTube Scheduler',
    version: '0.5-review', publishingEnabled: env.LIVE_PUBLISHING_ENABLED === 'true', liveVerified: false });
  setup(env, url.origin);
  if (request.method === 'GET' && path === '/oauth/youtube/callback') {
    const cookie = /(?:^|; )mse_oauth=([\w-]+)/.exec(request.headers.get('cookie') || '')?.[1];
    await consumeState(env.DB, url.searchParams.get('state'), cookie);
    if (url.searchParams.has('error')) throw new Fault('oauth_not_approved', 403);
    const code = url.searchParams.get('code'); if (!code || code.length > 4096) throw new Fault('oauth_code_missing');
    const data = await token(env, { code, grant_type: 'authorization_code', redirect_uri: env.GOOGLE_REDIRECT_URI }, http);
    await checkChannel(data.access_token, env.YOUTUBE_CHANNEL_ID, http);
    await saveConnection(env, data);
    return new Response(null, { status: 303, headers: { location: '/', 'cache-control': 'no-store',
      'set-cookie': 'mse_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/oauth/youtube; Max-Age=0', 'referrer-policy': 'no-referrer' } });
  }
  await admin(request, env);
  if (request.method === 'GET' && path === '/api/readiness') {
    await env.DB.prepare('SELECT id FROM mse_youtube_jobs LIMIT 1').all();
    const connected = !!await env.DB.prepare('SELECT channel_id FROM mse_youtube_connection WHERE channel_id=?').bind(env.YOUTUBE_CHANNEL_ID).first();
    return json({ schemaReady: true, connected, channelId: env.YOUTUBE_CHANNEL_ID,
      publishingEnabled: env.LIVE_PUBLISHING_ENABLED === 'true', maxBytes: MAX_BYTES });
  }
  if (request.method === 'POST' && path === '/api/oauth/start') {
    const state = random(); const browser = random();
    await env.DB.prepare('INSERT INTO mse_youtube_oauth_states(state_hash,browser_hash,expires_at) VALUES(?,?,?)')
      .bind(await digest(state), await digest(browser), Date.now() + 600000).run();
    const authURL = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authURL.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.GOOGLE_REDIRECT_URI,
      response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
      state, access_type: 'offline', prompt: 'consent' }).toString();
    return json({ url: authURL.href }, 200, { 'set-cookie': 'mse_oauth=' + browser + '; HttpOnly; Secure; SameSite=Lax; Path=/oauth/youtube; Max-Age=600' });
  }
  if (request.method === 'GET' && path === '/api/jobs') {
    const r = await env.DB.prepare('SELECT * FROM mse_youtube_jobs ORDER BY created_at DESC LIMIT 100').all();
    return json({ jobs: (r.results || []).map(summary) });
  }
  if (request.method === 'POST' && path === '/api/jobs') return json(await createJob(env, await bodyJSON(request)), 201);
  const match = /^\/api\/jobs\/([a-f0-9-]{36})\/(upload|probe)$/.exec(path);
  if (request.method === 'POST' && match) return json(await uploadOperation(request, env, match[1], match[2] === 'probe', http));
  throw new Fault('not_found', 404);
}
export default { async fetch(request, env) {
  try { return await handle(request, env); }
  catch (e) { return json({ error: e instanceof Fault ? e.message : 'internal_error_check_schema_and_configuration' }, e instanceof Fault ? e.status : 500); }
} };

// YouTube transport. No credentials, session URLs, or upstream bodies are logged.
export const MAX_BYTES = 32 * 1024 * 1024;
export class Fault extends Error {
  constructor(code, status = 400) { super(code); this.status = status; }
}
export function validateJob(x, now = Date.now()) {
  if (!x || x.platform !== 'youtube' || x.qaApproved !== true || x.publishApproved !== true)
    throw new Fault('explicit_youtube_and_publication_approval_required');
  if (!/^[\w-]{6,80}$/.test(x.campaignId || '')) throw new Fault('invalid_campaign_id');
  if (typeof x.title !== 'string' || !x.title.trim() || [...x.title].length > 100 || /[<>]/.test(x.title))
    throw new Fault('invalid_title');
  if (typeof x.description !== 'string' || new TextEncoder().encode(x.description).length > 5000 || /[<>]/.test(x.description))
    throw new Fault('invalid_description');
  if (typeof x.madeForKids !== 'boolean' || typeof x.syntheticMedia !== 'boolean')
    throw new Fault('audience_and_synthetic_media_declarations_required');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(x.publishAt || '') || !Number.isFinite(Date.parse(x.publishAt)) ||
      new Date(x.publishAt).toISOString().replace('.000Z', 'Z') !== x.publishAt)
    throw new Fault('invalid_utc_time');
  requireFuture(x.publishAt, now);
  if (!Number.isSafeInteger(x.size) || x.size < 1 || x.size > MAX_BYTES) throw new Fault('video_size_limit_32_mib');
  if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(x.mime)) throw new Fault('unsupported_video_type');
  if (!/^[a-f0-9]{64}$/.test(x.sha256 || '')) throw new Fault('video_sha256_required');
  return { campaignId: x.campaignId, title: x.title.trim(), description: x.description,
    publishAt: x.publishAt, madeForKids: x.madeForKids, syntheticMedia: x.syntheticMedia,
    size: x.size, mime: x.mime, sha256: x.sha256 };
}
export function requireFuture(at, now = Date.now()) {
  if (!Number.isFinite(Date.parse(at)) || Date.parse(at) < now + 10 * 60 * 1000)
    throw new Fault('schedule_must_be_at_least_10_minutes_ahead');
}
export async function digest(value) {
  const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(n => n.toString(16).padStart(2, '0')).join('');
}
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export const random = () => b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function key(env) {
  let raw;
  try { raw = unb64(env.TOKEN_ENCRYPTION_KEY || ''); } catch { throw new Fault('invalid_encryption_key', 503); }
  if (raw.length !== 32) throw new Fault('invalid_encryption_key', 503);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(value, env, purpose) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(purpose) },
    await key(env), new TextEncoder().encode(JSON.stringify(value)));
  return b64(iv) + '.' + b64(new Uint8Array(body));
}
export async function unseal(value, env, purpose) {
  const [iv, body] = value.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(purpose) }, await key(env), unb64(body));
  return JSON.parse(new TextDecoder().decode(plain));
}
export function sessionURL(value) {
  const u = new URL(value);
  if (u.origin !== 'https://www.googleapis.com' || u.pathname !== '/upload/youtube/v3/videos' ||
      u.username || u.password || !u.searchParams.get('upload_id')) throw new Fault('invalid_upload_session', 502);
  return u.href;
}
export async function token(env, fields, http = fetch) {
  const r = await http('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error',
    signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...fields }) });
  if (!r.ok) throw new Fault('google_authorization_failed_reconnect_required', 502);
  const data = await r.json();
  if (typeof data.access_token !== 'string') throw new Fault('google_access_token_missing', 502);
  return data;
}
export async function googleJSON(url, access, init = {}, http = fetch) {
  const r = await http(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { 'authorization': 'Bearer ' + access, 'content-type': 'application/json', ...init.headers } });
  if (!r.ok) throw new Fault('youtube_api_error_' + r.status, 502);
  return r.json();
}
export async function checkChannel(access, expected, http = fetch) {
  const data = await googleJSON('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', access, {}, http);
  if (data.items?.length !== 1 || data.items[0].id !== expected) throw new Fault('youtube_channel_mismatch', 403);
}
export async function startUpload(job, access, http = fetch) {
  requireFuture(job.publishAt);
  const r = await http('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: {
      authorization: 'Bearer ' + access, 'content-type': 'application/json',
      'x-upload-content-length': String(job.size), 'x-upload-content-type': job.mime },
    body: JSON.stringify({ snippet: { title: job.title, description: job.description, categoryId: '1' }, status: {
      privacyStatus: 'private', publishAt: job.publishAt, selfDeclaredMadeForKids: job.madeForKids,
      containsSyntheticMedia: job.syntheticMedia } }) });
  if (!r.ok) throw new Fault('youtube_session_error_' + r.status, 502);
  return sessionURL(r.headers.get('location'));
}
export function acknowledgedOffset(r, size) {
  if (r.status !== 308) throw new Fault('not_an_incomplete_upload', 502);
  const range = r.headers.get('range');
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range);
  const offset = match ? Number(match[1]) + 1 : NaN;
  if (!Number.isSafeInteger(offset) || offset < 1 || offset > size) throw new Fault('invalid_google_upload_offset', 502);
  return offset;
}
export async function verifyVideo(id, job, channel, access, http = fetch) {
  if (!/^[\w-]{11}$/.test(id || '')) throw new Fault('invalid_youtube_video_id', 502);
  const data = await googleJSON('https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=' + id, access, {}, http);
  const v = data.items?.[0];
  if (!v || v.id !== id || v.snippet?.channelId !== channel ||
      v.status?.privacyStatus !== 'private' || Date.parse(v.status?.publishAt) !== Date.parse(job.publishAt) ||
      ['failed', 'rejected', 'deleted'].includes(v.status?.uploadStatus))
    throw new Fault('youtube_schedule_not_verified', 409);
  return { id, publishAt: v.status.publishAt };
}

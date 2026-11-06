// Private, content-addressed R2 staging for an approved YouTube job.
// No public R2 endpoint, redirect following, source credentials or SNS posting.
import { Fault, MAX_BYTES, digest } from './youtube-api.js';

export function sourceURL(value, hosts) {
  const allowed = (hosts || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) throw new Fault('media_source_hosts_not_configured', 503);
  let url;
  try { url = new URL(value); } catch { throw new Fault('invalid_media_source_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !allowed.includes(url.hostname.toLowerCase()) ||
      url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.startsWith('['))
    throw new Fault('media_source_not_allowed', 403);
  return url.href;
}

function storageKey(job) {
  if (!/^[\w-]{6,80}$/.test(job.campaignId || '') || !/^[a-f0-9]{64}$/.test(job.sha256 || ''))
    throw new Fault('invalid_media_identity');
  return 'youtube/staged/v1/' + job.campaignId + '/' + job.sha256;
}

function bucket(env) {
  if (!env.MEDIA_BUCKET) throw new Fault('private_media_bucket_not_configured', 503);
  return env.MEDIA_BUCKET;
}

async function boundedRemote(response, maxBytes) {
  const expected = response.headers.get('content-length');
  if (expected !== null && (!/^\d+$/.test(expected) || Number(expected) > maxBytes))
    throw new Fault('remote_media_too_large', 413);
  const reader = response.body?.getReader();
  if (!reader) throw new Fault('remote_media_empty', 502);
  let count = 0; const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > maxBytes) throw new Fault('remote_media_too_large', 413);
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* stream may already be closed */ }
  }
  const bytes = new Uint8Array(count); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

export async function readStagedMedia(env, job) {
  const object = await bucket(env).get(storageKey(job));
  if (!object) throw new Fault('staged_media_not_found', 404);
  if (object.size !== job.size || object.size > MAX_BYTES) throw new Fault('staged_media_size_mismatch', 409);
  const bytes = await object.arrayBuffer();
  if (bytes.byteLength !== job.size || await digest(bytes) !== job.sha256)
    throw new Fault('staged_media_hash_mismatch', 409);
  return bytes;
}

export async function stageMedia(env, job, inputURL, http = fetch) {
  const store = bucket(env);
  const url = sourceURL(inputURL, env.MEDIA_SOURCE_HOSTS);
  if (!Number.isSafeInteger(job.size) || job.size < 1 || job.size > MAX_BYTES)
    throw new Fault('media_size_out_of_range');
  const key = storageKey(job);
  if (await store.head(key)) {
    await readStagedMedia(env, job); // Verify object instead of trusting metadata.
    return { staged: true, alreadyStaged: true, size: job.size, sha256: job.sha256 };
  }
  const response = await http(url, { method: 'GET', redirect: 'manual',
    signal: AbortSignal.timeout(45000), headers: { accept: 'video/*' } });
  // Reject 3xx; never fetch a redirected destination.
  if (response.status !== 200) throw new Fault('media_source_http_' + response.status, 502);
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mime !== job.mime) throw new Fault('media_source_mime_mismatch', 415);
  const headerSize = response.headers.get('content-length');
  if (headerSize !== null && Number(headerSize) !== job.size)
    throw new Fault('media_source_size_mismatch', 409);
  const bytes = await boundedRemote(response, MAX_BYTES);
  if (bytes.byteLength !== job.size || await digest(bytes) !== job.sha256)
    throw new Fault('media_source_hash_mismatch', 409);
  const written = await store.put(key, bytes, { httpMetadata: { contentType: job.mime },
    customMetadata: { sha256: job.sha256, campaignId: job.campaignId } });
  if (!written) throw new Fault('private_media_write_failed', 502);
  return { staged: true, alreadyStaged: false, size: job.size, sha256: job.sha256 };
}

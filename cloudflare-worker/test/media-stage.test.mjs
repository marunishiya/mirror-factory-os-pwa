import test from 'node:test';
import assert from 'node:assert/strict';
import { stageMedia, readStagedMedia, sourceURL } from '../src/media-stage.js';
import { digest } from '../src/youtube-api.js';

function fixture() {
  const bytes = new TextEncoder().encode('mirror-media-fixture');
  const objects = new Map();
  const store = {
    async head(k) { return objects.has(k) ? { size: objects.get(k).byteLength } : null; },
    async get(k) { const b = objects.get(k); return b ? { size: b.byteLength, arrayBuffer: async () => b.slice(0) } : null; },
    async put(k, b) { objects.set(k, b.slice(0)); return { key: k }; }
  };
  return { bytes, objects, store };
}
function env(store) { return { MEDIA_BUCKET: store, MEDIA_SOURCE_HOSTS: 'assets.example.com,media.example.org' }; }
const u = 'https://assets.example.com/private/media.mp4';
const job = async bytes => ({ campaignId: 'campaign-2026', sha256: await digest(bytes),
  size: bytes.byteLength, mime: 'video/mp4' });
const response = (b, overrides = {}) => new Response(b, { status: overrides.status || 200,
  headers: { 'content-type': overrides.type || 'video/mp4', ...overrides.headers } });

test('strict HTTPS host allowlist rejects bypasses', () => {
  assert.equal(sourceURL(u, 'assets.example.com'), u);
  for (const bad of ['http://assets.example.com/file', 'https://assets.example.com.evil.test/f',
    'https://name:secret@assets.example.com/f', 'https://assets.example.com:444/f',
    'https://127.0.0.1/f', 'https://assets.example.com/f#fragment'])
    assert.throws(() => sourceURL(bad, 'assets.example.com'), /media_source_not_allowed/);
  assert.throws(() => sourceURL(u, ''), /media_source_hosts_not_configured/);
});

test('stage downloads once, verifies hash, stores private bytes and is idempotent', async () => {
  const f = fixture(), e = env(f.store), j = await job(f.bytes); let calls = 0;
  const fetcher = async (url, init) => {
    calls++; assert.equal(url, u); assert.equal(init.redirect, 'manual'); return response(f.bytes);
  };
  const a = await stageMedia(e, j, u, fetcher), b = await stageMedia(e, j, u, fetcher);
  assert.deepEqual([a.alreadyStaged, b.alreadyStaged], [false, true]);
  assert.equal(calls, 1);
  assert.deepEqual(new Uint8Array(await readStagedMedia(e, j)), f.bytes);
});

test('rejects redirects, wrong MIME, wrong size and wrong hash before R2 write', async () => {
  for (const which of ['redirect', 'mime', 'length', 'hash']) {
    const f = fixture(), j = await job(f.bytes), e = env(f.store);
    let r;
    if (which === 'redirect') r = new Response(null, { status: 302, headers: { location: 'https://bad.example/test' } });
    if (which === 'mime') r = response(f.bytes, { type: 'text/html' });
    if (which === 'length') r = response(f.bytes, { headers: { 'content-length': '999' } });
    if (which === 'hash') r = response(new TextEncoder().encode('bad content'));
    await assert.rejects(() => stageMedia(e, j, u, async () => r));
    assert.equal(f.objects.size, 0);
  }
});

test('rejects private R2 objects that changed since staging', async () => {
  const f = fixture(), j = await job(f.bytes), e = env(f.store);
  await stageMedia(e, j, u, async () => response(f.bytes));
  const key = [...f.objects.keys()][0]; f.objects.set(key, new Uint8Array(j.size));
  await assert.rejects(() => readStagedMedia(e, j), /staged_media_hash_mismatch/);
});

test('rejects oversized unknown-length chunked source before R2 write', async () => {
  const f = fixture(), e = env(f.store), j = await job(f.bytes);
  const huge = new Uint8Array(32 * 1024 * 1024 + 1);
  const stream = new ReadableStream({ start(c) { c.enqueue(huge); c.close(); } });
  await assert.rejects(() => stageMedia(e, j, u, async () =>
    new Response(stream, { headers: { 'content-type': 'video/mp4' } })), /remote_media_too_large/);
  assert.equal(f.objects.size, 0);
});

import fs from 'node:fs';
import assert from 'node:assert/strict';
const cfg=JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
assert.equal(cfg.name,'mirror-social-scheduler');
assert.equal(cfg.d1_databases?.length,1);
assert.deepEqual(cfg.d1_databases[0],{binding:'DB',database_name:'mirror-social-db',database_id:'e76938e0-9c61-4a25-b84c-452930f698f3'});
assert.equal(cfg.workers_dev,true);
assert.ok(!cfg.triggers?.crons?.length,'No cron triggers may be created by this package');
assert.ok(!cfg.vars?.ADMIN_TOKEN,'Never embed ADMIN_TOKEN in source/config');
for(const file of ['bootstrap.js','dryrun.js']) {
 const s=fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
 assert.match(s,/publishingEnabled:false/);
 assert.ok(!/fetch\s*\(\s*['"`]https?:\/\//.test(s),'Do not send network requests to SNS');
}
console.log('PASS config exactly matches Cloudflare PROJECT MIRROR production Worker + D1');
console.log('PASS no cron or configured API token in deploy config');

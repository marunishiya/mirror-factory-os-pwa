import assert from 'node:assert/strict';
import {inspect} from '../metricool-preflight.mjs';

const now=new Date('2026-10-16T00:00:00Z');
const future='2026-10-17T10:00:00';
const post=(network,overrides={})=>({publicationDate:{dateTime:future,timezone:'Asia/Tokyo'},
  providers:[{network,status:'PENDING',detailedStatus:'Pending'}],
  autoPublish:true,draft:false,media:['https://example.test/media.mp4'],text:'unit test',...overrides});
let n=0;
function check(name,fn){fn();n++;console.log('PASS',name)}
check('healthy three connected networks are preflight ready',()=>{
  const r=inspect({data:['instagram','tiktok','youtube'].map(n=>post(n))},{now});
  assert.equal(r.ready,true);assert.equal(r.autoReady,3);
});
check('failed status prevents false success',()=>{
  const p=post('youtube',{providers:[{network:'youtube',status:'ERROR',detailedStatus:'You have reached your Metricool account limit.'}]});
  const r=inspect({data:[p,post('instagram'),post('tiktok')]},{now});
  assert.equal(r.ready,false);assert.equal(r.failures.length,1);assert.match(r.failures[0].reason,/limit/);
});
check('pending does not imply posted',()=>{
  const r=inspect({data:[post('instagram')]},{now});
  assert.equal(r.ready,false);assert.equal(r.networks.instagram.pending,1);
});
check('media missing blocks preflight',()=>{
  const r=inspect({data:[post('youtube',{media:[]}),post('instagram'),post('tiktok')]},{now});
  assert.equal(r.ready,false);assert.ok(r.warnings.includes('youtube:media_missing'));
});
check('manual delivery is flagged',()=>{
  const r=inspect({data:[post('tiktok',{autoPublish:false})]},{now});
  assert.ok(r.warnings.includes('tiktok:manual_delivery'));
});
check('duplicate schedule is flagged',()=>{
  const r=inspect({data:[post('instagram'),post('instagram')]},{now});
  assert.ok(r.warnings.includes('instagram:possible_duplicate_scheduled_post'));
});
check('wrapper from connected Metricool accepted',()=>{
  const r=inspect({text:JSON.stringify({data:[post('instagram')]})},{now});
  assert.equal(r.posts,1);
});
check('malformed input fails closed',()=>{
  assert.throws(()=>inspect({data:{}}),/array/);
});
console.log('RESULT Metricool preflight '+n+'/8 PASS');

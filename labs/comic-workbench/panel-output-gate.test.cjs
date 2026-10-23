'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
test('single-panel output gate Python tests run in existing offline CI',()=>{
 const dir=__dirname;
 const r=cp.spawnSync('python3',['-m','unittest','-v','panel_output_gate_test'],{
  cwd:dir,encoding:'utf8',timeout:20000,maxBuffer:1024*1024
 });
 assert.equal(r.error,undefined,String(r.error||''));
 assert.equal(r.status,0,(r.stdout||'')+'\n'+(r.stderr||''));
 assert.match(r.stderr,/Ran 7 tests/);
});

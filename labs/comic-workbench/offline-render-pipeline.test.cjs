'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runMockPanel,verifyMasterFiles,inspectPng,digest}=require('./offline-render-pipeline.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64');
const jpg=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(40,22),Buffer.from([255,217])]);
const panels=[
 {panel:1,position:'右上',lines:[{speaker:'M',text:'こんにちは'}]},
 {panel:2,position:'左上',lines:[{speaker:'K',text:'はい'}]},
 {panel:3,position:'右中',lines:[]},
 {panel:4,position:'左中',lines:[]},
 {panel:5,position:'右下',lines:[]},
 {panel:6,position:'左下',lines:[{speaker:'M',text:'また来てください'}]}
];
const sourceBytes=Buffer.from(JSON.stringify({pageId:'CH04_P10',panels}));
const lockSha=digest(sourceBytes);
const masterBytes={K:jpg,M:png};
const approvedRegistry={K:{confirmedByUser:true,sha256:digest(jpg)},
 M:{confirmedByUser:true,sha256:digest(png)}};
const plan={
 pageId:'CH04_P10',sourceLockSha256:lockSha,requiredCharacterIds:['K','M'],
 storyboard:panels.map((p,i)=>({panel:p.panel,position:p.position,
  camera:['wide','medium','over-shoulder','close','two-shot','detail'][i],
  emotion:i===5?'hope':'uncertain'}))
};
const args=()=>({sourceBytes,plan,masterBytes,approvedRegistry,panelId:6,
 prompt:'自然な会話距離、表情は隠さない',history:[],approvedAssets:[]});
const failed=r=>({pageId:plan.pageId,panelId:6,status:'FAILED',
 sourceLockSha256:lockSha,inputSha256:r.inputSha256,
 outputSha256:r.candidate.outputSha256,defects:['BUBBLE_OVERLAP']});
const fix=r=>({defectCode:'BUBBLE_OVERLAP',rootCause:'古い吹き出しの重複',
 changedElement:'第6コマの吹き出しのみ除去',
 expectedDifference:'白い吹き出しを一つだけ配置',
 verificationMethod:'実画像で旧縁と文字と顔を独立確認',
 previousOutputSha256:r.candidate.outputSha256,patchScope:'CH04_P10:C06'});
const issueCodes=r=>(r.retry?.issues||r.preflight?.issues||[]).map(x=>x.code);
test('real source bytes hashed and full preflight executed',()=>{
 const r=runMockPanel(args());
 assert.equal(r.status,'MOCK_ONLY_NOT_ART');assert.equal(r.lockSha256,lockSha);
 assert.equal(r.preflight.status,'REVIEW_REQUIRED');
 assert.equal(r.retry.status,'SINGLE_TRIAL_ALLOWED');
 assert.equal(r.providerCalled,false);
});
test('output SHA is derived from bytes, and image dimensions actually parsed',()=>{
 const r=runMockPanel(args());
 assert.equal(r.candidate.outputSha256,digest(r.outputBytes));
 assert.equal(r.candidate.width,1);assert.equal(r.candidate.height,1);
});
test('mock is blocked by real-image postflight, never approved',()=>{
 const r=runMockPanel(args());
 assert.equal(r.resultQa.status,'FAILED_QA');
 assert.equal(r.pageQa.status,'BLOCKED');
 assert.equal(r.artApproved,false);assert.equal(r.publicationApproved,false);
});
test('user-approved JPEG and PNG master byte hashes supported',()=>{
 const r=verifyMasterFiles(['K','M'],masterBytes,approvedRegistry);
 assert.equal(r.issues.length,0);
 assert.equal(r.references.length,2);
});
test('master image must match expected actual bytes',()=>{
 const x=args();x.approvedRegistry={...approvedRegistry,K:{...approvedRegistry.K,sha256:'a'.repeat(64)}};
 const r=runMockPanel(x);
 assert.equal(r.reason,'MASTER_CHECK_FAILED');
 assert.equal(r.providerCalled,false);
});
test('user approval not inferred from a matching sha',()=>{
 const x=args();x.approvedRegistry={...approvedRegistry,M:{...approvedRegistry.M,confirmedByUser:false}};
 assert.equal(runMockPanel(x).reason,'MASTER_CHECK_FAILED');
});
test('missing master bytes blocks before rendering',()=>{
 const x=args();x.masterBytes={K:jpg};
 assert.equal(runMockPanel(x).reason,'MASTER_CHECK_FAILED');
});
test('unsupported master format blocks',()=>{
 const x=args();const bytes=Buffer.alloc(64,3);
 x.masterBytes={...masterBytes,K:bytes};
 x.approvedRegistry={...approvedRegistry,K:{confirmedByUser:true,sha256:digest(bytes)}};
 assert.equal(runMockPanel(x).reason,'MASTER_CHECK_FAILED');
});
test('caller cannot substitute registered image with self asserted manifest',()=>{
 const x=args();x.plan={...plan,masterReferences:[{characterId:'K',hashMatched:true,sha256:'b'.repeat(64)}]};
 x.masterBytes={...masterBytes,K:Buffer.alloc(10)};
 assert.equal(runMockPanel(x).reason,'MASTER_CHECK_FAILED');
});
test('edited source lock with old sha blocks',()=>{
 const x=args();x.sourceBytes=Buffer.from(JSON.stringify({pageId:'CH04_P10',panels:[...panels,{panel:7,position:'下',lines:[]}]}));
 assert.equal(runMockPanel(x).reason,'LOCK_DOES_NOT_MATCH_BYTES');
});
test('original source missing blocks',()=>{
 const x=args();x.sourceBytes='not a file';
 assert.equal(runMockPanel(x).reason,'SOURCE_BYTES_MISSING_OR_TOO_LARGE');
});
test('malformed json blocks',()=>{
 const x=args();x.sourceBytes=Buffer.from('{');
 assert.equal(runMockPanel(x).reason,'SOURCE_LOCK_JSON_INVALID');
});
test('unrecognized panel blocked',()=>{
 const x=args();x.panelId=7;
 assert.equal(runMockPanel(x).reason,'INVALID_PANEL_ID');
});
test('blank prompt blocked',()=>{
 const x=args();x.prompt=' ';
 assert.equal(runMockPanel(x).reason,'PROMPT_MISSING');
});
test('same input same hash, no redundant retries',()=>{
 const first=runMockPanel(args());
 const x=args();x.history=[failed(first)];x.fix=fix(first);
 const r=runMockPanel(x);
 assert.equal(r.status,'BLOCKED');
 assert.equal(r.reason,'RETRY_OR_APPROVAL_GUARD');
 assert(r.retry.issues.some(i=>i.code==='DUPLICATE_INPUT'));
});
test('changed prompt changes input hash, passes preflight but mock output is duplicate',()=>{
 const first=runMockPanel(args());
 const x=args();x.history=[failed(first)];x.fix=fix(first);
 x.prompt='第6コマの吹き出しを顔にかぶせない';
 const r=runMockPanel(x);
 assert.equal(r.status,'MOCK_ONLY_NOT_ART');
 assert.notEqual(r.inputSha256,first.inputSha256);
 assert.equal(r.preflight.status,'REVIEW_REQUIRED');
 assert(r.resultQa.issues.some(i=>i.code==='REPEATED_IMAGE'));
});
test('retry with no root-cause and no fix blocks',()=>{
 const first=runMockPanel(args());
 const x=args();x.history=[failed(first)];
 x.prompt='新しい絵';
 const r=runMockPanel(x);
 assert.equal(r.reason,'RETRY_OR_APPROVAL_GUARD');
});
test('approved P08 protected even on initial attempt',()=>{
 const x=args();x.approvedAssets=[{pageId:'CH04_P10',panelId:null}];
 assert.equal(runMockPanel(x).reason,'RETRY_OR_APPROVAL_GUARD');
});
test('analysis intent never reaches render',()=>{
 const x=args();x.intent='critique';
 assert.equal(runMockPanel(x).reason,'RETRY_OR_APPROVAL_GUARD');
});
test('real or provider mode refused without explicit integration',()=>{
 const x=args();x.renderMode='openart';
 assert.equal(runMockPanel(x).reason,'PAID_OR_UNKNOWN_PROVIDER_DISABLED');
 assert.equal(runMockPanel(x).providerCalled,false);
});
test('reversed storyboard order is stopped',()=>{
 const x=args();x.plan={...plan,storyboard:plan.storyboard.slice().reverse()};
 assert.equal(runMockPanel(x).reason,'PAGE_PREFLIGHT_BLOCKED');
});
test('missing storyboard is stopped',()=>{
 const x=args();x.plan={...plan,storyboard:[]};
 assert.equal(runMockPanel(x).reason,'PAGE_PREFLIGHT_BLOCKED');
});
test('source SHA is computed, not accepted from caller',()=>{
 const x=args();x.plan={...plan,sourceLockSha256:'b'.repeat(64)};
 assert.equal(runMockPanel(x).reason,'LOCK_DOES_NOT_MATCH_BYTES');
});
test('PNG dimensions validated from bytes',()=>{
 assert.deepEqual({width:inspectPng(png).width,height:inspectPng(png).height},{width:1,height:1});
 assert.throws(()=>inspectPng(Buffer.alloc(80,0)),/ONLY_PNG_SUPPORTED/);
});

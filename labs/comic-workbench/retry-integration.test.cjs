'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validatePlan}=require('./page-gate.cjs');
const h=x=>x.repeat(64);
const sha=h('a');
const lock={pageId:'CH04_P10',sha256:sha,panels:[
 {panel:1,position:'右上',lines:[]},{panel:2,position:'左上',lines:[]},
 {panel:3,position:'右中',lines:[]},{panel:4,position:'左中',lines:[]},
 {panel:5,position:'右下',lines:[]},{panel:6,position:'左下',lines:[]}
]};
const plan=()=>({
 pageId:lock.pageId,sourceLockSha256:sha,
 requiredCharacterIds:['K','M'],
 masterReferences:['K','M'].map(characterId=>({characterId,sha256:sha,fileAccessible:true,hashMatched:true,suppliedToGenerator:true})),
 storyboard:lock.panels.map((x,i)=>({panel:x.panel,position:x.position,
  camera:['wide','close','medium','two-shot','over-shoulder','detail'][i],
  emotion:i===5?'hope':'worry'})),
 previousFailedCandidate:true, fix:{
  failureCode:'BUBBLE_OVERLAP',rootCause:'吹き出し二重線',
  changedElement:'コマ6のみ',measurableAcceptanceCriterion:'輪郭線が一本'
 }
});
const failed={pageId:'CH04_P10',panelId:6,status:'FAILED',sourceLockSha256:sha,
 inputSha256:h('b'),outputSha256:h('c'),defects:['BUBBLE_OVERLAP']};
const evidence=()=>({
 panelId:6,approvedAssets:[],history:[failed],proposedInputSha256:h('d'),
 fix:{defectCode:'BUBBLE_OVERLAP',rootCause:'二重描画が原因',
 changedElement:'旧吹き出しレイヤーだけ除去',expectedDifference:'一本線のみ',
 verificationMethod:'実画像をスマホ表示で比較',previousOutputSha256:h('c'),patchScope:'CH04_P10:C06'}
});
const codes=r=>r.issues.map(x=>x.code);
test('existing generation plan blocks undocumented retry',()=>{
 const r=validatePlan({intent:'generate',plan:plan(),lock});
 assert.equal(r.status,'BLOCKED');
 assert(codes(r).includes('RETRY_INVALID_TARGET'));
});
test('valid targeted retry can reach editorial review, never approval',()=>{
 const p=plan();p.retryEvidence=evidence();
 const r=validatePlan({intent:'generate',plan:p,lock});
 assert.equal(r.status,'REVIEW_REQUIRED');
 assert.equal(r.publicationApproved,false);
});
test('no changes to input blocks even with a prose explanation',()=>{
 const p=plan();p.retryEvidence={...evidence(),proposedInputSha256:h('b')};
 const r=validatePlan({intent:'generate',plan:p,lock});
 assert.equal(r.status,'BLOCKED');
 assert(codes(r).includes('RETRY_DUPLICATE_INPUT'));
});
test('approved source page blocks retry as configured',()=>{
 const p=plan();p.retryEvidence={...evidence(),approvedAssets:[{pageId:'CH04_P10',panelId:null}]};
 const r=validatePlan({intent:'generate',plan:p,lock});
 assert.equal(r.status,'BLOCKED');
 assert(codes(r).includes('RETRY_APPROVED_ART_PROTECTED'));
});
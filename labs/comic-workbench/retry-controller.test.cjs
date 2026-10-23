'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessRetry,assessResult,nextCorrection}=require('./retry-controller.cjs');
const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64),d='d'.repeat(64);
const base={intent:'generate',pageId:'CH04_P10',panelId:6,sourceLockSha256:a,approvedAssets:[],history:[],proposedInputSha256:b};
const failed={pageId:'CH04_P10',panelId:6,status:'FAILED',sourceLockSha256:a,inputSha256:b,outputSha256:c,defects:['BUBBLE_OVERLAP']};
const fix={defectCode:'BUBBLE_OVERLAP',rootCause:'吹き出しの重ね描き',
 changedElement:'文字レイヤーのみ入れ替え',expectedDifference:'輪郭が1本、人物の顔を隠さない',
 verificationMethod:'実画像をスマホ表示で独立確認',previousOutputSha256:c,patchScope:'CH04_P10:C06'};
const codes=r=>r.issues.map(x=>x.code);
test('valid initial trial is bounded, not approved',()=>{
 const r=assessRetry(base);assert.equal(r.status,'SINGLE_TRIAL_ALLOWED');
 assert.equal(r.artApproved,false);
});
test('review does not start image generation',()=>{
 assert(codes(assessRetry({...base,intent:'review'})).includes('NOT_GENERATION_INTENT'));
});
test('missing source lock stops',()=>{
 assert(codes(assessRetry({...base,sourceLockSha256:undefined})).includes('SOURCE_LOCK_UNKNOWN'));
});
test('invalid panel stops',()=>{
 assert(codes(assessRetry({...base,panelId:7})).includes('INVALID_TARGET'));
});
test('approved P08 protected',()=>{
 const r=assessRetry({...base,pageId:'CH04_P08',approvedAssets:[{pageId:'CH04_P08',panelId:null}]});
 assert(codes(r).includes('APPROVED_ART_PROTECTED'));
});
test('already approved panel protected',()=>{
 assert(codes(assessRetry({...base,approvedAssets:[{pageId:'CH04_P10',panelId:6}]})).includes('APPROVED_ART_PROTECTED'));
});
test('same input does not pass retry',()=>{
 assert(codes(assessRetry({...base,history:[failed],fix})).includes('DUPLICATE_INPUT'));
});
test('no documented failure code stops',()=>{
 assert(codes(assessRetry({...base,history:[failed],proposedInputSha256:d})).includes('UNCLASSIFIED_DEFECT'));
});
test('no root cause stops',()=>{
 assert(codes(assessRetry({...base,history:[failed],proposedInputSha256:d,fix:{...fix,rootCause:''}})).includes('MISSING_ROOTCAUSE'));
});
test('stale failed image hash stops',()=>{
 assert(codes(assessRetry({...base,history:[failed],proposedInputSha256:d,fix:{...fix,previousOutputSha256:b}})).includes('STALE_FAILURE_LINK'));
});
test('wrong defect cannot be patched',()=>{
 assert(codes(assessRetry({...base,history:[failed],proposedInputSha256:d,fix:{...fix,defectCode:'RESOLUTION'}})).includes('WRONG_DEFECT_TARGET'));
});
test('whole page retake is not allowed',()=>{
 assert(codes(assessRetry({...base,history:[failed],proposedInputSha256:d,fix:{...fix,patchScope:'CH04_P10:ALL'}})).includes('SCOPE_NOT_LOCAL'));
});
test('specific improved input allows one trial not approval',()=>{
 const r=assessRetry({...base,history:[failed],proposedInputSha256:d,fix});
 assert.equal(r.status,'SINGLE_TRIAL_ALLOWED');assert.equal(r.publicationApproved,false);
});
test('two attempts hard stop',()=>{
 const h=[failed,{...failed,inputSha256:d,outputSha256:b}];
 assert(codes(assessRetry({...base,history:h,proposedInputSha256:a,fix:{...fix,previousOutputSha256:b}})).includes('PANEL_ATTEMPT_CAP'));
});
test('page cap eight',()=>{
 const h=Array.from({length:8},(_,i)=>({...failed,panelId:i%6+1,inputSha256:c,outputSha256:d}));
 assert(codes(assessRetry({...base,history:h,proposedInputSha256:a,fix})).includes('PAGE_ATTEMPT_CAP'));
});
test('source version mismatch invalidates history',()=>{
 assert(codes(assessRetry({...base,history:[{...failed,sourceLockSha256:d}],proposedInputSha256:d,fix})).includes('SOURCE_CHANGED'));
});
test('candidate below 2048x3072 fails',()=>{
 const r=assessResult({sourceLockSha256:a,candidate:{sourceLockSha256:a,inputSha256:b,outputSha256:c,width:1024,height:1536},verifiedQA:{inspectedOutputSha256:c,defects:[{code:'BUBBLE_OVERLAP'}]}});
 assert.equal(r.status,'FAILED_QA');assert(codes(r).includes('LOW_RES'));
});
test('stale review invalid',()=>{
 const r=assessResult({sourceLockSha256:a,candidate:{sourceLockSha256:a,inputSha256:b,outputSha256:c,width:2048,height:3072},verifiedQA:{inspectedOutputSha256:d,defects:[],masterVisualMatch:true,bubbleTailsCorrect:true,correctPanelOrder:true,independentReadbackMatches:true}});
 assert(codes(r).includes('STALE_QA'));
});
test('duplicate output is not progress',()=>{
 const r=assessResult({sourceLockSha256:a,history:[{outputSha256:c}],candidate:{sourceLockSha256:a,inputSha256:b,outputSha256:c,width:2048,height:3072},verifiedQA:{inspectedOutputSha256:c,defects:[],masterVisualMatch:true,bubbleTailsCorrect:true,correctPanelOrder:true,independentReadbackMatches:true}});
 assert(codes(r).includes('REPEATED_IMAGE'));
});
test('even clear scan requires real editorial approval',()=>{
 const r=assessResult({sourceLockSha256:a,candidate:{sourceLockSha256:a,inputSha256:b,outputSha256:c,width:2048,height:3072},verifiedQA:{inspectedOutputSha256:c,defects:[],masterVisualMatch:true,bubbleTailsCorrect:true,correctPanelOrder:true,independentReadbackMatches:true}});
 assert.equal(r.status,'REVIEW_REQUIRED');assert.equal(r.artApproved,false);
});
test('authority errors prioritized',()=>{
 assert.equal(nextCorrection([{code:'BUBBLE_OVERLAP'},{code:'WRONG_SOURCE_MASTER'}]).defect.code,'WRONG_SOURCE_MASTER');
});
test('unclassified issue stays HOLD',()=>{
 assert.equal(nextCorrection([{code:'UNEXPECTED'}]).status,'HOLD');
});
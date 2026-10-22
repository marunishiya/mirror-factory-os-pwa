'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validatePlan,validateCandidate}=require('./page-gate.cjs');
const h='a'.repeat(64);
const lock={pageId:'fictional',sha256:h,panels:[
  {panel:1,position:'右上',lines:[{speaker:'A',text:'一。'}]},
  {panel:2,position:'左上',lines:[{speaker:'B',text:'二。'}]},
  {panel:3,position:'右中',lines:[{speaker:'A',text:'三。'}]},
  {panel:4,position:'左中',lines:[{speaker:'B',text:'四。'}]},
  {panel:5,position:'右下',lines:[{speaker:'A',text:'五。'}]},
  {panel:6,position:'左下',lines:[{speaker:'B',text:'六。'}]}
]};
const plan=()=>({
 pageId:'fictional',sourceLockSha256:h,requiredCharacterIds:['A','B'],
 masterReferences:[
  {characterId:'A',sha256:h,fileAccessible:true,hashMatched:true,suppliedToGenerator:true},
  {characterId:'B',sha256:h,fileAccessible:true,hashMatched:true,suppliedToGenerator:true}],
 storyboard:lock.panels.map((p,i)=>({panel:p.panel,position:p.position,
   camera:['wide','close','medium','profile','two-shot','detail'][i],
   emotion:i===5?'relief':'shock'}))
});
const candidate=()=>({pageId:'fictional',sha256:h,width:2048,height:3072,renderProvenance:'native-render'});
const review=()=>({
 observedPanels:JSON.parse(JSON.stringify(lock.panels)),
 masterImageSideBySideConfirmed:true,speechBubbleTailsConfirmed:true,
 smartphoneLegibilityConfirmed:true,editorialStoryConfirmed:true,
 freshForImageSha256:h
});
const codes=r=>r.issues.map(x=>x.code);
test('critique requests never trigger generation',()=>{
 assert(codes(validatePlan({intent:'evaluate',plan:plan(),lock})).includes('INTENT_NOT_GENERATION'));
});
test('missing MASTER image blocks generation',()=>{
 const p=plan();p.masterReferences[0].fileAccessible=false;
 assert(codes(validatePlan({intent:'generate',plan:p,lock})).includes('MASTER_NOT_LOADED'));
});
test('wrong page-lock fingerprint blocks',()=>{
 const p=plan();p.sourceLockSha256='b'.repeat(64);
 assert(codes(validatePlan({intent:'generate',plan:p,lock})).includes('SOURCE_LOCK_NOT_BOUND'));
});
test('missing camera staging blocks',()=>{
 const p=plan();p.storyboard[0].camera='';
 assert(codes(validatePlan({intent:'generate',plan:p,lock})).includes('STORYBOARD_INCOMPLETE'));
});
test('same camera in every panel blocks',()=>{
 const p=plan();p.storyboard.forEach(x=>x.camera='same');
 assert(codes(validatePlan({intent:'generate',plan:p,lock})).includes('STAGING_REPEAT_RISK'));
});
test('no emotional transition blocks',()=>{
 const p=plan();p.storyboard[5].emotion='shock';
 assert(codes(validatePlan({intent:'generate',plan:p,lock})).includes('EMOTION_ARC_UNDOCUMENTED'));
});
test('retry without diagnosis blocks',()=>{
 const p=plan();p.previousFailedCandidate=true;
 assert(codes(validatePlan({intent:'generate',plan:p,lock})).includes('RETRY_WITHOUT_DIAGNOSIS'));
});
test('failed artwork may not become only authority',()=>{
 const p=plan();p.previousFailedCandidate=true;p.referenceStrategy='failed-image-only';
 assert(codes(validatePlan({intent:'generate',plan:p,lock})).includes('FAILED_IMAGE_AS_AUTHORITY'));
});
test('even complete plan is only review-ready',()=>{
 const r=validatePlan({intent:'generate',plan:plan(),lock});
 assert.equal(r.status,'REVIEW_REQUIRED');assert.equal(r.canonApproved,false);
});
test('1024x1536 pixels always fails',()=>{
 const c=candidate();c.width=1024;c.height=1536;
 assert(codes(validateCandidate({lock,candidate:c,review:review()})).includes('LOW_RESOLUTION'));
});
test('upscaled-only does not satisfy native image',()=>{
 const c=candidate();c.renderProvenance='upscaled-only';
 assert(codes(validateCandidate({lock,candidate:c,review:review()})).includes('HIGH_RES_SOURCE_UNKNOWN'));
});
test('missing image transcription blocks',()=>{
 const r=review();delete r.observedPanels;
 assert(codes(validateCandidate({lock,candidate:candidate(),review:r})).includes('IMAGE_TRANSCRIPT_NOT_CHECKED'));
});
test('a one-character change blocks',()=>{
 const r=review();r.observedPanels[3].lines[0].text='四';
 assert(codes(validateCandidate({lock,candidate:candidate(),review:r})).includes('DIALOGUE_OR_POSITION_MISMATCH'));
});
test('reversed speaker blocks',()=>{
 const r=review();r.observedPanels[4].lines[0].speaker='B';
 assert(codes(validateCandidate({lock,candidate:candidate(),review:r})).includes('DIALOGUE_OR_POSITION_MISMATCH'));
});
test('reversed panel positions block',()=>{
 const r=review();[r.observedPanels[0],r.observedPanels[1]]=[r.observedPanels[1],r.observedPanels[0]];
 assert(codes(validateCandidate({lock,candidate:candidate(),review:r})).includes('DIALOGUE_OR_POSITION_MISMATCH'));
});
test('stale image review blocks',()=>{
 const r=review();r.freshForImageSha256='b'.repeat(64);
 assert(codes(validateCandidate({lock,candidate:candidate(),review:r})).includes('STALE_QA'));
});
test('missing editorial review blocks',()=>{
 const r=review();r.editorialStoryConfirmed=false;
 assert(codes(validateCandidate({lock,candidate:candidate(),review:r})).includes('EDITORIAL_REVIEW_UNCHECKED'));
});
test('candidate never auto-approves Canon or publication',()=>{
 const r=validateCandidate({lock,candidate:candidate(),review:review()});
 assert.equal(r.status,'REVIEW_REQUIRED');assert.equal(r.canonApproved,false);
 assert.equal(r.publicationApproved,false);
});
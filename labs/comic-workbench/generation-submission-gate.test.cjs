'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateGenerationSubmission,digest}=require('./generation-submission-gate.cjs');
const hash='a'.repeat(64);
const positions=['右上','左上','右中','左中','右下','左下'];
// Fictional figures and generic room scene only. No unpublished MIRROR assets in git.
const lock={pageId:'DEMO-CH00-P01',sha256:hash,panels:positions.map((position,i)=>({panel:i+1,position,lines:[]}))};
const plan=()=>({pageId:lock.pageId,sourceLockSha256:hash,
 requiredCharacterIds:['demo-A'],
 masterReferences:[{characterId:'demo-A',sha256:hash,fileAccessible:true,hashMatched:true,suppliedToGenerator:true}],
 storyboard:positions.map((position,i)=>({panel:i+1,position,camera:['full','close','side','medium','over-shoulder','detail'][i],emotion:i===5?'hope':'hesitation'}))});
const good='1枚の縦長イラスト。文字なし。枠線なし。分割なし。自室でスマホを見つめる架空の人物。';
const promptLock=()=>({pageId:lock.pageId,sourceLockSha256:hash,panel:1,position:'右上',
 outputMode:'single-text-free-illustration',approvedPrompt:good,approvedPromptSha256:digest(good),
 requiredPhrases:['自室','スマホ'],forbiddenPhrases:['面接','不採用','6コマ','six-panel','job rejection'],attemptNumber:1});
const transport=()=>({exactPromptSupported:true,effectivePromptSource:'actual_outbound_request',effectivePrompt:good});
const run=(changes={})=>validateGenerationSubmission({intent:'generate',plan:plan(),lock,promptLock:promptLock(),transport:transport(),...changes});
const codes=x=>x.issues.map(i=>i.code);

test('safe-looking submission is REVIEW_REQUIRED, never publishable',()=>{
 const r=run();assert.equal(r.status,'REVIEW_REQUIRED');assert.equal(r.canonApproved,false);assert.equal(r.imageCreated,false);
});
test('uncontrolled provider must fail closed',()=>{
 assert(codes(run({transport:{...transport(),exactPromptSupported:false}})).includes('OPAQUE_PROVIDER_BLOCKED'));
});
test('draft prompt cannot impersonate real outbound request',()=>{
 assert(codes(run({transport:{...transport(),effectivePromptSource:'local_draft'}})).includes('OPAQUE_PROVIDER_BLOCKED'));
});
test('unknown effective prompt blocks',()=>{
 assert(codes(run({transport:{exactPromptSupported:true,effectivePromptSource:'actual_outbound_request'}})).includes('EFFECTIVE_PROMPT_UNAVAILABLE'));
});
test('legacy job rejection instruction does not pass',()=>{
 const old='A six-panel manga page about job rejection at an interview.';
 const r=run({transport:{...transport(),effectivePrompt:old}});
 assert(codes(r).includes('EFFECTIVE_PROMPT_MISMATCH'));
});
test('script topic contamination blocks before submission',()=>{
 const p=promptLock();p.approvedPrompt=good+' 面接の不採用を振り返る。';p.approvedPromptSha256=digest(p.approvedPrompt);
 const r=run({promptLock:p,transport:{...transport(),effectivePrompt:p.approvedPrompt}});
 assert(codes(r).includes('FOREIGN_SCENE_CONTAMINATION'));
});
test('missing required scene blocks',()=>{
 const p=promptLock();p.approvedPrompt=good.replace('スマホ','手紙');p.approvedPromptSha256=digest(p.approvedPrompt);
 const r=run({promptLock:p,transport:{...transport(),effectivePrompt:p.approvedPrompt}});
 assert(codes(r).includes('REQUIRED_SCENE_MISSING'));
});
test('tampered approved prompt hash blocks',()=>{
 const p=promptLock();p.approvedPromptSha256='b'.repeat(64);
 assert(codes(run({promptLock:p})).includes('PROMPT_HASH_MISMATCH'));
});
test('wrong page id cannot be used',()=>{
 const p=promptLock();p.pageId='DEMO-CH00-P02';
 assert(codes(run({promptLock:p})).includes('PROMPT_LOCK_MISMATCH'));
});
test('wrong panel/read order blocks',()=>{
 const p=promptLock();p.panel=2;
 assert(codes(run({promptLock:p})).includes('PANEL_OR_ORDER_MISMATCH'));
});
test('third generation attempt cannot be authorized',()=>{
 const p=promptLock();p.attemptNumber=3;
 assert(codes(run({promptLock:p})).includes('GENERATION_RETRY_LIMIT'));
});
test('approval cannot bypass missing MASTER evidence',()=>{
 const p=plan();p.masterReferences[0].fileAccessible=false;
 assert(codes(run({plan:p})).includes('PLAN_MASTER_NOT_LOADED'));
});
test('review request should not auto-generate',()=>{
 assert(codes(run({intent:'evaluate'})).includes('PLAN_INTENT_NOT_GENERATION'));
});
test('multi-panel output mode blocks',()=>{
 const p=promptLock();p.outputMode='full-page';
 assert(codes(run({promptLock:p})).includes('INVALID_OUTPUT_MODE'));
});
test('empty required scenes blocks',()=>{
 const p=promptLock();p.requiredPhrases=[];
 assert(codes(run({promptLock:p})).includes('REQUIRED_SCENES_UNSET'));
});
test('empty forbidden scenes blocks',()=>{
 const p=promptLock();p.forbiddenPhrases=[];
 assert(codes(run({promptLock:p})).includes('FORBIDDEN_SCENES_UNSET'));
});

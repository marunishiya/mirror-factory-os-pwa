'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateStoryContinuity}=require('./story-continuity-gate.cjs');
const {validateStoryAndPagePlan}=require('./story-page-preflight.cjs');
const pos=i=>({number:i,row:Math.floor((i-1)/2)+1,col:i%2?'right':'left'});
const sha='a'.repeat(64),master='b'.repeat(64);
function fixture(){
 const panels=Array.from({length:6},(_,i)=>({
   ...pos(i+1),minute:100+i,present:['KENTA'],
   location:'EXHIBIT',dialogue:[],events:[],objects:[]
 }));
 return {referenceYear:2026,sourceLockSha256:sha,
   characters:{KENTA:{surname:'山田',ageAtReferenceYear:43},
     REINA:{surname:'神崎',ageAtReferenceYear:30},
     KANA:{surname:'久住',ageAtReferenceYear:17}},
   initialKnowledge:{KENTA:[],REINA:[],KANA:[]},
   initialLocations:{KENTA:'EXHIBIT',REINA:'BACKSTAGE',KANA:'BACKSTAGE'},
   initialObjects:{LEASH:{state:'held',holder:'KANA'}},
   objectCanon:{LEASH:{color:'red'}},approvedHistoryIds:[],initialEvents:[],
   pages:[{id:'CH03-P02',panels}]};
}
const codes=b=>validateStoryContinuity(b).issues.map(x=>x.code);
function args(b=fixture()){
 const lock={pageId:'CH03-P02',sha256:sha,
   panels:Array.from({length:6},(_,i)=>({panel:i+1,position:'p'+(i+1),lines:[]}))};
 const plan={pageId:lock.pageId,sourceLockSha256:sha,
   requiredCharacterIds:['KENTA'],
   masterReferences:[{characterId:'KENTA',sha256:master,
     fileAccessible:true,hashMatched:true,suppliedToGenerator:true}],
   storyboard:lock.panels.map((p,i)=>({panel:p.panel,position:p.position,
     camera:['wide','medium','close'][i%3],emotion:i===0?'curiosity':'discovery'}))};
 return {storyBook:b,intent:'generate',lock,plan};
}
test('valid structured story remains REVIEW_REQUIRED, never publish pass',()=>{
 const r=validateStoryContinuity(fixture());
 assert.equal(r.status,'REVIEW_REQUIRED');assert.equal(r.canonApproved,false);
});
test('right-to-left six panels and eight panels',()=>{
 let b=fixture();b.pages[0].panels=Array.from({length:8},(_,i)=>({
  ...pos(i+1),minute:100+i,present:['KENTA'],location:'EXHIBIT',dialogue:[]}));
 assert.equal(validateStoryContinuity(b).status,'REVIEW_REQUIRED');
});
test('reading order inversion blocks',()=>{
 const b=fixture();b.pages[0].panels[0].col='left';
 assert.ok(codes(b).includes('READING_ORDER'));
});
test('a surname before knowledge acquisition blocks',()=>{
 const b=fixture();b.pages[0].panels[1].dialogue=[{speaker:'KENTA',text:'神崎さん？',tailTo:'KENTA'}];
 assert.ok(codes(b).includes('KNOWLEDGE_LEAK'));
});
test('documented earlier introduction unlocks later dialogue only',()=>{
 const b=fixture();b.pages[0].panels[0].learns=[{who:'KENTA',fact:'name:REINA',
  source:'自己紹介',evidence:'1コマ前の吹き出し'}];
 b.pages[0].panels[1].dialogue=[{speaker:'KENTA',text:'神崎さん',tailTo:'KENTA'}];
 assert.equal(codes(b).includes('KNOWLEDGE_LEAK'),false);
});
test('knowledge without documented evidence blocks',()=>{
 const b=fixture();b.pages[0].panels[1].learns=[{who:'KENTA',fact:'name:REINA'}];
 assert.ok(codes(b).includes('KNOWLEDGE_SOURCE_MISSING'));
});
test('historical photo with unapproved date and implausible age blocks twice',()=>{
 const b=fixture();b.pages[0].panels[1].history=[{id:'RAIN_2008',person:'REINA',year:2008,minAge:18}];
 assert.ok(codes(b).includes('AGE_CONFLICT'));assert.ok(codes(b).includes('UNAPPROVED_HISTORY'));
});
test('unexplained arrival blocks; documented arrival passes',()=>{
 const b=fixture();b.pages[0].panels[1].location='BACKSTAGE';
 assert.ok(codes(b).includes('UNEXPLAINED_ARRIVAL'));
 b.pages[0].panels[1].arrivals={KENTA:{from:'EXHIBIT',reason:'見学後に会場を歩く'}};
 assert.equal(codes(b).includes('UNEXPLAINED_ARRIVAL'),false);
});
test('leash color changes are rejected',()=>{
 const b=fixture();b.pages[0].panels[1].objects=[{id:'LEASH',color:'blue',state:'held',holder:'KANA'}];
 assert.ok(codes(b).includes('OBJECT_COLOR_DRIFT'));
});
test('leash slipping without cause blocks',()=>{
 const b=fixture();b.pages[0].panels[2].objects=[{id:'LEASH',color:'red',state:'trailing',holder:'NONE'}];
 assert.ok(codes(b).includes('UNEXPLAINED_OBJECT_CHANGE'));
});
test('recording a cause for prop change is structurally accepted',()=>{
 const b=fixture();b.pages[0].panels[2].objects=[{id:'LEASH',color:'red',state:'trailing',holder:'NONE',
   changeCause:'突然の音響チェックで犬が驚き、奏の手からリードが抜ける'}];
 assert.equal(codes(b).includes('UNEXPLAINED_OBJECT_CHANGE'),false);
});
test('plot effect before recorded trigger blocks',()=>{
 const b=fixture();b.pages[0].panels[3].events=[{id:'DOG_ESCAPE',dependsOn:['SOUND_CHECK']}];
 assert.ok(codes(b).includes('MISSING_CAUSE'));
});
test('speaker mismatch and tail mismatch are caught',()=>{
 const b=fixture();b.pages[0].panels[1].dialogue=[{speaker:'REINA',text:'待って',tailTo:'KENTA'}];
 assert.ok(codes(b).includes('SPEAKER_NOT_PRESENT'));assert.ok(codes(b).includes('TAIL_METADATA_MISMATCH'));
});
test('duplicate event and page regression are rejected',()=>{
 const b=fixture();b.pages[0].panels[0].events=[{id:'A'}];
 b.pages[0].panels[2].events=[{id:'A'}];
 assert.ok(codes(b).includes('EVENT_DUPLICATE'));
 const copy=structuredClone(b.pages[0]);copy.id='CH03-P01';b.pages.push(copy);
 assert.ok(codes(b).includes('PAGE_SEQUENCE'));
});
test('valid story + page evidence returns REVIEW_REQUIRED only',()=>{
 const r=validateStoryAndPagePlan(args());
 assert.equal(r.status,'REVIEW_REQUIRED');assert.equal(r.generatorInvocationControlled,false);
});
test('story failure blocks existing generation preflight',()=>{
 const a=args();a.storyBook.pages[0].panels[1].dialogue=[{speaker:'KENTA',text:'神崎さん'}];
 const r=validateStoryAndPagePlan(a);
 assert.equal(r.status,'BLOCKED');assert.ok(r.issues.some(x=>x.code==='KNOWLEDGE_LEAK'));
});
test('page failure blocks even when story is valid',()=>{
 const a=args();a.plan.masterReferences=[];
 const r=validateStoryAndPagePlan(a);
 assert.equal(r.status,'BLOCKED');assert.ok(r.issues.some(x=>x.code==='MASTER_NOT_LOADED'));
});
test('wrong page or missing story SOURCE LOCK fails closed',()=>{
 const a=args();a.storyBook.sourceLockSha256='c'.repeat(64);a.lock.pageId='CH03-P03';
 const r=validateStoryAndPagePlan(a);
 assert.ok(r.issues.some(x=>x.code==='STORY_SOURCE_NOT_BOUND'));
 assert.ok(r.issues.some(x=>x.code==='STORY_PAGE_NOT_LOCKED'));
});

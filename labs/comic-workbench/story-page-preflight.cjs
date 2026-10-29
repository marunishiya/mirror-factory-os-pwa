'use strict';
// Combines story rules with existing PR #8 plan evidence gate.
// This does NOT hook or intercept the ChatGPT image generator.
const {validateStoryContinuity}=require('./story-continuity-gate.cjs');
const {validatePlan}=require('./page-gate.cjs');
function validateStoryAndPagePlan({storyBook,intent,plan,lock}={}){
  const story=validateStoryContinuity(storyBook);
  const page=validatePlan({intent,plan,lock});
  const issues=[...story.issues.map(x=>({...x,origin:'story'})),
                ...page.issues.map(x=>({...x,origin:'page'}))];
  const requested=lock?.pageId;
  if(!requested||!storyBook?.pages?.some(p=>p.id===requested))
    issues.push({origin:'story',code:'STORY_PAGE_NOT_LOCKED',
                 where:requested||'unknown',detail:'対象ページの物語台帳がない'});
  if(storyBook?.sourceLockSha256!==lock?.sha256||
     !/^[a-f0-9]{64}$/i.test(storyBook?.sourceLockSha256||''))
    issues.push({origin:'story',code:'STORY_SOURCE_NOT_BOUND',
                 where:requested||'unknown',detail:'物語台帳とSOURCE LOCKが一致しない'});
  return {stage:'COMBINED_PRE_GENERATION',
    status:issues.length?'BLOCKED':'REVIEW_REQUIRED',issues,
    storyStatus:story.status,pageStatus:page.status,
    visualIdentityVerified:false,canonApproved:false,publicationApproved:false,
    generatorInvocationControlled:false,
    note:'既存PAGE GATEと物語整合性の両方が揃うまで停止する判定API。画像生成の実呼出しには未接続。'};
}
module.exports={validateStoryAndPagePlan};
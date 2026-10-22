'use strict';
// Experimental fail-closed evidence gate. No generator calls, OCR, or face detection.
const HEX=/^[a-f0-9]{64}$/i;
const hash=x=>typeof x==='string'&&HEX.test(x);
const nonempty=x=>typeof x==='string'&&x.trim().length>0;
const add=(issues,code,message)=>issues.push({code,message});
const verdict=(stage,issues)=>({
  stage,status:issues.length?'BLOCKED':'REVIEW_REQUIRED',issues,
  visualIdentityVerified:false,canonApproved:false,publicationApproved:false,
  note:'形式上の必須証拠ゲート。人物同一性・演出・可読性・Canonを自動承認しない。'
});
function validatePlan({intent,plan,lock}={}){
  const issues=[];
  if(!['generate','edit'].includes(intent))
    add(issues,'INTENT_NOT_GENERATION','批評・確認依頼なら画像生成しない');
  if(!lock||!nonempty(lock.pageId)||!Array.isArray(lock.panels)||!lock.panels.length||
      lock.panels.some(p=>!Number.isInteger(p.panel)||!nonempty(p.position)||!Array.isArray(p.lines)))
    add(issues,'SOURCE_LOCK_MISSING','ページ原稿・コマ位置が未登録');
  if(!plan||plan.pageId!==lock?.pageId||!hash(lock?.sha256)||
     !hash(plan?.sourceLockSha256)||plan.sourceLockSha256!==lock.sha256)
    add(issues,'SOURCE_LOCK_NOT_BOUND','原稿と計画のSHA-256の紐付けが未確認');
  const required=Array.isArray(plan?.requiredCharacterIds)?plan.requiredCharacterIds:[];
  if(!required.length)add(issues,'REQUIRED_CHARACTERS_UNKNOWN','必要人物が未登録');
  const refs=Array.isArray(plan?.masterReferences)?plan.masterReferences:[];
  for(const id of required){
    const r=refs.find(x=>x?.characterId===id);
    if(!r||!hash(r.sha256)||r.fileAccessible!==true||
       r.hashMatched!==true||r.suppliedToGenerator!==true)
      add(issues,'MASTER_NOT_LOADED',id+': 実MASTER/ハッシュ照合/生成参照が未確認');
  }
  const scenes=Array.isArray(plan?.storyboard)?plan.storyboard:[];
  if(lock?.panels?.length&&(scenes.length!==lock.panels.length||
    scenes.some((x,i)=>x?.panel!==lock.panels[i].panel||
       x.position!==lock.panels[i].position||
       !nonempty(x.camera)||!nonempty(x.emotion))))
    add(issues,'STORYBOARD_INCOMPLETE','読書順・画角・感情設計が不十分');
  else if(scenes.length>1){
    if(new Set(scenes.map(x=>x.camera)).size<3)
      add(issues,'STAGING_REPEAT_RISK','画角に変化が乏しい');
    if(scenes[0].emotion===scenes[scenes.length-1].emotion)
      add(issues,'EMOTION_ARC_UNDOCUMENTED','感情の変化が記録されていない');
  }
  if(plan?.previousFailedCandidate){
    const f=plan.fix;
    if(!f||!nonempty(f.failureCode)||!nonempty(f.rootCause)||
       !nonempty(f.changedElement)||!nonempty(f.measurableAcceptanceCriterion))
      add(issues,'RETRY_WITHOUT_DIAGNOSIS','原因と変更点がない再生成を禁止');
    if(plan.referenceStrategy==='failed-image-only')
      add(issues,'FAILED_IMAGE_AS_AUTHORITY','不合格画像を唯一の参照にしない');
  }
  return verdict('PRE_GENERATION',issues);
}
function validateCandidate({lock,candidate,review}={}){
  const issues=[];
  if(!hash(candidate?.sha256))
    add(issues,'IMAGE_FINGERPRINT_MISSING','画像SHA-256が不明');
  if(!Number.isInteger(candidate?.width)||!Number.isInteger(candidate?.height)||
    candidate.width<2048||candidate.height<3072||
    Math.abs(candidate.width/candidate.height-2/3)>.002)
    add(issues,'LOW_RESOLUTION','2048x3072/2:3未達');
  if(!nonempty(candidate?.renderProvenance)||
     ['unknown','upscaled-only'].includes(candidate.renderProvenance))
    add(issues,'HIGH_RES_SOURCE_UNKNOWN','高精細の原画由来が不明');
  if(lock&&candidate?.pageId!==lock.pageId)
    add(issues,'PAGE_ID_MISMATCH','ページID不一致');
  const seen=review?.observedPanels;
  if(!Array.isArray(seen)||!lock?.panels||seen.length!==lock.panels.length)
    add(issues,'IMAGE_TRANSCRIPT_NOT_CHECKED','実画像から独立転記されたコマ・文字・話者がない');
  else for(let i=0;i<lock.panels.length;i++){
    const expected=lock.panels[i],p=seen[i];
    if(!p||p.panel!==expected.panel||p.position!==expected.position||
      !Array.isArray(p.lines)||p.lines.length!==expected.lines.length||
      p.lines.some((l,j)=>l?.speaker!==expected.lines[j].speaker||l?.text!==expected.lines[j].text))
      add(issues,'DIALOGUE_OR_POSITION_MISMATCH','コマ'+(i+1)+' の文字・話者・位置不一致');
  }
  for(const [key,code,msg] of [
    ['masterImageSideBySideConfirmed','IDENTITY_NOT_VISUALLY_CHECKED','人物原本比較なし'],
    ['speechBubbleTailsConfirmed','BALLOON_TAILS_UNCHECKED','吹き出し尻尾未確認'],
    ['smartphoneLegibilityConfirmed','MOBILE_LEGIBILITY_UNCHECKED','スマホ可読性未確認'],
    ['editorialStoryConfirmed','EDITORIAL_REVIEW_UNCHECKED','感情演出の編集確認なし']
  ])if(review?.[key]!==true)add(issues,code,msg);
  if(review?.freshForImageSha256!==candidate?.sha256)
    add(issues,'STALE_QA','旧画像のQAを再利用しない');
  return verdict('CANDIDATE_QA',issues);
}
module.exports={validatePlan,validateCandidate};
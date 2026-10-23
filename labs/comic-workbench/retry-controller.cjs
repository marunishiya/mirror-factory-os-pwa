'use strict';
/**
 * PROJECT MIRROR retake evidence guard.
 * No image API, no Canon changes, no automated identity or quality approval.
 */
const HEX=/^[a-f0-9]{64}$/i;
const hash=x=>typeof x==='string'&&HEX.test(x);
const filled=x=>typeof x==='string'&&x.trim().length>0;
const add=(issues,code,reason)=>issues.push({code,reason});
const DEFECT_PRIORITY=Object.freeze({
  WRONG_SOURCE_MASTER:0,WRONG_SOURCE_LOCK:0,PANEL_ORDER:1,
  TEXT_SPEAKER:2,BALLOON_TAIL:2,CHARACTER_IDENTITY:3,
  COMPOSITION:4,BUBBLE_OVERLAP:4,RESOLUTION:5,OTHER:6
});
const known=x=>Object.hasOwn(DEFECT_PRIORITY,x);
const decision=(issues,info={})=>({
  status:issues.length?'BLOCKED':'SINGLE_TRIAL_ALLOWED',issues,...info,
  artApproved:false,canonApproved:false,publicationApproved:false,
  note:'試行条件の形式判定のみ。顔・セリフ画像・作品の感動を自動承認しない。'
});
function assessRetry({intent,pageId,panelId,sourceLockSha256,
  approvedAssets=[],history=[],fix,proposedInputSha256}={}){
  const issues=[];
  if(!['generate','edit'].includes(intent))
    add(issues,'NOT_GENERATION_INTENT','批評・調査依頼で生成しない');
  if(!filled(pageId)||!Number.isInteger(panelId)||panelId<1||panelId>6)
    add(issues,'INVALID_TARGET','ページとコマを一意に指定');
  if(!hash(sourceLockSha256))
    add(issues,'SOURCE_LOCK_UNKNOWN','正式原稿ハッシュがない');
  if(!Array.isArray(approvedAssets)||!Array.isArray(history))
    add(issues,'INVALID_EVIDENCE','承認済み資産と試行履歴が不明');
  if(!Array.isArray(history))history=[];
  if(!Array.isArray(approvedAssets))approvedAssets=[];
  if(approvedAssets.some(a=>a?.pageId===pageId&&
      (a.panelId===panelId||a.panelId==null)))
    add(issues,'APPROVED_ART_PROTECTED','承認済み作品を再描画しない');
  const onPage=history.filter(a=>a?.pageId===pageId);
  const onPanel=onPage.filter(a=>a?.panelId===panelId);
  if(onPage.length>=8)add(issues,'PAGE_ATTEMPT_CAP','1ページ8回を超えない');
  if(onPanel.length>=2)add(issues,'PANEL_ATTEMPT_CAP','1コマ2回を超えない');
  if(onPanel.some(a=>a?.status==='APPROVED'))
    add(issues,'ALREADY_APPROVED','合格コマを保護');
  if(onPanel.some(a=>a?.sourceLockSha256!==sourceLockSha256))
    add(issues,'SOURCE_CHANGED','別原稿の履歴を流用しない');
  if(!hash(proposedInputSha256))
    add(issues,'NO_NEW_INPUT_PROOF','今回の生成入力SHA不明');
  if(onPanel.some(a=>a?.inputSha256===proposedInputSha256))
    add(issues,'DUPLICATE_INPUT','同じ入力で何度も生成しない');
  if(onPanel.length){
    const last=onPanel[onPanel.length-1];
    if(last?.status!=='FAILED')
      add(issues,'PREVIOUS_NOT_FAILED','直前試行の独立不合格評価がない');
    if(!fix||!known(fix.defectCode))
      add(issues,'UNCLASSIFIED_DEFECT','欠陥種類が不明');
    for(const key of ['rootCause','changedElement','expectedDifference','verificationMethod']){
      if(!filled(fix?.[key]))
        add(issues,'MISSING_'+key.toUpperCase(),key+' を明確化する');
    }
    if(!hash(fix?.previousOutputSha256)||
        fix.previousOutputSha256!==last.outputSha256)
      add(issues,'STALE_FAILURE_LINK','前回不合格の実画像を紐付ける');
    if(!Array.isArray(last.defects)||!last.defects.includes(fix?.defectCode))
      add(issues,'WRONG_DEFECT_TARGET','実際の不合格原因だけを修正');
    if(fix?.patchScope!==pageId+':C'+String(panelId).padStart(2,'0'))
      add(issues,'SCOPE_NOT_LOCAL','失敗コマだけを変更する');
  }else if(fix?.previousOutputSha256){
    add(issues,'UNTRACED_RETRY','履歴不明のリテイク禁止');
  }
  return decision(issues,{
    attemptNumber:onPanel.length+1,
    remainingPanelAttempts:Math.max(0,2-onPanel.length),
    remainingPageAttempts:Math.max(0,8-onPage.length)
  });
}
function assessResult({sourceLockSha256,history=[],candidate,verifiedQA}={}){
  const issues=[];
  if(!hash(candidate?.inputSha256)||!hash(candidate?.outputSha256))
    add(issues,'MISSING_ACTUAL_HASH','入力/出力SHAなし');
  if(!hash(sourceLockSha256)||candidate?.sourceLockSha256!==sourceLockSha256)
    add(issues,'SOURCE_LOCK_MISMATCH','原稿SHA不一致');
  if(Array.isArray(history)&&history.some(x=>x?.outputSha256===candidate?.outputSha256))
    add(issues,'REPEATED_IMAGE','同じ画像を改善として扱わない');
  if(!Array.isArray(verifiedQA?.defects))
    add(issues,'NO_INDEPENDENT_QA','独立した実画像QAなし');
  if(verifiedQA?.inspectedOutputSha256!==candidate?.outputSha256)
    add(issues,'STALE_QA','別画像のQAを流用しない');
  if(!Number.isInteger(candidate?.width)||!Number.isInteger(candidate?.height)||
      candidate.width<2048||candidate.height<3072||
      Math.abs(candidate.width/candidate.height-2/3)>0.002)
    add(issues,'LOW_RES','2048x3072原画条件未達');
  if(verifiedQA?.masterVisualMatch!==true||
      verifiedQA?.bubbleTailsCorrect!==true||
      verifiedQA?.correctPanelOrder!==true||
      verifiedQA?.independentReadbackMatches!==true)
    add(issues,'VISUAL_QA_INCOMPLETE','本人・尻尾・コマ・文字は画像で別途照合');
  const count=Array.isArray(verifiedQA?.defects)?verifiedQA.defects.length:null;
  if(count>0)add(issues,'DEFECTS_REMAIN',count+' 件の不合格が残る');
  return {
    status:issues.length?'FAILED_QA':'REVIEW_REQUIRED',
    issues,reportedDefectCount:count,
    outputSha256:candidate?.outputSha256||null,
    artApproved:false,canonApproved:false,publicationApproved:false
  };
}
function nextCorrection(defects){
  const list=(Array.isArray(defects)?defects:[]).filter(x=>known(x?.code));
  if(!list.length)return {status:'HOLD',reason:'根拠のある欠陥がない'};
  const issue=list.slice().sort((a,b)=>DEFECT_PRIORITY[a.code]-DEFECT_PRIORITY[b.code])[0];
  return {status:'ONE_TARGET_ONLY',defect:issue,
    note:'ひとつの失敗を直して実画像で証明してから次の修正へ'};
}
module.exports={assessRetry,assessResult,nextCorrection};
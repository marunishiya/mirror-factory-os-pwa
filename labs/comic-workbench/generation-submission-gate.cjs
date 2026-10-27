'use strict';
/**
 * Non-Canon, fail-closed pre-send gate for ONE illustration from a locked page.
 * Caller MUST construct transport from the actual outbound provider request,
 * not from a draft prompt. This module cannot inspect an opaque image tool.
 * Passing means REVIEW_REQUIRED, not generated/art-verified/Canon-approved.
 */
const crypto = require('node:crypto');
const {validatePlan} = require('./page-gate.cjs');
const POSITIONS = ['右上', '左上', '右中', '左中', '右下', '左下'];
const HASH = /^[a-f0-9]{64}$/i;
const digest = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hasText = x => typeof x === 'string' && x.trim().length > 0;
const err = (issues, code, message) => issues.push({code, message});
const reply = issues => ({stage:'GENERATION_SUBMISSION', status:issues.length?'BLOCKED':'REVIEW_REQUIRED', issues,
  promptPreflightPassed:issues.length===0, imageCreated:false,
  canonApproved:false, visualIdentityVerified:false, publicationApproved:false});

function validateGenerationSubmission({intent, plan, lock, promptLock, transport}={}) {
  const issues = [];
  const planResult = validatePlan({intent,plan,lock});
  for(const e of planResult.issues)err(issues,'PLAN_'+e.code,e.message);

  if (!lock || !HASH.test(lock.sha256 || '') || !Array.isArray(lock.panels))
    err(issues, 'SOURCE_LOCK_INVALID', '有効なページSOURCE LOCKが必要');
  if (!promptLock || promptLock.pageId !== lock?.pageId ||
    promptLock.sourceLockSha256 !== lock?.sha256)
    err(issues,'PROMPT_LOCK_MISMATCH','指示書のページIDとSOURCE LOCK SHAが一致しない');

  const panel = promptLock?.panel;
  const item = lock?.panels?.find(p => p.panel === panel);
  if (!Number.isInteger(panel) || !item || item.position !== POSITIONS[panel-1] ||
      promptLock?.position !== item?.position)
    err(issues,'PANEL_OR_ORDER_MISMATCH','対象コマと右上→左下の読み順が一致しない');
  if (promptLock?.outputMode !== 'single-text-free-illustration')
    err(issues,'INVALID_OUTPUT_MODE','単独・文字なしの原画のみ許可');

  const approved = promptLock?.approvedPrompt;
  if(!hasText(approved) || !HASH.test(promptLock?.approvedPromptSha256||'') ||
     (hasText(approved) && digest(approved) !== promptLock.approvedPromptSha256))
    err(issues,'PROMPT_HASH_MISMATCH','承認済み指示文とSHA-256が一致しない');
  if(!Array.isArray(promptLock?.requiredPhrases) || promptLock.requiredPhrases.length===0 ||
     promptLock.requiredPhrases.some(x => !hasText(x)))
    err(issues,'REQUIRED_SCENES_UNSET','必須場面が未設定');
  else if(hasText(approved))for(const x of promptLock.requiredPhrases)
    if(!approved.includes(x))err(issues,'REQUIRED_SCENE_MISSING','必須要素がない: '+x);
  if(!Array.isArray(promptLock?.forbiddenPhrases) || !promptLock.forbiddenPhrases.length ||
     promptLock.forbiddenPhrases.some(x=>!hasText(x)))
    err(issues,'FORBIDDEN_SCENES_UNSET','禁止語・禁止場面が未設定');
  else if(hasText(approved))for(const x of promptLock.forbiddenPhrases)
    if(approved.toLowerCase().includes(x.toLowerCase()))
      err(issues,'FOREIGN_SCENE_CONTAMINATION','別場面が混入: '+x);

  if (!Number.isInteger(promptLock?.attemptNumber) || promptLock.attemptNumber < 1 ||
      promptLock.attemptNumber > 2)
    err(issues,'GENERATION_RETRY_LIMIT','同一コマの生成は初稿＋修正の2回まで');
  if(transport?.exactPromptSupported !== true ||
     transport?.effectivePromptSource !== 'actual_outbound_request')
    err(issues,'OPAQUE_PROVIDER_BLOCKED','実際に送信される指示本文を確認・固定できない生成経路は停止');
  if(!hasText(transport?.effectivePrompt))
    err(issues,'EFFECTIVE_PROMPT_UNAVAILABLE','実リクエストの指示本文が取得できない');
  else if(!hasText(approved) || transport.effectivePrompt !== approved)
    err(issues,'EFFECTIVE_PROMPT_MISMATCH','検査済み指示と実送信指示が異なる');
  return reply(issues);
}
module.exports={validateGenerationSubmission,digest};

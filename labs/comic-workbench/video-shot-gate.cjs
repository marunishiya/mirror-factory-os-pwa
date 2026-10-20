/* Fail-closed export gate for storyboard-to-video production.
 * Non-Canon lab: no MASTER images bundled, no source data writes.
 * Validates planned cause/effect AND per-scene verified images, not actual face identity.
 */
"use strict";
function checkProduction(manifest, sources){
 const issues=[],add=(work,shot,code,message)=>issues.push({work,shot,code,message});
 if(manifest?.schema!=="anger-shorts-noncanon-v4/1"||!manifest.works||
   !manifest.works.reina||!manifest.works.sane)throw Error("非Canonの制作仕様v4が必要です");
 for(const slug of ["reina","sane"]){
  const work=manifest.works[slug],shots=work?.shots||[];
  const expected=slug==="reina"?"R":"S";
  if(shots.length!==6||shots.some((p,i)=>p.id!==expected+String(i+1).padStart(2,"0")))
   add(slug,null,"SHOT_ORDER","6場面の読み順とIDを固定してください");
  if(shots.filter(p=>p.type==="WIDE").length<4)
   add(slug,null,"INSUFFICIENT_WIDE","現場全体が見える全景は4場面以上必要です");
  if(shots.filter(p=>p.type==="DETAIL"||p.type==="CLOSE_UP").length>1)
   add(slug,null,"CLOSE_UP_EXCESS","顔・小物のアップに頼りすぎています");
  if(shots.reduce((n,p)=>n+p.seconds,0)!==30)
   add(slug,null,"WRONG_DURATION","合計30秒にしてください");
  const used=new Set();
  for(const p of shots){
   const id=p.id;
   if(!Array.isArray(p.line)||p.line.length!==2||p.line.some(x=>typeof x!=="string"||!x.trim()))
    add(slug,id,"INVALID_DIALOGUE","話者と確定セリフの指定が必要です");
   if(!p.evidence||!p.continuity||!p.event)
    add(slug,id,"CAUSE_NOT_VISIBLE","行動・伏線・位置関係を説明できません");
   const asset=sources?.[id];
   if(!asset){add(slug,id,"MISSING_INDEPENDENT_SCENE","独立した1場面の原画がありません");continue}
   if(!Number.isInteger(asset.width)||!Number.isInteger(asset.height)||asset.width<1600||asset.height<900)
    add(slug,id,"SOURCE_TOO_SMALL","最低1600×900の独立した原画が必要です");
   if(typeof asset.sha256!=="string"||!/^[a-f0-9]{64}$/.test(asset.sha256)){
    add(slug,id,"ASSET_UNVERIFIED","元画像のSHA-256が必要です");
   }else if(used.has(asset.sha256)){
    add(slug,id,"REUSED_ASSET","同じ画像を別の場面に再利用しています");
   }else used.add(asset.sha256);
   if(asset.contactSheet===true || asset.isStandaloneScene!==true)
    add(slug,id,"NOT_SINGLE_SCENE","漫画全体のポスター／小コマ画像は使用できません");
   for(const k of ["identityReviewed","dialogueReviewed","causalityReviewed","imageQualityReviewed"]){
    if(asset[k]!==true)add(slug,id,"HUMAN_REVIEW_REQUIRED",k+"を人が確認する必要があります");
   }
  }
 }
 return Object.freeze({
  status:issues.length?"BLOCKED":"READY_FOR_MANUAL_FINAL_REVIEW",
  issues,issueCount:issues.length,
  machineApprovedForCanon:false,finishedVideoCertified:false,
  reminder:"寸法と入力構造の検査であり、顔・歴史考証・画像内容を自動判定したものではありません。"
 });
}
module.exports={checkProduction};
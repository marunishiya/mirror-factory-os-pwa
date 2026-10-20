/* Independent, human-labelled OCR measurement; NEVER certifies Canon or a rendered image. */
(function(root,factory){
 "use strict";
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 root.ComicOcrQuality=api;
})(typeof globalThis==="object"?globalThis:this,function(){
 "use strict";
 const SCHEMA="comic-ocr-quality/v1", MAX_PAIRS=80,MAX_LENGTH=1200;
 const chars=s=>Array.from(s);
 function text(s){
  if(typeof s!=="string"||chars(s).length>MAX_LENGTH)
   throw Error("計測するテキストの形式・長さが不正です");
  return s;
 }
 function distance(reference,candidate){
  const a=chars(text(reference)),b=chars(text(candidate));
  // Linear memory, bounded by MAX_LENGTH. Compare exact Unicode codepoints.
  let prior=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
   const row=[i];
   for(let j=1;j<=b.length;j++){
    row[j]=Math.min(row[j-1]+1,prior[j]+1,
      prior[j-1]+(a[i-1]===b[j-1]?0:1));
   }
   prior=row;
  }
  return prior[b.length];
 }
 function compare(reference,candidate){
  const a=text(reference),b=text(candidate);
  if(!a.length)throw Error("人が画像を見て確定した正解文字列が必要です");
  const n=chars(a).length,edits=distance(a,b);
  return {referenceLength:n,candidateLength:chars(b).length,edits,
    characterErrorRate:edits/n,
    exact:a===b};
 }
 function assess(pairs,meta){
  if(!Array.isArray(pairs)||pairs.length===0||pairs.length>MAX_PAIRS)
    throw Error("1〜80件のOCR候補比較が必要です");
  if(!meta||typeof meta.imageSha256!=="string"||
    !/^[a-f0-9]{64}$/.test(meta.imageSha256)||
    !["local-desktop-ocr","native-browser-experimental"].includes(meta.source))
    throw Error("対象画像のハッシュ・OCR出所が不正です");
  let measured=0,unreviewed=0,characters=0,edits=0,exact=0;
  const rows=pairs.map((p,i)=>{
   if(!p||!Number.isInteger(p.balloonIndex)||p.balloonIndex<0||
      p.balloonIndex>79||typeof p.humanReviewed!=="boolean")
    throw Error("比較"+(i+1)+"の吹き出し指定・目視確認が不正です");
   const candidate=text(p.candidateText);
   if(!p.humanReviewed){
    unreviewed++;
    return {balloonIndex:p.balloonIndex,status:"NOT_HUMAN_VERIFIED",
      candidateText:candidate,referenceText:null};
   }
   const verified=text(p.humanText);
   const r=compare(verified,candidate);
   measured++;characters+=r.referenceLength;edits+=r.edits;
   if(r.exact)exact++;
   return {balloonIndex:p.balloonIndex,status:r.exact?"TEXT_EXACT":"TEXT_DIFFERENT",
    candidateText:candidate,referenceText:verified,...r};
  });
  return {
   schema:SCHEMA, imageSha256:meta.imageSha256,source:meta.source,
   result:"MEASUREMENT_ONLY",measured,unreviewed,
   exactCount:exact,exactRate:measured?exact/measured:null,
   characterErrorRate:characters?edits/characters:null,
   totalReferenceCodepoints:characters,totalEditOperations:edits,
   rows,normalization:"none (exact Unicode codepoint comparison)",
   modelValidated:false,imageAutomaticallyVerified:false,canonApproved:false,
   warning:"OCR候補と人が転記した文字の評価値。人の転記が誤れば測定も誤る。モデルの汎用精度・実画像の正しさ・Canon承認を保証しない。"
  };
 }
 function exportJson(result){
  if(!result||result.schema!==SCHEMA||result.result!=="MEASUREMENT_ONLY")
   throw Error("正式なOCR測定結果ではありません");
  const obj=JSON.parse(JSON.stringify(result));
  obj.modelValidated=false;obj.imageAutomaticallyVerified=false;obj.canonApproved=false;
  return JSON.stringify(obj,null,2);
 }
 return Object.freeze({SCHEMA,MAX_PAIRS,distance,compare,assess,exportJson});
});
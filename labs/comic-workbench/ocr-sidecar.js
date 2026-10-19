/* Safe local OCR sidecar JSON import. This is NOT a visual / Canon approval. */
(function(root,factory){
 "use strict";
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 root.ComicOcrSidecar=factory();
})(typeof globalThis==="object"?globalThis:this,function(){
 "use strict";
 const SCHEMA="comic-ocr-candidates/v1", HASH=/^[a-f0-9]{64}$/;
 const LIMIT=80;
 function reject(m){throw Error(m)}
 function load(raw,meta){
  if(typeof raw!=="string"||raw.length>1000000)reject("OCR候補ファイルが大きすぎるか不正です");
  const p=JSON.parse(raw);
  if(!p||p.schema!==SCHEMA||!p.image||!meta||!HASH.test(p.image.sha256||"")||
     !HASH.test(meta.sha256||"")||p.image.sha256!==meta.sha256||
     p.image.width!==meta.width||p.image.height!==meta.height||
     p.image.bytes!==meta.bytes){
   reject("読み込んだOCR候補が、この画像と一致しません。画像を変更していないか確認してください");
  }
  if(!p.engine||p.engine.name!=="tesseract-cli"||!["jpn","jpn_vert"].includes(p.engine.language)||
     !Array.isArray(p.candidates)||p.candidates.length>LIMIT||
     !p.safety||p.safety.humanReviewRequired!==true||
     p.safety.automaticallyVerified!==false||p.safety.canonApproved!==false)reject("OCR候補の形式または検査状態が不正です");
  const out=p.candidates.map((c,i)=>{
   if(!c||typeof c.text!=="string"||!c.text.trim()||c.text.length>1200||
     typeof c.confidence!=="number"||!Number.isFinite(c.confidence)||
     c.confidence<0||c.confidence>100||
     !c.bounds||!["x","y","width","height"].every(k=>
       typeof c.bounds[k]==="number"&&Number.isFinite(c.bounds[k])&&
       c.bounds[k]>=0&&c.bounds[k]<=1)||
     c.bounds.x+c.bounds.width>1.001||c.bounds.y+c.bounds.height>1.001)
     reject("OCR候補"+(i+1)+"の内容または位置が不正です");
   return {index:i,text:c.text,confidence:c.confidence,bounds:{...c.bounds},
     recognized:true,engine:"tesseract-cli-"+p.engine.language};
  });
  return {status:out.length?"CANDIDATES":"NO_TEXT",detections:out,
   engine:p.engine.name+"-"+p.engine.language,recognitionSource:"local-desktop-ocr",
   automaticallyVerified:false,canonApproved:false,
   note:"ローカルTesseractの候補です。画像の文字・話者・読順は必ず人が確認してください。"};
 }
 return Object.freeze({SCHEMA,LIMIT,load});
});
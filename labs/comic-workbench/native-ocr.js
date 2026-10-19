/* Opt-in native OCR preview for browsers exposing TextDetector.
 * Experimental platform API: never changes source text, visual QA checks or Canon status. */
(function(root,factory){
 "use strict";
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 root.ComicNativeOcr=api;
})(typeof globalThis==="object"?globalThis:this,function(){
 "use strict";
 const MAX_RESULTS=100,MAX_CHARS=1200;
 function availability(host){
  return host&&typeof host.TextDetector==="function"?
    {available:true,engine:"native-text-detector-experimental"}:
    {available:false,reason:"このブラウザは試験的なTextDetector OCRに対応していません。手動転記を利用してください。"};
 }
 function process(results,width,height){
  if(!Array.isArray(results))throw Error("OCRエンジンの結果形式が不正です");
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error("画像サイズが不正です");
  if(results.length>MAX_RESULTS)throw Error("OCR結果が多すぎます");
  const detections=results.map((r,i)=>{
    if(!r||typeof r!=="object")throw Error("OCR候補が不正です");
    const raw=typeof r.rawValue==="string"?r.rawValue.slice(0,MAX_CHARS):"";
    const b=r.boundingBox||{};
    const coord=n=>typeof n==="number"&&Number.isFinite(n)?n:null;
    const x=coord(b.x),y=coord(b.y),w=coord(b.width),h=coord(b.height);
    return {index:i,text:raw,bounds:
      x===null||y===null||w===null||h===null||w<0||h<0?null:
        {x:Math.max(0,Math.min(1,x/width)),y:Math.max(0,Math.min(1,y/height)),
         width:Math.max(0,Math.min(1,w/width)),height:Math.max(0,Math.min(1,h/height))},
      engine:"native-text-detector-experimental",recognized:raw.trim().length>0};
  });
  return {
    status:detections.some(x=>x.recognized)?"CANDIDATES":"NO_TEXT",
    engine:"native-text-detector-experimental",
    detections,automaticallyVerified:false,canonApproved:false,
    note:"試験的なブラウザOCRの候補です。全文・日本語・縦書きの精度は保証されません。人による照合が必要です。"
  };
 }
 async function recognize(bitmap,host){
  const cap=availability(host);
  if(!cap.available)return {status:"UNSUPPORTED",detections:[],engine:null,
    automaticallyVerified:false,canonApproved:false,note:cap.reason};
  if(!bitmap||!Number.isInteger(bitmap.width)||!Number.isInteger(bitmap.height)||
    bitmap.width<1||bitmap.height<1||bitmap.width*bitmap.height>4000000)
    throw Error("対応画像を選択してください");
  let instance;
  try{instance=new host.TextDetector();}
  catch(_){return {status:"UNSUPPORTED",detections:[],engine:null,
    automaticallyVerified:false,canonApproved:false,
    note:"この端末のテキスト検出器を初期化できません。手動転記を利用してください。"}}
  try{
    const raw=await instance.detect(bitmap);
    return process(raw,bitmap.width,bitmap.height);
  }catch(e){
    return {status:"UNSUPPORTED",detections:[],engine:null,
      automaticallyVerified:false,canonApproved:false,
      note:"OCRを利用できません（"+String(e?.name||"error").slice(0,70)+"）。手動転記を利用してください。"};
  }
 }
 function compareCandidate(candidate,expected){
  if(!candidate||typeof candidate.text!=="string"||typeof expected!=="string")
    throw Error("OCR候補と確定原稿が不正です");
  // Strict: no trim, OCR is not source truth.
  return {match:candidate.text===expected,status:candidate.text===expected?"EXACT_CANDIDATE":"DIFFERENT_CANDIDATE",
    verified:false,needsHumanReview:true};
 }
 return Object.freeze({availability,process,recognize,compareCandidate});
});
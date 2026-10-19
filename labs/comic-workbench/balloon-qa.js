/* Human-annotated balloon QA; does not perform OCR, image understanding or Canon approval. */
(function(root,factory){
 "use strict";
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 root.ComicBalloonQA=api;
})(typeof globalThis==="object"?globalThis:this,function(){
 "use strict";
 const SCHEMA="comic-balloon-annotation/v1", MAX_LINES=60;
 const hex=/^[a-f0-9]{64}$/;
 const copy=x=>JSON.parse(JSON.stringify(x));
 function err(s){throw Error(s)}
 function panelFrom(doc,panelId){
  if(!doc||doc.schema!=="comic-workbench/v1"||!["mirror","himiko"].includes(doc.project))err("対応していない作品データです");
  if(typeof panelId!=="string"||!panelId)err("コマIDがありません");
  const hits=(doc.pages||[]).flatMap(pg=>(pg.panels||[]).filter(p=>p.id===panelId));
  if(hits.length!==1)err("対象コマが特定できません");
  const p=hits[0];
  if(!Array.isArray(p.lines)||p.lines.length<1||p.lines.length>MAX_LINES)err("吹き出し対象は1〜60行です");
  if(p.lines.some(l=>!l||typeof l.speaker!=="string"||typeof l.text!=="string"||
     !l.speaker.trim()||!l.text.trim()))err("確定話者またはセリフが未登録です");
  return p;
 }
 function imageMeta(meta){
  if(!meta||!hex.test(meta.sha256||"")||!Number.isInteger(meta.width)||
     !Number.isInteger(meta.height)||meta.width<1||meta.height<1||
     meta.width*meta.height>4000000||!Number.isInteger(meta.bytes)||
     meta.bytes<8||meta.bytes>10*1024*1024)err("画像のハッシュ・寸法・ファイルサイズを確認してください");
  return {sha256:meta.sha256,width:meta.width,height:meta.height,bytes:meta.bytes};
 }
 function newAnnotations(doc,panelId){
  const p=panelFrom(doc,panelId);
  return p.lines.map((l,i)=>({index:i,x:null,y:null,observedSpeaker:"",
    observedText:"",humanChecked:false}));
 }
 function validateAnnotations(doc,panelId,records){
  const p=panelFrom(doc,panelId);
  if(!Array.isArray(records)||records.length!==p.lines.length)err("注釈件数が確定セリフ数と一致しません");
  const seen=new Set();
  return records.map(r=>{
    if(!r||!Number.isInteger(r.index)||r.index<0||r.index>=p.lines.length||seen.has(r.index)||
       typeof r.observedSpeaker!=="string"||r.observedSpeaker.length>100||
       typeof r.observedText!=="string"||r.observedText.length>2000||
       typeof r.humanChecked!=="boolean" ||
       (r.x!==null&&(!Number.isFinite(r.x)||r.x<0||r.x>1))||
       (r.y!==null&&(!Number.isFinite(r.y)||r.y<0||r.y>1))||
       ((r.x===null)!==(r.y===null)))err("吹き出し注釈の形式が不正です");
    seen.add(r.index);
    return copy(r);
  }).sort((a,b)=>a.index-b.index);
 }
 function evaluate(doc,panelId,records,meta,sourceStatus){
  const p=panelFrom(doc,panelId);
  const ann=validateAnnotations(doc,panelId,records);
  const image=imageMeta(meta);
  const issues=[],add=(type,code,index,message)=>issues.push({type,code,index,message});
  const source=sourceStatus||"NOT_IMPORTED";
  if(doc.sourceInfo&&source!=="MATCH")add("ERROR","SOURCE_UNVERIFIED",null,"FACTORY原稿のSOURCE LOCKが不一致または未検証です");
  const isMissing=[];
  for(let i=0;i<ann.length;i++){
    const a=ann[i],expected=p.lines[i];
    if(a.x===null||a.y===null){
      add("PENDING","MISSING_POSITION",i,"吹き出し中心が選択されていません");
      isMissing.push(i);continue;
    }
    if(!a.humanChecked){
      add("PENDING","HUMAN_REVIEW_REQUIRED",i,"画像を見ながら本人がチェックしてください");
      isMissing.push(i);continue;
    }
    if(!a.observedSpeaker){
      add("PENDING","SPEAKER_UNKNOWN",i,"見えている話者を独立して選んでください");
      isMissing.push(i);
    } else if(a.observedSpeaker!==expected.speaker){
      add("ERROR","SPEAKER_MISMATCH",i,"指定話者と確定原稿の話者IDが不一致です");
    }
    if(!a.observedText){
      add("PENDING","TEXT_NOT_TRANSCRIBED",i,"吹き出しの文字を入力して照合してください");
      isMissing.push(i);
    } else if(a.observedText!==expected.text){
      add("ERROR","DIALOGUE_MISMATCH",i,"吹き出し転記と確定原稿が1文字以上不一致です");
    }
  }
  // A cautious hint for two horizontally aligned balloons only. Complex layout is never auto judged.
  for(let i=0;i<ann.length;i++)for(let j=i+1;j<ann.length;j++){
    const a=ann[i],b=ann[j];
    if(a.x===null||b.x===null)continue;
    if(Math.abs(a.y-b.y)<=0.10 && Math.abs(a.x-b.x)>0.12 && a.x<b.x){
      add("WARN","RTL_POSITION_HINT",i,"右から左に読む場合、吹き出し"+(j+1)+"の方が右側です。読み順を人が確認してください");
    }
    if(Math.abs(a.x-b.x)<=0.06&&Math.abs(a.y-b.y)<=0.06)
      add("WARN","OVERLAPPING_MARKERS",i,"複数の吹き出し位置が近すぎます。タップ位置を確認してください");
  }
  const errors=issues.filter(x=>x.type==="ERROR").length;
  const pending=issues.filter(x=>x.type==="PENDING").length;
  const status=doc.sourceInfo&&source!=="MATCH"?"BLOCKED":
    errors?"MISMATCH":pending?"INCOMPLETE":"ANNOTATIONS_CONSISTENT";
  return {schema:SCHEMA,project:doc.project,panelId,panelRevision:p.revision,
    sourceStatus:source,image,expectedCount:p.lines.length,status,
    errors,pending,warnings:issues.filter(x=>x.type==="WARN").length,issues,
    annotations:ann,imageAnalyzedByAI:false,ocrPerformed:false,canonApproved:false,
    visualImageVerified:false};
 }
 function safeReport(value){
  if(!value||value.schema!==SCHEMA||!Array.isArray(value.annotations)||value.annotations.length>MAX_LINES)
    err("保存できる検査結果ではありません");
  const data=copy(value);
  // Explicitly do not include actual image bytes or assert a source-of-truth Canon approval.
  return JSON.stringify(data,null,2);
 }
 return Object.freeze({SCHEMA,newAnnotations,validateAnnotations,evaluate,safeReport,imageMeta});
});
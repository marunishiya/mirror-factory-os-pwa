const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const S=require("./ocr-sidecar.js");
const meta={sha256:"a".repeat(64),width:740,height:340,bytes:42311};
function payload(){
 return JSON.stringify({schema:S.SCHEMA,image:{...meta},
  engine:{name:"tesseract-cli",language:"jpn",pageSegmentationMode:6,version:"tesseract 5"},
  candidates:[{text:"責任者を呼んでください。",confidence:91.4,
    bounds:{x:.1,y:.2,width:.6,height:.1}}],
  safety:{humanReviewRequired:true,automaticallyVerified:false,canonApproved:false}});
}
test("同じSHA・寸法・サイズの実OCR候補を受け入れる",()=>{
 const r=S.load(payload(),meta);
 assert.equal(r.status,"CANDIDATES");
 assert.equal(r.detections[0].text,"責任者を呼んでください。");
 assert.equal(r.detections[0].confidence,91.4);
 assert.equal(r.automaticallyVerified,false);
});
test("異なる元画像では同じ文字でも候補を使い回さない",()=>{
 for(const patch of [{sha256:"b".repeat(64)},{width:741},{height:350},{bytes:500}])
  assert.throws(()=>S.load(payload(),{...meta,...patch}),/画像と一致/);
});
test("Canonや目視チェックをOCRファイルで偽装しない",()=>{
 const forged=JSON.parse(payload());
 forged.safety.canonApproved=true;
 assert.throws(()=>S.load(JSON.stringify(forged),meta),/検査状態/);
 forged.safety.canonApproved=false;forged.safety.humanReviewRequired=false;
 assert.throws(()=>S.load(JSON.stringify(forged),meta),/検査状態/);
});
test("不正な候補座標・確信度・空文字を拒否",()=>{
 for(const edits of [
  {confidence:101},{confidence:-1},{text:""},{bounds:{x:1,y:.5,width:.5,height:.5}},
  {bounds:{x:NaN,y:.2,width:.2,height:.2}},{text:"あ".repeat(1201)}
 ]){
  const d=JSON.parse(payload());Object.assign(d.candidates[0],edits);
  assert.throws(()=>S.load(JSON.stringify(d),meta),/不正/);
 }
});
test("大きい/不正フォーマットは失敗しても画像やCanonを変えない",()=>{
 assert.throws(()=>S.load("x".repeat(1000001),meta),/大きすぎ/);
 const data=JSON.parse(payload());data.schema="unknown";
 assert.throws(()=>S.load(JSON.stringify(data),meta),/形式/);
});
test("空の候補は明示NO_TEXTで、AI承認扱いなし",()=>{
 const d=JSON.parse(payload());d.candidates=[];
 const r=S.load(JSON.stringify(d),meta);
 assert.equal(r.status,"NO_TEXT");
 assert.equal(r.canonApproved,false);
});
test("ブラウザ版で手動転記が未完了に戻ることを確認",()=>{
 const src=fs.readFileSync(path.join(__dirname,"balloon-lab.html"),"utf8");
 assert(src.includes('id="ocrFile"'));
 assert(src.includes('S.load(contents,{sha256:image.sha256'));
 assert(src.includes("annotations[n].humanChecked=false"));
 assert(src.includes("const token=++ocrToken,expected=image"));
 for(const match of src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
  if(match[1].trim())assert.doesNotThrow(()=>new vm.Script(match[1]));
});
test("ローカルOCR読込コードはAPI/外部通信機能を持たない",()=>{
 const src=fs.readFileSync(path.join(__dirname,"ocr-sidecar.js"),"utf8");
 assert(!/\bfetch\s*\(/.test(src));
 assert(!/\bWebSocket\b/.test(src));
 assert(!/\bXMLHttpRequest\b/.test(src));
});

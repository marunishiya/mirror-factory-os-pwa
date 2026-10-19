const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const O=require("./native-ocr.js");
const bitmap={width:800,height:600};
const detected=[{rawValue:"責任者を呼んでください。",boundingBox:{x:20,y:30,width:300,height:70}},
 {rawValue:"お待ち下さい。",boundingBox:{x:430,y:30,width:250,height:80}}];
function host(results=detected){return {TextDetector:class{async detect(image){
 assert.equal(image,bitmap);return results;
}}}}
test("未対応ブラウザはOCRを無理に起動せずUNSUPPORTED",async()=>{
 assert.equal(O.availability({}).available,false);
 const r=await O.recognize(bitmap,{});
 assert.equal(r.status,"UNSUPPORTED");
 assert.equal(r.canonApproved,false);
});
test("TextDetectorが提供する文字列と画像内の位置を保持",async()=>{
 const r=await O.recognize(bitmap,host());
 assert.equal(r.status,"CANDIDATES");
 assert.equal(r.detections[0].text,"責任者を呼んでください。");
 assert.equal(r.detections[0].bounds.x,.025);
 assert.equal(r.detections[0].bounds.y,.05);
 assert.equal(r.automaticallyVerified,false);
 assert.equal(r.canonApproved,false);
});
test("空の検出でも合格扱いにならない",async()=>{
 const r=await O.recognize(bitmap,host([]));
 assert.equal(r.status,"NO_TEXT");
 assert.equal(r.detections.length,0);
 assert.equal(r.automaticallyVerified,false);
});
test("検出領域に文字列がない場合は認識済み扱いしない",async()=>{
 const r=O.process([{boundingBox:{x:1,y:2,width:3,height:4}}],800,600);
 assert.equal(r.status,"NO_TEXT");
 assert.equal(r.detections[0].recognized,false);
});
test("文字列の1文字違いはEXACTでない",()=>{
 const c={text:"お待ち下さい。"};
 const r=O.compareCandidate(c,"お待ちください。");
 assert.equal(r.status,"DIFFERENT_CANDIDATE");
 assert.equal(r.needsHumanReview,true);
});
test("一致候補も画像QAの自動合格ではない",()=>{
 const r=O.compareCandidate({text:"責任者を呼んでください。"},"責任者を呼んでください。");
 assert.equal(r.status,"EXACT_CANDIDATE");
 assert.equal(r.verified,false);
});
test("OCR APIが例外を出したら手動転記に戻る",async()=>{
 const r=await O.recognize(bitmap,{TextDetector:class{detect(){throw {name:"NotSupportedError"}}}});
 assert.equal(r.status,"UNSUPPORTED");
 assert.match(r.note,/手動転記/);
});
test("OCRエンジンの初期化不能でも画像は変更しない",async()=>{
 const r=await O.recognize(bitmap,{TextDetector:class{constructor(){throw Error("blocked")}}});
 assert.equal(r.status,"UNSUPPORTED");
 assert.equal(bitmap.width,800);
});
test("大きすぎる画像はOCR開始前に拒否",async()=>{
 await assert.rejects(()=>O.recognize({width:8000,height:5000},host()),/画像/);
});
test("検出候補の件数・文字数・バウンディングを制限",()=>{
 assert.throws(()=>O.process(new Array(101).fill({rawValue:"x"}),800,600),/多すぎ/);
 const o=O.process([{rawValue:"あ".repeat(2000),boundingBox:{x:-20,y:0,width:2000,height:99}}],800,600);
 assert.equal(o.detections[0].text.length,1200);
 assert.equal(o.detections[0].bounds.x,0);
 assert.equal(o.detections[0].bounds.width,1);
});
test("プライバシー: ネット経由のライブラリや隠しAPI呼び出しを追加しない",()=>{
 const js=fs.readFileSync(path.join(__dirname,"native-ocr.js"),"utf8");
 const html=fs.readFileSync(path.join(__dirname,"balloon-lab.html"),"utf8");
 assert(!/\bfetch\s*\(/.test(js));
 assert(!/\bXMLHttpRequest\b/.test(js));
 assert(!/\bWebSocket\b/.test(js));
 assert(!html.includes("https://cdn."));
 assert(html.includes('id="ocrTry"'));
 for(const [_,script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
   if(script.trim())assert.doesNotThrow(()=>new vm.Script(script));
 }
});
test("OCR候補を選択しても目視完了にはならないUI",()=>{
 const h=fs.readFileSync(path.join(__dirname,"balloon-lab.html"),"utf8");
 assert(h.includes("annotations[n].humanChecked=false"));
 assert(h.includes('if(token!==ocrToken||!image||bitmap!==image.bitmap)return'));
});

/* Image-linked manual speech bubble QA: strict typed transcript and speaker mismatch. */
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const W=require("./engine.js"),Q=require("./balloon-qa.js");
const meta={sha256:"a".repeat(64),width:900,height:600,bytes:200000};
function fixture(){const d=W.demo("mirror"),p=d.pages[0].panels[0];
 p.lines.push({speaker:"staff",target:"guest",text:"お待ちください。"});
 return d;
}
function ready(d){
 const p=d.pages[0].panels[0],id=p.id;
 const a=Q.newAnnotations(d,id);
 Object.assign(a[0],{x:.8,y:.2,observedSpeaker:"guest",observedText:p.lines[0].text,humanChecked:true});
 Object.assign(a[1],{x:.2,y:.2,observedSpeaker:"staff",observedText:p.lines[1].text,humanChecked:true});
 return a;
}
test("未記録はINCOMPLETE、AIの検査済とは扱わない",()=>{
 const d=fixture(),r=Q.evaluate(d,"P01",Q.newAnnotations(d,"P01"),meta);
 assert.equal(r.status,"INCOMPLETE");assert(r.pending>0);
 assert.equal(r.visualImageVerified,false);assert.equal(r.ocrPerformed,false);
 assert.equal(r.canonApproved,false);
});
test("位置・話者・全文が一致しても注釈一致のみで、画像検証PASSにしない",()=>{
 const d=fixture(),r=Q.evaluate(d,"P01",ready(d),meta);
 assert.equal(r.status,"ANNOTATIONS_CONSISTENT");
 assert.equal(r.errors,0);assert.equal(r.pending,0);assert.equal(r.warnings,0);
 assert.equal(r.visualImageVerified,false);
});
test("一文字違いをERRORにする",()=>{
 const d=fixture(),a=ready(d);a[1].observedText="お待ち下さい。";
 const r=Q.evaluate(d,"P01",a,meta);
 assert.equal(r.status,"MISMATCH");
 assert(r.issues.some(i=>i.code==="DIALOGUE_MISMATCH"&&i.index===1));
});
test("話者取り違えをERRORにする",()=>{
 const d=fixture(),a=ready(d);a[0].observedSpeaker="staff";
 const r=Q.evaluate(d,"P01",a,meta);
 assert.equal(r.status,"MISMATCH");
 assert(r.issues.some(i=>i.code==="SPEAKER_MISMATCH"));
});
test("転記なし／話者未選択は未確認",()=>{
 const d=fixture(),a=ready(d);a[0].observedText="";a[0].observedSpeaker="";
 const r=Q.evaluate(d,"P01",a,meta);
 assert.equal(r.status,"INCOMPLETE");
 assert(r.issues.some(i=>i.code==="SPEAKER_UNKNOWN"));
 assert(r.issues.some(i=>i.code==="TEXT_NOT_TRANSCRIBED"));
});
test("画像の目視チェックなしでは注釈一致としない",()=>{
 const d=fixture(),a=ready(d);a[0].humanChecked=false;
 assert.equal(Q.evaluate(d,"P01",a,meta).status,"INCOMPLETE");
});
test("水平右から左の吹き出し順を注意喚起する",()=>{
 const d=fixture(),a=ready(d);a[0].x=.2;a[1].x=.8;
 const r=Q.evaluate(d,"P01",a,meta);
 assert.equal(r.warnings,1);
 assert(r.issues.some(i=>i.code==="RTL_POSITION_HINT"));
});
test("同じ場所を二回指定すると警告",()=>{
 const d=fixture(),a=ready(d);a[0].x=.5;a[1].x=.51;a[0].y=.4;a[1].y=.41;
 assert(Q.evaluate(d,"P01",a,meta).issues.some(i=>i.code==="OVERLAPPING_MARKERS"));
});
test("別作品のSOURCE LOCK不一致を注釈で上書きできない",()=>{
 const d=fixture();d.sourceInfo={origin:"mirror_factory_os_v09",sourceLockHash:"bad"};
 const r=Q.evaluate(d,"P01",ready(d),meta,"DIVERGED");
 assert.equal(r.status,"BLOCKED");
});
test("数値なし／座標範囲外／片方nullは拒否",()=>{
 const d=fixture(),a=ready(d);
 a[0].x=1.1;assert.throws(()=>Q.evaluate(d,"P01",a,meta),/形式/);
 a[0].x=null;assert.throws(()=>Q.evaluate(d,"P01",a,meta),/形式/);
});
test("重複コマIDや異常な注釈件数は拒否",()=>{
 const d=fixture(),a=ready(d);
 a[1].index=0;assert.throws(()=>Q.evaluate(d,"P01",a,meta),/形式/);
 assert.throws(()=>Q.evaluate(d,"P01",[],meta),/件数/);
});
test("不正画像ハッシュ・サイズ・画素数の画像は拒否",()=>{
 const d=fixture(),a=ready(d);
 assert.throws(()=>Q.evaluate(d,"P01",a,{...meta,sha256:"wrong"}),/ハッシュ/);
 assert.throws(()=>Q.evaluate(d,"P01",a,{...meta,width:5000}),/ハッシュ/);
 assert.throws(()=>Q.evaluate(d,"P01",a,{...meta,bytes:20e6}),/ハッシュ/);
});
test("検査レポートに実画像・OCRの虚偽結果を含めない",()=>{
 const d=fixture(),json=Q.safeReport(Q.evaluate(d,"P01",ready(d),meta));
 const obj=JSON.parse(json);
 assert.equal(obj.ocrPerformed,false);assert.equal(obj.canonApproved,false);
 assert.equal(obj.visualImageVerified,false);
 assert.equal(obj.image.sha256,meta.sha256);
 assert(!json.includes("data:image/"));
});
test("編集者が注釈を更新しても原本を変えない",()=>{
 const d=fixture(),before=JSON.stringify(d),ann=Q.newAnnotations(d,"P01");
 ann[0].observedText="変更";
 Q.evaluate(d,"P01",ann,meta);
 assert.equal(JSON.stringify(d),before);
});
test("画像ファイル自体は読み込まずメタ情報だけレポートへ渡す",()=>{
 const src=fs.readFileSync(path.join(__dirname,"balloon-qa.js"),"utf8");
 assert(!/\bfetch\s*\(/.test(src));
 assert(!/\bXMLHttpRequest\b/.test(src));
 assert(!/\bWebSocket\b/.test(src));
});
test("ブラウザHTMLのJS構文と入口／ダウンロード導線",()=>{
 const html=fs.readFileSync(path.join(__dirname,"balloon-lab.html"),"utf8");
 assert(html.includes('id="imgCanvas"'));
 assert(html.includes('id="docFile"'));
 assert(html.includes('id="imageFile"'));
 assert(html.includes('id="report"'));
 assert(html.includes("imageAnalyzedByAI")===false);
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))
   if(m[1].trim())assert.doesNotThrow(()=>new vm.Script(m[1]));
});

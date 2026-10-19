/* Run: node --test labs/comic-workbench/image-qa.test.cjs */
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const I=require("./image-qa.js");

function buffer(width,height,paint=()=>[15,20,25,255]){
  const out=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)
    out.set(paint(x,y),4*(y*width+x));
  return out;
}
function pixel(buf,width,x,y,color){buf.set(color,4*(y*width+x))}
const region={x:0.25,y:0.25,width:0.5,height:0.5};
function unchanged(){const a=buffer(10,10);return[a,a.slice()]}
const fingerprint=(sha="a".repeat(64))=>({sha256:sha,name:"MASTER.png",bytes:1234,width:10,height:10});
function sampleResult(){
  const [a,b]=unchanged();
  pixel(b,10,4,4,[250,0,0,255]);
  return I.compare(a,b,10,10,region);
}
test("画像の一部分だけ変えればPASS",()=>{
  const r=sampleResult();
  assert.equal(r.verdict,"PASS");assert.equal(r.inside.changed,1);
  assert.equal(r.outside.changed,0);assert.deepEqual(r.changedBounds,{x:4,y:4,width:1,height:1});
});
test("修正範囲外の1画素が0.5%を超えてFAIL",()=>{
  const [a,b]=unchanged();pixel(b,10,0,0,[230,0,0,255]);
  const r=I.compare(a,b,10,10,region);
  assert.equal(r.verdict,"FAIL");assert.equal(r.outside.changed,1);
});
test("元画像と完全一致の場合はPASSとせずNO_CHANGE",()=>{
  const [a,b]=unchanged();
  assert.equal(I.compare(a,b,10,10,region).verdict,"NO_CHANGE");
});
test("画素の微小差は許容差の範囲内",()=>{
  const [a,b]=unchanged();pixel(b,10,0,0,[35,20,25,255]);
  assert.equal(I.compare(a,b,10,10,region).verdict,"NO_CHANGE");
  assert.equal(I.compare(a,b,10,10,region,{channelTolerance:0}).verdict,"FAIL");
});
test("アルファチャンネルの大きな変化を検知",()=>{
  const [a,b]=unchanged();pixel(b,10,4,4,[15,20,25,0]);
  assert.equal(I.compare(a,b,10,10,region).inside.changed,1);
});
test("変更可能領域が画面外なら拒否",()=>{
  assert.throws(()=>I.validateRect({x:.85,y:.1,width:.2,height:.2}),/外側/);
});
test("全画面・巨大領域の指定は拒否",()=>{
  assert.throws(()=>I.validateRect({x:0,y:0,width:1,height:1}),/大きすぎ/);
});
test("ゼロサイズ/NaN/負数を拒否",()=>{
  for(const r of [
    {x:0,y:0,width:0,height:.2},
    {x:NaN,y:0,width:.2,height:.2},
    {x:-.1,y:0,width:.2,height:.2}
  ])assert.throws(()=>I.validateRect(r));
});
test("画像サイズの不一致を拒否",()=>{
  const [a,b]=unchanged();
  assert.throws(()=>I.compare(a,b.slice(0,30),10,10,region),/同じ縦横/);
});
test("画素400万超と不正寸法を拒否",()=>{
  assert.throws(()=>I.compare([],[],2001,2000,region),/400万/);
  assert.throws(()=>I.compare([],[],0,10,region),/サイズ/);
});
test("不正な設定や過大な許容差を拒否",()=>{
  const [a,b]=unchanged();
  assert.throws(()=>I.compare(a,b,10,10,region,{channelTolerance:100}),/0～64/);
  assert.throws(()=>I.compare(a,b,10,10,region,{maxOutsideFraction:0.2}),/0～10%/);
});
test("差分マスクはRGBAで正しい画素だけを赤くする",()=>{
  const [a,b]=unchanged();pixel(b,10,4,4,[250,0,0,255]);
  const mask=I.sampleChangedPixels(a,b,10,10);
  assert.deepEqual([...mask.slice((4*10+4)*4,(4*10+5)*4)],[255,65,86,158]);
  assert.deepEqual([...mask.slice(0,4)],[0,0,0,0]);
});
test("画像ハッシュが不正なら検査記録を拒否",()=>{
  assert.throws(()=>I.imageFingerprint(fingerprint("fake")),/ハッシュ/);
});
test("SHA-256のみを保持し、元画像データやメタ情報をコピーしない",()=>{
  const original={...fingerprint(),privateData:"not exported",name:"X".repeat(300)};
  const info=I.imageFingerprint(original);
  assert.equal(Object.hasOwn(info,"privateData"),false);
  assert.equal(info.name.length,180);
});
test("チェックを全部入れてもCanon承認にはならない",()=>{
  const report=I.makeReport({
    project:"himiko",panelId:"H01",master:fingerprint(),before:fingerprint("a".repeat(64)),
    after:fingerprint("b".repeat(64)),result:sampleResult(),
    review:{identity:true,clothing:true,dialogue:true,story:true}
  });
  assert.equal(report.readyForHumanReview,true);
  assert.equal(report.manualComplete,true);
  assert.equal(report.canonApproved,false);
  assert.equal(report.schema,"comic-image-report/v1");
  assert(!JSON.stringify(report).includes("privateData"));
});
test("顔や衣装の目視未完了を区別できる",()=>{
  const r=I.makeReport({
    project:"mirror",panelId:"P01",master:null,before:fingerprint(),
    after:fingerprint("b".repeat(64)),result:sampleResult(),
    review:{identity:false,clothing:true,dialogue:true,story:true}
  });
  assert.equal(r.manualComplete,false);
  assert.equal(r.master,null);
});
test("不正な作品IDとコマIDを拒否",()=>{
  const args={project:"mirror",panelId:"P01",before:fingerprint(),after:fingerprint("b".repeat(64)),
    result:sampleResult(),review:{identity:true,clothing:true,dialogue:true,story:true}};
  assert.throws(()=>I.makeReport({...args,project:"unknown"}),/作品ID/);
  assert.throws(()=>I.makeReport({...args,panelId:""}),/コマID/);
});
test("画像ラボと制作UIのJavaScriptに構文エラーがない",()=>{
  for(const name of ["index.html","image-lab.html"]){
    const html=fs.readFileSync(path.join(__dirname,name),"utf8");
    const blocks=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map(m=>m[1]).filter(Boolean);
    assert(blocks.length>0,"script block missing in "+name);
    for(const js of blocks)assert.doesNotThrow(()=>new vm.Script(js),name);
  }
});
test("画像比較機能は外部APIへ送信しないローカル実装",()=>{
  const src=fs.readFileSync(path.join(__dirname,"image-qa.js"),"utf8");
  assert(!/\bfetch\s*\(/.test(src));
  assert(!/\bXMLHttpRequest\b/.test(src));
  assert(!/\bWebSocket\b/.test(src));
});


test("ROI合成は指定領域内だけ候補画像をコピーする",()=>{
 const [before,after]=unchanged();
 pixel(after,10,4,4,[200,30,25,255]);
 pixel(after,10,0,0,[250,250,250,255]);
 const original=before.slice(),candidate=after.slice();
 const out=I.composeRegion(before,after,10,10,region);
 assert.deepEqual([...out.slice((4*10+4)*4,(4*10+5)*4)],[200,30,25,255]);
 assert.deepEqual([...out.slice(0,4)],[15,20,25,255]);
 assert.deepEqual(before,original,"元画像を改変しない");
 assert.deepEqual(after,candidate,"候補画像を改変しない");
});
test("ROI合成した画像は領域外のRGBAバイトが完全に一致",()=>{
 const a=buffer(100,100,(x,y)=>[x%256,y%256,(x+y)%256,255]);
 const b=buffer(100,100,()=>[255,80,50,128]);
 const r={x:.2,y:.2,width:.4,height:.4};
 const out=I.composeRegion(a,b,100,100,r);
 const result=I.compare(a,out,100,100,r,{channelTolerance:0});
 assert.equal(result.outside.changed,0);
 assert.equal(result.verdict,"PASS");
 assert(result.inside.changed>0);
});
test("合成領域が不正なら生成を拒否",()=>{
 const [a,b]=unchanged();
 assert.throws(()=>I.composeRegion(a,b,10,10,{x:0,y:0,width:1,height:1}),/大きすぎ/);
 assert.throws(()=>I.composeRegion(a,b,10,10,{x:-1,y:0,width:.2,height:.2}),/0～1/);
});
test("画像サイズが一致しなければ合成しない",()=>{
 const [a,b]=unchanged();
 assert.throws(()=>I.composeRegion(a,b.slice(0,20),10,10,region),/サイズ/);
});


test("広い画像で範囲外1画素だけ変化した候補をPASSにしない",()=>{
 const a=buffer(100,100),b=a.slice();
 pixel(b,100,0,0,[250,250,250,255]);
 const result=I.compare(a,b,100,100,region);
 assert.equal(result.inside.changed,0);
 assert(result.outside.fraction<0.005);
 assert.equal(result.verdict,"FAIL");
});
test("範囲内に変更があり範囲外差分が閾値内ならPASS",()=>{
 const a=buffer(100,100),b=a.slice();
 pixel(b,100,40,40,[250,10,10,255]);
 pixel(b,100,0,0,[250,10,10,255]);
 const result=I.compare(a,b,100,100,region);
 assert.equal(result.inside.changed,1);
 assert.equal(result.outside.changed,1);
 assert.equal(result.verdict,"PASS");
});

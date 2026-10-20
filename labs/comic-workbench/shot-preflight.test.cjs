const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const P=require("./shot-preflight.js");
function pixels(w,h,bars=[]){
 const data=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4;
  const dark=bars.some(v=>y>=v&&y<=v+3);
  data[i]=dark?10:90;data[i+1]=dark?10:125;data[i+2]=dark?10:150;data[i+3]=255;
 }
 return data;
}
test("1場面らしい高解像度画像でも自動Canon合格にはしない",()=>{
 const r=P.inspect(pixels(180,110),180,110,1920,1080);
 assert.equal(r.status,"NO_OBVIOUS_GRID_DETECTED");
 assert.equal(r.canonApproved,false);
 assert.equal(r.personIdentityVerified,false);
});
test("長い水平線が複数あるポスター状画像を検知",()=>{
 const r=P.inspect(pixels(180,110,[25,54,80]),180,110,1920,1080);
 assert.equal(r.status,"HOLD_FOR_REVIEW");
 assert(r.graphicBands.horizontal.length>=2);
 assert(r.issues.some(i=>i.code==="MULTI_PANEL_SUSPECTED"));
});
test("元サイズが小さければサンプルが大きくても保留",()=>{
 const r=P.inspect(pixels(180,110),180,110,900,450);
 assert(r.issues.some(i=>i.code==="IMAGE_DIMENSIONS_TOO_SMALL"));
});
test("無効なピクセル形式は検査せず拒否",()=>{
 assert.throws(()=>P.inspect(new Uint8ClampedArray(5),180,110,1920,1080),/画像データ/);
 assert.throws(()=>P.inspect(pixels(180,110),-1,110,1920,1080),/画像データ/);
});
test("証拠のない自動顔照合フラグを出さない",()=>{
 const r=P.inspect(pixels(180,110,[20,40]),180,110,1920,1080);
 assert.equal(r.pixelAnalysisOnly,true);assert.equal(r.personIdentityVerified,false);assert.equal(r.canonApproved,false);
});
test("モバイル端末用HTMLに元画像のSHAと手動確認欄と警告表示が存在",()=>{
 const html=fs.readFileSync(path.join(__dirname,"shot-preflight.html"),"utf8");
 for(const key of ["shot-preflight.js","sha256.js","sameCharacter","oneScene",
   "correctStory","noEmbeddedText","id=\"export\"","releaseDisposition"])assert(html.includes(key),key);
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)){
  if(m[1].trim())assert.doesNotThrow(()=>new vm.Script(m[1]));
 }
});

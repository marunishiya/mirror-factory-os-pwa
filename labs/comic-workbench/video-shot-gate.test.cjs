const test=require("node:test"),assert=require("node:assert/strict");
const {checkProduction}=require("./video-shot-gate.cjs");
function doc(){
 const make=(prefix)=>Array.from({length:6},(_,i)=>({
  id:prefix+String(i+1).padStart(2,"0"),
  type:i===3?"DETAIL":i===2?"MEDIUM":"WIDE",
  seconds:[5,5,5,4,5,6][i],
  line:["主人公","確定原稿の本文"],
  event:"画面に出る出来事",evidence:"後で回収する具体的な証拠",
  continuity:"現場の人物・小道具の位置関係"
 }));
 return {schema:"anger-shorts-noncanon-v4/1",
  works:{reina:{shots:make("R")},sane:{shots:make("S")}}};
}
function assets(){
 const out={};for(const slug of ["R","S"])for(let n=1;n<=6;n++){
  const id=slug+String(n).padStart(2,"0");
  out[id]={width:1600,height:900,sha256:(slug==="R"?"a":"b").repeat(60)+String(n).padStart(4,"0"),
   isStandaloneScene:true,contactSheet:false,identityReviewed:true,
   dialogueReviewed:true,causalityReviewed:true,imageQualityReviewed:true};
 }
 return out;
}
test("原画が未制作なら動画完成判定を拒否",()=>{
 const r=checkProduction(doc(),{});
 assert.equal(r.status,"BLOCKED");
 assert.equal(r.issueCount,12);
 assert.equal(r.machineApprovedForCanon,false);
});
test("6コマ固定・全景比率・30秒構成を満たす場合もCanon合格ではない",()=>{
 const result=checkProduction(doc(),assets());
 assert.equal(result.issueCount,0);
 assert.equal(result.status,"READY_FOR_MANUAL_FINAL_REVIEW");
 assert.equal(result.finishedVideoCertified,false);
});
test("以前のポスターを場面画像として再利用すると拒否",()=>{
 const a=assets();
 a.R01.contactSheet=true;
 a.R02.isStandaloneScene=false;
 const r=checkProduction(doc(),a);
 assert(r.issues.some(x=>x.code==="NOT_SINGLE_SCENE"));
});
test("画質不足や人物MASTER目視未確認なら拒否",()=>{
 const a=assets();a.S01.width=400;a.S01.identityReviewed=false;
 const r=checkProduction(doc(),a);
 assert(r.issues.some(x=>x.code==="SOURCE_TOO_SMALL"));
 assert(r.issues.some(x=>x.code==="HUMAN_REVIEW_REQUIRED"));
});
test("同じ絵を別コマのズーム素材として使う場合は拒否",()=>{
 const a=assets();a.R02.sha256=a.R01.sha256;
 assert(checkProduction(doc(),a).issues.some(x=>x.code==="REUSED_ASSET"));
});
test("読み順・セリフ・証拠・顔アップを厳密にチェック",()=>{
 const d=doc(),a=assets();
 d.works.reina.shots[0].id="R06";
 d.works.reina.shots[1].evidence="";
 d.works.reina.shots[2].line=["","セリフ"];
 d.works.reina.shots[3].type="CLOSE_UP";
 d.works.reina.shots[4].type="CLOSE_UP";
 const codes=new Set(checkProduction(d,a).issues.map(x=>x.code));
 for(const code of ["SHOT_ORDER","CAUSE_NOT_VISIBLE","INVALID_DIALOGUE","CLOSE_UP_EXCESS"])
  assert(codes.has(code),code);
});

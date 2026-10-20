/* Run: node --test labs/comic-workbench/authority.test.cjs */
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const A=require("./authority.js");
const photo=(sha="a".repeat(64))=>({sha256:sha,width:1200,height:900,bytes:250000,name:"master.png"});
const entry={kind:"character",characterId:"sane",label:"サネ",note:"ユーザー承認済み原本と目視照合"};
const make=()=>A.register(A.create("himiko"),"himiko",entry,photo(),true);
test("空の作品別台帳を作成できる",()=>{
  const d=A.create("mirror");assert.equal(d.project,"mirror");assert.equal(d.entries.length,0);
});
test("人物の原本画像SHA-256を変更不能な参照IDとして登録",()=>{
  const d=make();assert.equal(d.entries[0].sha256,"a".repeat(64));
  assert.equal(d.entries[0].assertion,"user-asserted");
  assert.equal(d.entries[0].label,"サネ");
});
test("明示的な確認がなければ台帳に登録しない",()=>{
  assert.throws(()=>A.register(A.create("himiko"),"himiko",entry,photo(),false),/確認/);
});
test("本人申告であり、正式Canonの認証印を偽装しない",()=>{
  const d=make();assert(!JSON.stringify(d).includes("officially-approved"));
  assert(!JSON.stringify(d).includes("canonApproved"));
});
test("原本と同じファイルならMATCH",()=>{
  assert.equal(A.verify(make(),"himiko","character","sane",photo()).status,"MATCH");
});
test("画素内容が別の画像ならMISMATCH",()=>{
  const r=A.verify(make(),"himiko","character","sane",photo("b".repeat(64)));
  assert.equal(r.status,"MISMATCH");assert.equal(r.expectedSha256,"a".repeat(64));
});
test("画像が未選択の場合はNO_IMAGE",()=>{
  assert.equal(A.verify(make(),"himiko","character","sane",null).status,"NO_IMAGE");
});
test("台帳そのものがない場合はNO_REGISTRY",()=>{
  assert.equal(A.verify(null,"himiko","character","sane",photo()).status,"NO_REGISTRY");
});
test("別作品のキャラクターには流用しない",()=>{
  assert.equal(A.verify(make(),"mirror","character","sane",photo()).status,"WRONG_PROJECT");
  assert.throws(()=>A.register(make(),"mirror",entry,photo(),true),/別作品/);
});
test("未登録人物は一致と扱わない",()=>{
  assert.equal(A.verify(make(),"himiko","character","himiko",photo()).status,"UNREGISTERED");
});
test("同じIDのMASTERを別画像に黙って上書きしない",()=>{
  const original=make();
  assert.throws(()=>A.register(original,"himiko",entry,photo("b".repeat(64)),true),/上書き/);
  assert.equal(original.entries[0].sha256,"a".repeat(64));
});
test("同じハッシュの再登録は冪等で重複しない",()=>{
  const a=make(),b=A.register(a,"himiko",entry,photo(),true);
  assert.equal(b.entries.length,1);
});
test("人物とシーンの参照は別ID空間",()=>{
  const a=make();
  const b=A.register(a,"himiko",{...entry,kind:"scene"},photo("b".repeat(64)),true);
  assert.equal(b.entries.length,2);
});
test("異なる寸法とファイルサイズも不一致として検出",()=>{
  const f={...photo(),width:800};assert.equal(A.verify(make(),"himiko","character","sane",f).status,"MISMATCH");
  const g={...photo(),bytes:200000};assert.equal(A.verify(make(),"himiko","character","sane",g).status,"MISMATCH");
});
test("不正なハッシュは取り込めない",()=>{
  assert.throws(()=>A.register(A.create("himiko"),"himiko",entry,photo("not-a-hash"),true),/SHA-256/);
});
test("未知スキーマを拒否",()=>{
  const a=make();a.schema="other";assert.throws(()=>A.normalize(a),/形式/);
});
test("重複IDや改ざん台帳を拒否",()=>{
  const a=make();a.entries.push({...a.entries[0]});
  assert.throws(()=>A.normalize(a),/複数/);
});
test("外部JSONの余計な権限・画像データは除去",()=>{
  const a=make();a.admin=true;a.entries[0].imageBytes="unsafe";a.entries[0].canonApproved=true;
  const c=A.normalize(a);
  assert.equal(c.admin,undefined);
  assert.equal(c.entries[0].imageBytes,undefined);
  assert.equal(c.entries[0].canonApproved,undefined);
});
test("JSONの出力と取込は同じ参照指紋を保つ",()=>{
  const d=make(),parsed=JSON.parse(A.safeJson(d));
  assert.deepEqual(A.normalize(parsed),d);
});
test("人物IDの文字種・長さを検証する",()=>{
  assert.throws(()=>A.register(A.create("himiko"),"himiko",{...entry,characterId:"../sane"},photo(),true));
  assert.throws(()=>A.register(A.create("himiko"),"himiko",{...entry,characterId:"X".repeat(65)},photo(),true));
});
test("台帳に実画像バイトを混ぜない",()=>{
  const d=make();assert.equal(JSON.stringify(d).includes("data:image"),false);
  assert.equal(typeof d.entries[0].sha256,"string");
});
test("参照台帳の最大数を検査",()=>{
  const d=A.create("mirror");
  d.entries=Array(51).fill(null);
  assert.throws(()=>A.normalize(d),/形式/);
});
test("画面と新しい参照処理のJavaScript構文",()=>{
  for(const name of ["index.html","image-lab.html"]){
    const html=fs.readFileSync(path.join(__dirname,name),"utf8");
    for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)){
      if(m[1].trim()) assert.doesNotThrow(()=>new vm.Script(m[1]),name);
    }
  }
});
test("参照台帳は外部への通信を実装しない",()=>{
  const src=fs.readFileSync(path.join(__dirname,"authority.js"),"utf8");
  assert(!/\bfetch\s*\(/.test(src));
  assert(!/\bXMLHttpRequest\b/.test(src));
  assert(!/\bWebSocket\b/.test(src));
});

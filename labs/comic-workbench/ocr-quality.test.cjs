const test=require("node:test"),assert=require("node:assert/strict"),Q=require("./ocr-quality.js");
const meta={imageSha256:"a".repeat(64),source:"local-desktop-ocr"};
const pair=(humanText,candidateText,verified=true,balloonIndex=0)=>
 ({humanText,candidateText,humanReviewed:verified,balloonIndex});
test("完全一致の日本語はCER=0で正確に表示",()=>{
 const r=Q.assess([pair("責任者を呼んでください。","責任者を呼んでください。")],meta);
 assert.equal(r.characterErrorRate,0);assert.equal(r.exactRate,1);
 assert.equal(r.canonApproved,false);assert.equal(r.modelValidated,false);
});
test("句点の欠落を黙って正規化しない",()=>{
 const r=Q.assess([pair("名前は何ですか。","名前は何ですか")],meta);
 assert.equal(r.rows[0].edits,1);
 assert.equal(r.rows[0].exact,false);
 assert(r.characterErrorRate>0);
});
test("似た別の漢字でも一致にはしない",()=>{
 const r=Q.compare("男","女");
 assert.equal(r.edits,1);assert.equal(r.characterErrorRate,1);
});
test("挿入・削除・置換、空白の全てを数える",()=>{
 assert.equal(Q.distance("あいう","あう"),1);
 assert.equal(Q.distance("あいう","あいうえ"),1);
 assert.equal(Q.distance("あいう","あいえ"),1);
 assert.equal(Q.distance("名 前","名前"),1);
});
test("絵文字はUnicode codepoint単位で処理",()=>{
 assert.equal(Q.compare("👀","👀").edits,0);
 assert.equal(Q.compare("😀","😁").edits,1);
});
test("元原稿以外の人が読み取った文字が必要、未確認はスコア集計しない",()=>{
 const r=Q.assess([pair("正しい","まちがい",false)],meta);
 assert.equal(r.measured,0);assert.equal(r.unreviewed,1);
 assert.equal(r.characterErrorRate,null);assert.equal(r.exactRate,null);
 assert.equal(r.rows[0].status,"NOT_HUMAN_VERIFIED");
});
test("複数吹き出しの誤文字率は文字数加重、正解率は行数基準",()=>{
 const r=Q.assess([pair("ああ","あい"),pair("ええええええええ","ええええええええ",true,1)],meta);
 assert.equal(r.measured,2);assert.equal(r.exactRate,0.5);
 assert.equal(r.totalEditOperations,1);assert.equal(r.totalReferenceCodepoints,10);
 assert.equal(r.characterErrorRate,0.1);
});
test("OCRの過剰な挿入でCERが100%を超える可能性を隠さない",()=>{
 const r=Q.compare("あ","あああ");
 assert.equal(r.edits,2);assert.equal(r.characterErrorRate,2);
});
test("確認済みなのに空文字・不正型だと測定拒否",()=>{
 assert.throws(()=>Q.assess([pair("","あ")],meta),/正解文字列/);
 assert.throws(()=>Q.assess([pair(123,"あ")],meta),/不正/);
 assert.throws(()=>Q.assess([],meta),/1〜80/);
});
test("人が確認してない巨大候補を拒否",()=>{
 assert.throws(()=>Q.assess([pair("", "あ".repeat(1201),false)],meta),/形式・長さ/);
});
test("元画像ハッシュがない結果の測定・出力を拒否",()=>{
 assert.throws(()=>Q.assess([pair("a","a")],{...meta,imageSha256:"no"}),/ハッシュ/);
});
test("JSON結果に悪意あるCanon承認属性があっても強制false",()=>{
 const r=Q.assess([pair("はい","はい")],meta);r.canonApproved=true;r.modelValidated=true;
 const obj=JSON.parse(Q.exportJson(r));
 assert.equal(obj.canonApproved,false);assert.equal(obj.modelValidated,false);
 assert.equal(obj.imageAutomaticallyVerified,false);
});

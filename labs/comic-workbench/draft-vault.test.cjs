const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
require("./sha256.js");
const V=require("./draft-vault.js"),W=require("./engine.js");
function mock(){
 const data=new Map();
 return {data,getItem(k){return data.get(k)??null},
   setItem(k,v){data.set(k,String(v))},removeItem(k){data.delete(k)}};
}
function d(label){const x=W.demo("mirror");x.title="草稿 "+label;return x;}
test("既定では保存無効・保存操作も書き込みなし",()=>{
 const storage=mock(),doc=d("A");
 const result=V.save(storage,doc,"P01",W.assertDocument);
 assert.equal(result.saved,false);assert.equal(storage.data.size,0);
});
test("利用者の許可後のみ独立した名前空間へ保存",()=>{
 const storage=mock();
 V.setEnabled(storage,true);
 assert.equal(V.save(storage,d("A"),"P01",W.assertDocument).saved,true);
 assert.equal(V.inspect(storage,W.assertDocument).latest.state,"VALID");
 assert(storage.data.has(V.KEYS.latest));
 for(const key of storage.data.keys())assert(key.startsWith("comic_workbench_private_drafts_v1:"));
});
test("2世代を保護し、最新・ひとつ前に復元できる",()=>{
 const s=mock();V.setEnabled(s,true);
 V.save(s,d("A"),"P01",W.assertDocument,"2026-10-20T00:00:00.000Z");
 V.save(s,d("B"),"P01",W.assertDocument,"2026-10-20T00:01:00.000Z");
 const overview=V.inspect(s,W.assertDocument);
 assert.equal(overview.latest.title,"草稿 B");
 assert.equal(overview.previous.title,"草稿 A");
 assert.equal(V.restore(s,"previous",W.assertDocument).doc.title,"草稿 A");
});
test("チェックポイントを保存しても元のドキュメントは変化しない",()=>{
 const s=mock(),doc=d("A"),old=JSON.stringify(doc);
 V.setEnabled(s,true);
 V.save(s,doc,"P01",W.assertDocument);
 assert.equal(JSON.stringify(doc),old);
});
test("保存内容の1文字破損を検出し復元を拒否",()=>{
 const s=mock();V.setEnabled(s,true);V.save(s,d("A"),"P01",W.assertDocument);
 const outer=JSON.parse(s.getItem(V.KEYS.latest));
 outer.payload=outer.payload.replace("草稿 A","草稿 B");
 s.setItem(V.KEYS.latest,JSON.stringify(outer));
 assert.equal(V.inspect(s,W.assertDocument).latest.state,"CORRUPTED");
 assert.throws(()=>V.restore(s,"latest",W.assertDocument),/検証/);
});
test("正規のSHA-256を使い破損を検証",()=>{
 const s=mock();V.setEnabled(s,true);V.save(s,d("A"),"P01",W.assertDocument);
 const wrapped=JSON.parse(s.getItem(V.KEYS.latest));
 assert(/^[a-f0-9]{64}$/.test(wrapped.digest));
 assert.equal(require("node:crypto").createHash("sha256").update(wrapped.payload).digest("hex"),wrapped.digest);
});
test("直近スナップショットが破損しても前世代を保持",()=>{
 const s=mock();V.setEnabled(s,true);
 V.save(s,d("A"),"P01",W.assertDocument);
 V.save(s,d("B"),"P01",W.assertDocument);
 const previous=s.getItem(V.KEYS.previous);
 s.setItem(V.KEYS.latest,"corrupt");
 V.save(s,d("C"),"P01",W.assertDocument);
 assert.equal(s.getItem(V.KEYS.previous),previous);
 assert.equal(V.restore(s,"previous",W.assertDocument).doc.title,"草稿 A");
});
test("容量超過エラー時に保存成功と報告しない",()=>{
 const s=mock();
 const original=s.setItem.bind(s);
 s.setItem=(k,v)=>{if(k===V.KEYS.latest)throw Error("QuotaExceededError");return original(k,v)};
 V.setEnabled(s,true);
 assert.throws(()=>V.save(s,d("A"),"P01",W.assertDocument),/QuotaExceeded/);
 assert.equal(V.inspect(s,W.assertDocument).latest.state,"EMPTY");
});
test("保存停止はチェックポイントを消去しない",()=>{
 const s=mock();V.setEnabled(s,true);V.save(s,d("A"),"P01",W.assertDocument);
 V.setEnabled(s,false);assert.equal(V.enabled(s),false);
 assert.equal(V.inspect(s,W.assertDocument).latest.state,"VALID");
 assert.equal(V.save(s,d("B"),"P01",W.assertDocument).saved,false);
 assert.equal(V.restore(s,"latest",W.assertDocument).doc.title,"草稿 A");
});
test("消去はラボ専用2キーだけ、同居のFACTORY OSには触れない",()=>{
 const s=mock();s.setItem("mirror_factory_os_v09","formal-data");
 V.setEnabled(s,true);V.save(s,d("A"),"P01",W.assertDocument);
 V.clear(s);
 assert.equal(s.getItem("mirror_factory_os_v09"),"formal-data");
 assert.equal(V.inspect(s,W.assertDocument).latest.state,"EMPTY");
});
test("同じ漫画ソースとは別の人物やキーの混入を拒否",()=>{
 const s=mock();V.setEnabled(s,true);
 assert.throws(()=>V.save(s,d("A"),"missing",W.assertDocument),/対象コマ/);
 assert.throws(()=>V.restore(s,"unknown",W.assertDocument),/復元対象/);
});
test("インポート用の改ざんスキーマを拒否",()=>{
 const s=mock();V.setEnabled(s,true);
 const invalid={schema:"comic-workbench/v2"};
 assert.throws(()=>V.save(s,invalid,"P01",W.assertDocument));
});
test("巨大な草稿を保存せずJSON保存へ誘導",()=>{
 const s=mock();V.setEnabled(s,true);const doc=d("A");
 doc.pages[0].panels[0].scene="a".repeat(V.MAX_BYTES+10);
 assert.throws(()=>V.save(s,doc,"P01",W.assertDocument),/上限/);
 assert.equal(s.getItem(V.KEYS.latest),null);
});
test("非対応保存インターフェイスは拒否",()=>{
 assert.throws(()=>V.enabled({getItem(){return null}}),/保存領域/);
});
test("HTMLに復元UI・同意・JSON手動保存が存在",()=>{
 const src=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
 for(const item of ["vaultEnable","vaultDisable","vaultRestoreLatest","vaultRestorePrevious","vaultClear","vaultStatus",
   "./draft-vault.js","./sha256.js","JSON保存","refreshVault();"]){
    assert(src.includes(item),"missing "+item);
 }
});
test("復旧保存は外部送信せず、データはFACTORYと別キー",()=>{
 const src=fs.readFileSync(path.join(__dirname,"draft-vault.js"),"utf8");
 assert(!/\bfetch\s*\(/.test(src));
 assert(!/\bXMLHttpRequest\b/.test(src));
 assert(!/\bWebSocket\b/.test(src));
 assert(!/localStorage\s*\.\s*setItem/.test(src));
 assert(!src.includes("mirror_factory_os_v09"));
});

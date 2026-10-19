const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"..","..");
const factory=fs.readFileSync(path.join(root,"index.html"),"utf8");
const lab=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");

test("既存FACTORY OSには手動のラボ起動リンクのみを追加",()=>{
  assert.match(factory,/id="comic-lab-entry"/);
  assert.match(factory,/href="\.\/labs\/comic-workbench\/index\.html"/);
  assert.match(factory,/FACTORY OSの確定原稿・MASTER・QA記録には書き戻しません/);
});
test("旧FACTORYの保存キー・DB名・原稿LOCK機能を維持",()=>{
 assert(factory.includes("const STORAGE_KEY=CREATOR_EDITION?'creator_factory_os_v04':'mirror_factory_os_v09'"));
 assert(factory.includes("const DB_NAME=CREATOR_EDITION?'creator_factory_assets_v04':'mirror_factory_assets_v09'"));
 assert(factory.includes("function sourceHash(lines)"));
 assert(factory.includes("function continuityStructure(p)"));
 assert(factory.includes("function preflightBackup("));
});
test("FACTORYに自動コマ編集を連動させる呼び出しは存在しない",()=>{
  const block=factory.match(/<div class="section panel" id="comic-lab-entry">([\s\S]*?)<\/div>/);
  assert(block,"opt-in-only launcher must exist");
  assert(!/onload|onfocus|onclick|localStorage|indexedDB|script|postMessage/.test(block[0]));
});
test("漫画ラボは自動取込せずユーザークリックのみでFACTORYを読む",()=>{
 assert(lab.includes('id="factoryScan"'));
 assert(lab.includes('id="factoryUse" disabled'));
 assert(lab.includes('B.fromStorage(window.localStorage)'));
 const inline=[...lab.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(x=>x[1]).filter(Boolean);
 assert(inline.length);
 for(const script of inline)assert.doesNotThrow(()=>new vm.Script(script));
});
test("新FACTORY連携の読み込みは出力用草稿のみで本体へ書かない",()=>{
 const src=fs.readFileSync(path.join(__dirname,"factory-bridge.js"),"utf8");
 assert(!/localStorage\s*\.\s*setItem\s*\(/.test(src));
 assert(!/indexedDB\s*\.\s*open\s*\(/.test(src));
 assert(!/fetch\s*\(/.test(src));
});

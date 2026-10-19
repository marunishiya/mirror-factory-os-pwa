/* Run with: node --test labs/comic-workbench/engine.test.cjs */
const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("./engine.js");

function withPanel(doc, id, mutate) {
  const d = JSON.parse(JSON.stringify(doc));
  for (const page of d.pages) for (const p of page.panels) if (p.id === id) mutate(p);
  return d;
}
function errors(doc) { return W.inspect(doc).filter(x => x.severity === "ERROR"); }
function ready(doc, id) {
  return withPanel(doc, id, p => {
    p.assetRef = "approved-artwork/"+id+".png";
    for (const key of W.CHECKS) p.visualChecks[key] = true;
    p.visibleProps = [...p.requiredProps];
    p.visibleClues = [...p.requiredClues];
  });
}

test("2つの非Canonデモはスキーマを満たす", () => {
  assert.equal(W.assertDocument(W.demo("mirror")), true);
  assert.equal(W.assertDocument(W.demo("himiko")), true);
  assert.match(W.demo("himiko").title,/非Canon/);
});
test("MIRRORの不足小道具・伏線がERRORになる", () => {
  const found = errors(W.demo("mirror"));
  assert(found.some(x => x.code === "MISSING_PROP" && x.panelId === "P03"));
  assert(found.some(x => x.code === "MISSING_CLUE" && x.panelId === "P03"));
});
test("部分修正は対象コマ以外を1文字も変更しない", () => {
  const d = W.demo("mirror"), originalOther = JSON.stringify(d.pages[0].panels.slice(1));
  const next = W.edit(d, "P01", {scene: "訂正した場面"});
  assert.equal(next.pages[0].panels[0].scene, "訂正した場面");
  assert.equal(JSON.stringify(next.pages[0].panels.slice(1)), originalOther);
  assert.notEqual(d.pages[0].panels[0].scene, "訂正した場面");
  assert.deepEqual(next.canon, d.canon);
});
test("Canon・ID・statusの差し替えは拒否", () => {
  for (const key of ["canon","id","status","audit"]) {
    assert.throws(()=>W.edit(W.demo("mirror"),"P01",{[key]:"改ざん"}),/許可されていない/);
  }
});
test("差分編集の直後だけ安全に取り消せる", () => {
  const d=W.demo("mirror");
  const next=W.edit(d,"P01",{scene:"test"});
  assert.deepEqual(W.undo(next),d);
  assert.throws(()=>W.undo(d),/取り消せる/);
});
test("不在話者と未知キャラクターを検出", () => {
  let d = withPanel(W.demo("mirror"),"P01",p=>{
    p.lines=[{speaker:"outsider",target:"guest",text:"聞いてください"}];
    p.cast.push("unknown");
  });
  const found=errors(d);
  assert(found.some(x=>x.code==="SPEAKER_NOT_PRESENT"));
  assert(found.some(x=>x.code==="UNREGISTERED_CAST"));
});
test("話者の役割違和感をWARNとして扱い誤断定しない", () => {
  const d=withPanel(W.demo("mirror"),"P01",p=>{
    p.lines=[{speaker:"staff",target:"guest",text:"責任者を呼んで"}];
  });
  assert(W.inspect(d).some(x=>x.code==="ROLE_CONTEXT"&&x.severity==="WARN"));
});
test("隠すべき証拠を早期表示するとERROR", () => {
  const d=withPanel(W.demo("mirror"),"P01",p=>{
    p.phase="setup";p.hiddenClues=["犯人の正体"];p.visibleClues=["犯人の正体"];
  });
  assert(errors(d).some(x=>x.code==="PREMATURE_REVEAL"));
});
test("公開段階なら早期ネタバレ扱いしない", () => {
  const d=withPanel(W.demo("mirror"),"P01",p=>{
    p.phase="reveal";p.hiddenClues=["犯人の正体"];p.visibleClues=["犯人の正体"];
  });
  assert(!errors(d).some(x=>x.code==="PREMATURE_REVEAL"));
});
test("卑弥呼の声：復元仮説に出典がないことをWARNする", () => {
  assert(W.inspect(W.demo("himiko")).some(x=>x.code==="HISTORY_SOURCE_MISSING"));
});
test("卑弥呼の声：未分類考証はERRORにする", () => {
  const d=withPanel(W.demo("himiko"),"H01",p=>{
    p.historicalClaims=[{subject:"服装",basis:"unknown",source:""}];
  });
  assert(errors(d).some(x=>x.code==="HISTORY_UNCLASSIFIED"));
});
test("未検証の画像や目視QAがあると承認できない", () => {
  assert.throws(()=>W.approve(W.demo("mirror"),"P01"),/画像参照/);
});
test("重大ERRORがあると承認できない", () => {
  const d=ready(W.demo("mirror"),"P03");
  d.pages[0].panels[2].visibleClues=[];
  assert.throws(()=>W.approve(d,"P03"),/未解決のERROR/);
});
test("人が検査し、重大ERRORがなければ草稿だけをロック", () => {
  const d=ready(W.demo("mirror"),"P01");
  const next=W.approve(d,"P01");
  assert.equal(next.pages[0].panels[0].status,"approved");
  assert.equal(next.pages[0].panels[1].status,"draft");
  assert.throws(()=>W.edit(next,"P01",{scene:"改ざん"}),/承認済みコマ/);
});
test("承認済みは不変、変更したければ別IDで草稿化", () => {
  const d=W.approve(ready(W.demo("mirror"),"P01"),"P01");
  const snapshot=JSON.stringify(d.pages[0].panels[0]);
  const {document:next,newPanelId}=W.forkDraft(d,"P01");
  assert.equal(JSON.stringify(next.pages[0].panels[0]),snapshot);
  assert.equal(next.pages[0].panels[1].id,newPanelId);
  assert.equal(next.pages[0].panels[1].status,"draft");
  assert.equal(next.pages[0].panels[1].visualChecks.identity,false);
  assert.equal(next.pages[0].panels[2].id,"P02");
});
test("スキーマ違反・コマIDの重複を拒否", () => {
  const d=W.demo("mirror");d.schema="unknown";assert.throws(()=>W.assertDocument(d),/スキーマ/);
  const x=W.demo("mirror");x.pages[0].panels[1].id="P01";
  assert.throws(()=>W.assertDocument(x),/重複/);
});
test("プロンプトに他コマ保護と考証区分が記載される", () => {
  assert.match(W.promptFor(W.demo("mirror"),"P01"),/承認済み他コマは一切変更しない/);
  assert.match(W.promptFor(W.demo("himiko"),"H01"),/reconstruction/);
});

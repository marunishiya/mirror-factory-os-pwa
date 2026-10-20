/* SOURCE LOCK imported draft regression suite. */
const test=require("node:test"),assert=require("node:assert/strict");
const W=require("./engine.js"),B=require("./factory-bridge.js");
function data(){
 const obj={version:"0.9",characters:[
  {id:"staff",name:"美咲",label:"美咲",verified:true},
  {id:"guest",name:"客",label:"客",verified:true}
 ],pages:[{id:"p08",chapter:"第4章",pageno:"P08",title:"問い",
  characters:["staff","guest"],locked:true,lines:[
   ["客","  責任者を呼んで。  "],["美咲","申し訳ございません。"],["画面","00:02"]
  ],continuity:{panels:[
   {number:1,lineIndices:[0],camera:"客"},
   {number:2,lineIndices:[1],camera:"店員"},
   {number:3,lineIndices:[2],camera:"時計"}
  ]}
 }],selectedPage:"p08"};
 obj.pages[0].sourceLockHash=B.sourceHash(obj.pages[0].lines);
 return obj;
}
const imported=()=>B.convert(data(),"p08");
const first=doc=>doc.pages[0].panels[0].id;
test("元原稿の空白・全角・画面セリフを完全保持",()=>{
 const doc=imported();
 assert.equal(doc.sourceInfo.originalSourceLines[0][1],"  責任者を呼んで。  ");
 assert.equal(doc.pages[0].panels[0].lines[0].text,"  責任者を呼んで。  ");
 assert.equal(doc.pages[0].panels[2].lines[0].text,"00:02");
 assert.equal(doc.sourceInfo.expectedPanels.length,3);
});
test("取り込み直後の3コマすべてがSOURCE LOCK一致",()=>{
 const doc=imported();
 for(const p of doc.pages[0].panels){
  const result=W.sourceReport(doc,p.id);
  assert.equal(result.status,"MATCH");assert.equal(result.verified,true);
 }
});
test("セリフの1文字変更で元原稿との差分ERROR",()=>{
 const doc=imported(),id=first(doc);
 const modified=W.edit(doc,id,{lines:[{speaker:"guest",target:"",text:"責任者を呼んで。"}]});
 assert.equal(W.sourceReport(modified,id).status,"DIVERGED");
 assert(W.panelReport(modified,id).some(x=>x.code==="SOURCE_LOCK_DIVERGED"&&x.severity==="ERROR"));
 assert.throws(()=>W.promptFor(modified,id),/元原稿/);
 assert.equal(W.sourceReport(doc,id).status,"MATCH");
});
test("話者だけ変更しても SOURCE LOCKを検出",()=>{
 const doc=imported(),id=first(doc);
 const modified=W.edit(doc,id,{lines:[{speaker:"staff",target:"",text:"  責任者を呼んで。  "}]});
 assert.equal(W.sourceReport(modified,id).status,"DIVERGED");
});
test("3つのコマのうち編集したコマだけが不一致",()=>{
 const doc=imported(),id=first(doc);
 const changed=W.edit(doc,id,{lines:[{speaker:"guest",target:"",text:"違う"}]});
 assert.equal(W.sourceReport(changed,doc.pages[0].panels[1].id).status,"MATCH");
});
test("SOURCE LOCK元原稿が未ロックの場合は未検証",()=>{
 const s=data();s.pages[0].locked=false;
 const doc=B.convert(s,"p08");
 assert.equal(W.sourceReport(doc,first(doc)).status,"SOURCE_UNVERIFIED");
});
test("元原稿の参照情報を消したデータは未検証",()=>{
 const doc=imported();delete doc.sourceInfo.expectedPanels;
 assert.equal(W.sourceReport(doc,first(doc)).status,"SOURCE_UNVERIFIED");
});
test("元原稿のハッシュを変更すると未検証",()=>{
 const doc=imported();doc.sourceInfo.sourceLockHash="deadbeef";
 assert.equal(W.sourceReport(doc,first(doc)).status,"SOURCE_UNVERIFIED");
});
test("参照情報にない追加コマは未検証",()=>{
 const doc=imported(),extra=structuredClone(doc.pages[0].panels[0]);
 extra.id="extra-draft";doc.pages[0].panels.push(extra);
 assert.equal(W.sourceReport(doc,"extra-draft").status,"SOURCE_UNVERIFIED");
});
test("画像・ストーリー修正後に過去の目視QA合格が消える",()=>{
 const doc=imported(),id=first(doc);
 doc.pages[0].panels[0].visualChecks=Object.fromEntries(W.CHECKS.map(k=>[k,true]));
 const changed=W.edit(doc,id,{scene:"構図を変更"});
 assert(W.CHECKS.every(k=>!changed.pages[0].panels[0].visualChecks[k]));
 assert(W.CHECKS.every(k=>doc.pages[0].panels[0].visualChecks[k]));
});
test("画像参照だけ変更しても過去の目視検査は失効",()=>{
 const doc=imported(),id=first(doc);
 doc.pages[0].panels[0].visualChecks=Object.fromEntries(W.CHECKS.map(k=>[k,true]));
 const changed=W.edit(doc,id,{assetRef:"new-image.png"});
 assert(W.CHECKS.every(k=>!changed.pages[0].panels[0].visualChecks[k]));
});
test("目視チェック項目だけの変更は有効",()=>{
 const doc=imported(),id=first(doc);
 const changed=W.edit(doc,id,{visualChecks:Object.fromEntries(W.CHECKS.map(k=>[k,true]))});
 assert(W.CHECKS.every(k=>changed.pages[0].panels[0].visualChecks[k]));
});
test("正しいSOURCEでも画像未確認なら承認不可",()=>{
 const doc=imported(),id=first(doc);
 assert.throws(()=>W.approve(doc,id),/画像参照/);
});
test("セリフ変更後は画像参照・チェックが揃っても承認不可",()=>{
 const doc=imported(),id=first(doc);
 let changed=W.edit(doc,id,{lines:[{speaker:"guest",target:"",text:"別のセリフ"}]});
 changed=W.edit(changed,id,{
   assetRef:"temp.png",visualChecks:Object.fromEntries(W.CHECKS.map(k=>[k,true]))
 });
 assert.throws(()=>W.approve(changed,id),/SOURCE LOCK/);
});
test("元原稿一致を回復すれば差分表示は解消",()=>{
 const doc=imported(),id=first(doc),old=doc.pages[0].panels[0].lines;
 const changed=W.edit(doc,id,{lines:[{speaker:"guest",target:"",text:"変更した文章"}]});
 const restored=W.edit(changed,id,{lines:old});
 assert.equal(W.sourceReport(restored,id).status,"MATCH");
});
test("非FACTORY作品は従来の目視承認ワークフローを維持",()=>{
 const doc=W.demo("himiko");
 assert.equal(W.sourceReport(doc,"H01").status,"NOT_IMPORTED");
});

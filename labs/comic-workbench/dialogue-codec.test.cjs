const test=require("node:test"),assert=require("node:assert/strict");
const C=require("./dialogue-codec.js"),B=require("./factory-bridge.js"),W=require("./engine.js");
test("元原稿の前後スペース・全角・区切り記号を無変更で往復",()=>{
 const original=[{speaker:"guest",target:"",text:"  責任者を呼んで。  | 次へ｜  "},
  {speaker:"staff",target:"guest",text:"　申し訳ございません。　"}];
 const t=C.format(original),p=C.retainOrParse(t,original);
 assert.deepEqual(p,original);assert.notEqual(p,original);
 assert.equal(p[0].text,"  責任者を呼んで。  | 次へ｜  ");
});
test("実際に編集した文章は原文とは別の差分として扱う",()=>{
 const original=[{speaker:"guest",target:"",text:"名前は？"}];
 const updated=C.retainOrParse("guest |  | 本当の名前は？",original);
 assert.notDeepEqual(updated,original);
 assert.deepEqual(updated,[{speaker:"guest",target:"",text:"本当の名前は？"}]);
});
test("本文内の区切り記号を破壊しない",()=>{
 const edited=C.parse("guest | staff | 最初|中間|最後");
 assert.equal(edited[0].text,"最初|中間|最後");
});
test("本文末尾の複数スペースを保持",()=>{
 const edited=C.parse("guest | staff | 最初の話  ");
 assert.equal(edited[0].text,"最初の話  ");
});
test("公式セリフの埋込み改行も無変更なら保持",()=>{
 const original=[{speaker:"A",target:"B",text:"一行目\n二行目"}];
 assert.deepEqual(C.retainOrParse(C.format(original),original),original);
});
test("書き換え後の形式不一致を拒否",()=>{
 assert.throws(()=>C.parse("話者と本文だけ"),/形式/);
 assert.throws(()=>C.parse(" |  | 本文"),/話者/);
});
test("ソース署名のある文面を黙って変更しない",()=>{
 const src={version:"0.9",characters:[{id:"guest",name:"客"}],
  pages:[{id:"a",chapter:"1",pageno:"P01",title:"test",characters:["guest"],locked:true,
   lines:[["客","   私の台詞   "] ]}]};
 src.pages[0].sourceLockHash=B.sourceHash(src.pages[0].lines);
 const d=B.convert(src,"a"),p=d.pages[0].panels[0];
 const next=W.edit(d,p.id,{lines:C.retainOrParse(C.format(p.lines),p.lines),scene:"別の構図"});
 assert.equal(next.pages[0].panels[0].lines[0].text,"   私の台詞   ");
 assert.equal(W.sourceReport(next,p.id).status,"MATCH");
});
test("SOURCE参照スナップショットの本文改ざんは拒否",()=>{
 const src={version:"0.9",characters:[{id:"staff",name:"美咲"}],pages:[{id:"a",chapter:"1",pageno:"P01",title:"test",characters:["staff"],locked:true,lines:[["美咲","ありがとうございます。"]]}]};
 src.pages[0].sourceLockHash=B.sourceHash(src.pages[0].lines);
 const d=B.convert(src,"a"),id=d.pages[0].panels[0].id;
 d.sourceInfo.expectedPanels[0].lines[0].text="改ざん";
 d.pages[0].panels[0].lines[0].text="改ざん";
 assert.equal(W.sourceReport(d,id).status,"DIVERGED");
});
test("確定セリフだけ元に戻し他のコマを保護",()=>{
 const src={version:"0.9",characters:[{id:"a",name:"A"}],pages:[{id:"a",chapter:"1",pageno:"P01",title:"test",characters:["a"],locked:true,
   lines:[["A","元の言葉"],["A","次の言葉"]],continuity:{panels:[{lineIndices:[0]},{lineIndices:[1]}]}}]};
 src.pages[0].sourceLockHash=B.sourceHash(src.pages[0].lines);
 const d=B.convert(src,"a"),id=d.pages[0].panels[0].id,other=JSON.stringify(d.pages[0].panels[1]);
 const changed=W.edit(d,id,{lines:[{speaker:"a",target:"",text:"改変"}]});
 const restored=W.restoreSourceLines(changed,id);
 assert.equal(W.sourceReport(restored,id).status,"MATCH");
 assert.equal(JSON.stringify(restored.pages[0].panels[1]),other);
 assert.equal(changed.pages[0].panels[0].lines[0].text,"改変");
});

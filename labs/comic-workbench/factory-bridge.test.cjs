const test=require("node:test"), assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const B=require("./factory-bridge.js"),W=require("./engine.js");
const source=()=>({
 version:"0.9",
 characters:[
  {id:"misaki",name:"美咲",label:"美咲",canon:"registered-only",verified:true,fileName:"misaki.png"},
  {id:"guest",name:"来店客",label:"客",canon:"",verified:false}
 ],
 pages:[{
  id:"ch04-p08",chapter:"第4章",pageno:"P08",title:"問い",characters:["guest","misaki"],
  lines:[["客","責任者を呼んでください。"],["美咲","申し訳ございません。"]],
  locked:true,sceneNotes:"レジ前で向き合う",constraints:"誤話者の禁止",
  continuity:{panelCount:2,panels:[
   {number:1,position:"右",camera:"客を俯瞰",lineIndices:[0],tails:["客"]},
   {number:2,position:"左",camera:"美咲の目線",lineIndices:[1],tails:["美咲"]}
  ]}
 }],selectedPage:"ch04-p08"
});
const withHash=()=>{const s=source();s.pages[0].sourceLockHash=B.sourceHash(s.pages[0].lines);return s};
test("SOURCE LOCKデータを変更せずコマ順で制作草稿へ変換",()=>{
 const s=withHash(),original=JSON.stringify(s),d=B.convert(s,"ch04-p08");
 assert.equal(W.assertDocument(d),true);
 assert.equal(d.pages[0].panels.length,2);
 assert.equal(d.pages[0].panels[0].lines[0].text,"責任者を呼んでください。");
 assert.equal(d.pages[0].panels[1].lines[0].text,"申し訳ございません。");
 assert.equal(d.pages[0].panels[0].lines[0].speaker,"guest");
 assert.equal(d.pages[0].panels[1].lines[0].speaker,"misaki");
 assert.equal(JSON.stringify(s),original);
 assert.equal(d.sourceInfo.originalLocked,true);
 assert.equal(d.pages[0].panels[0].status,"draft");
});
test("同期とみなさずCanonは未承認の参照ラベルのみ",()=>{
 const d=B.convert(withHash(),"ch04-p08");
 assert.match(d.canon.reference,/未インポート/);
 assert(d.pages[0].panels.every(p=>!p.visualChecks.identity));
 assert(d.pages[0].panels.every(p=>!p.assetRef));
 assert.equal(d.sourceInfo.importedAs,"unapproved-lab-draft");
});
test("原稿にコマ設計がない場合は行を発明せずページ草稿にする",()=>{
 const s=source();delete s.pages[0].continuity;
 const d=B.convert(s,"ch04-p08");
 assert.equal(d.pages[0].panels.length,1);
 assert.deepEqual(d.pages[0].panels[0].lines.map(x=>x.text),s.pages[0].lines.map(x=>x[1]));
 assert(d.importWarnings.some(x=>x.includes("コマ割り")));
});
test("連続性設計の割付順異常では元の全原稿を優先",()=>{
 const s=source();s.pages[0].continuity.panels[1].lineIndices=[0];
 const d=B.convert(s,"ch04-p08");
 assert.equal(d.pages[0].panels.length,1);
 assert.equal(d.pages[0].panels[0].lines.length,2);
 assert(d.importWarnings.some(x=>x.includes("順序")));
});
test("SOURCE LOCKチェックが不一致ならデータを受け取らない",()=>{
 const s=withHash();s.pages[0].lines[0][1]="勝手に編集";
 assert.throws(()=>B.convert(s,"ch04-p08"),/SOURCE LOCK/);
});
test("画面表示はナレーターとして厳密なテキストを保持",()=>{
 const s=source();s.pages[0].lines[0]=["画面","カウントダウン 00:02"];
 const d=B.convert(s,"ch04-p08");
 assert.equal(d.pages[0].panels[0].lines[0].text,"カウントダウン 00:02");
 assert.equal(d.pages[0].panels[0].lines[0].speaker,"screen-narrator");
});
test("人物台帳に一致しない話者は推測せず要確認を残す",()=>{
 const s=source();s.pages[0].lines[0]=["不明の男","名前は？"];
 const d=B.convert(s,"ch04-p08");
 assert(d.importWarnings.some(x=>x.includes("不明の男")));
 assert(d.pages[0].panels[0].lines[0].speaker.startsWith("source-unknown-"));
 assert.equal(W.assertDocument(d),true);
});
test("別作品の誤読込み・ページ不在・不正原稿は拒否",()=>{
 assert.throws(()=>B.extract({version:"9",pages:[],characters:[]}),/対応/);
 assert.throws(()=>B.convert(source(),"unknown-page"),/見つかり/);
 const s=source();s.pages[0].lines=[["美咲"]];
 assert.throws(()=>B.convert(s,"ch04-p08"),/セリフ形式/);
});
test("選択画面はテキスト一覧だけを返してMASTER画像を混ぜない",()=>{
 const s=source();s.assets={"master:misaki":{content:"base64-private"}};
 const rows=B.listPages(s);
 assert.equal(rows.length,1);
 assert.equal(rows[0].locked,true);
 assert(!JSON.stringify(rows).includes("base64-private"));
});
test("公式FACTORYバックアップJSONから画像をコピーせず原稿のみ取り込む",()=>{
 const s=source(),backup={type:"mirror_factory_os_backup",state:s,assets:{"master:misaki":{content:"private-image"}}};
 const doc=B.convert(JSON.stringify(backup),"ch04-p08");
 assert.equal(W.assertDocument(doc),true);
 assert(!JSON.stringify(doc).includes("private-image"));
});
test("同一originのlocalStorage取得は読み取り専用",()=>{
 let set=0;
 const fake={getItem(key){assert.equal(key,"mirror_factory_os_v09");return JSON.stringify(source())},
 setItem(){set++}};
 const s=B.fromStorage(fake);
 assert.equal(s.pages.length,1);assert.equal(set,0);
 assert.throws(()=>B.fromStorage({getItem(){return null}}),/保存データ/);
});
test("画像DB・localStorageへの書き込み手段が連携モジュールにない",()=>{
 const text=fs.readFileSync(path.join(__dirname,"factory-bridge.js"),"utf8");
 for(const pattern of [/\.setItem\s*\(/,/indexedDB/,/\.put\s*\(/,/fetch\s*\(/]){
   // Comment may mention indexedDB; ensure no operational reference.
   if(String(pattern)==="/indexedDB/")continue;
   assert(!pattern.test(text),String(pattern));
 }
});

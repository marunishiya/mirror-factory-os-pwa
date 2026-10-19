/* Source adapter for MIRROR FACTORY OS v0.9 -> independent Comic Workbench draft.
 * NEVER modifies the input, original localStorage, IndexedDB, or official Canon. */
(function(root,factory){
 "use strict";
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 root.ComicFactoryBridge=api;
})(typeof globalThis==="object"?globalThis:this,function(){
 "use strict";
 const KEY="mirror_factory_os_v09";
 const VALID_VERSIONS=new Set(["0.1","0.2","0.3","0.4","0.5","0.6","0.7","0.8","0.9"]);
 const copy=x=>JSON.parse(JSON.stringify(x));
 function invalid(text){throw Error(text);}
 function sourceHash(lines){
  let h=2166136261>>>0;
  const text=JSON.stringify(lines);
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  return h.toString(16).padStart(8,"0");
 }
 function extract(input){
  const data=typeof input==="string"?JSON.parse(input):input;
  const state=data?.type==="mirror_factory_os_backup"?data.state:data;
  if(!state||typeof state!=="object"||!VALID_VERSIONS.has(state.version)||
    !Array.isArray(state.characters)||!Array.isArray(state.pages)||
    state.characters.length>300||state.pages.length>3000){
   invalid("MIRROR FACTORY OSの対応データではありません");
  }
  return state;
 }
 function listPages(input){
  const state=extract(input);
  return state.pages.filter(p=>p&&typeof p.id==="string"&&typeof p.title==="string")
   .map(p=>({id:p.id,label:[p.chapter||"章未設定",p.pageno||"番号なし",p.title].join(" ／ "),
    locked:p.locked===true,panels:Array.isArray(p.continuity?.panels)?p.continuity.panels.length:0}));
 }
 function fromStorage(storage){
  if(!storage||typeof storage.getItem!=="function")invalid("安全なブラウザ保存領域が使えません");
  const value=storage.getItem(KEY);
  if(!value)invalid("このブラウザに既存FACTORY OSの保存データがありません。FACTORY OSの「バックアップ」を利用してください");
  return extract(value);
 }
 function convert(input,pageId){
  const s=extract(input);
  if(typeof pageId!=="string"||!pageId||pageId.length>150)invalid("ページIDが不正です");
  const p=s.pages.find(x=>x?.id===pageId);
  if(!p)invalid("該当ページが見つかりません");
  if(!Array.isArray(p.lines)||p.lines.length<1||p.lines.length>400||
    p.lines.some(x=>!Array.isArray(x)||x.length!==2||
      typeof x[0]!=="string"||!x[0].trim()||
      typeof x[1]!=="string"))invalid("確定原稿のセリフ形式が不正です");
  if(!Array.isArray(p.characters)||p.characters.length<1||p.characters.length>50 ||
    !Array.isArray(s.characters))invalid("登場人物の登録が不正です");
  if(p.locked&&p.sourceLockHash&&p.sourceLockHash!==sourceHash(p.lines)){
    invalid("SOURCE LOCKの原稿ハッシュが不一致です。既存FACTORY側のデータを確認してください");
  }
  const chars=new Map();
  for(const id of p.characters){
    if(typeof id!=="string"||!id||chars.has(id))invalid("登場人物IDが不正・重複しています");
    const c=s.characters.find(x=>x?.id===id);
    if(!c||typeof c.name!=="string"||!c.name)invalid("人物設定が見つかりません");
    chars.set(id,{id,name:c.name,role:"unknown",label:c.label||"",sourceVerified:c.verified===true});
  }
  const warnings=[];
  const additional=new Map();
  let unknownIndex=0;
  function speaker(name){
    if(name==="画面"||name==="ナレーション"){
      if(!chars.has("screen-narrator"))chars.set("screen-narrator",
        {id:"screen-narrator",name:"画面表示・ナレーション",role:"narrator",label:""});
      return "screen-narrator";
    }
    const matches=[...chars.values()].filter(c=>c.name===name||c.label===name||c.id===name);
    if(matches.length===1)return matches[0].id;
    if(additional.has(name))return additional.get(name);
    unknownIndex++;
    const id="source-unknown-"+unknownIndex;
    chars.set(id,{id,name:name.slice(0,150),role:"unresolved",label:""});
    additional.set(name,id);
    warnings.push("原稿の話者「"+name.slice(0,100)+"」が人物台帳に一意に対応しません。要確認");
    return id;
  }
  // Official continuity lineIndices are honored only when they cover all lines exactly once, in order.
  let groups=null;
  const cont=p.continuity;
  if(cont&&Array.isArray(cont.panels)&&cont.panels.length>0&&cont.panels.length<=12&&
    cont.panels.every(x=>x&&Array.isArray(x.lineIndices)&&x.lineIndices.every(Number.isInteger))){
    const indices=cont.panels.flatMap(x=>x.lineIndices);
    if(indices.length===p.lines.length&&indices.every((n,i)=>n===i)){
      groups=cont.panels.map((x,i)=>({indices:x.lineIndices,scene:String(x.camera||x.position||"構図未登録"),
        number:i+1}));
    }else warnings.push("コマ割りのセリフ番号・順序が確定原稿と一致しないため、1ページ草稿として取り込みました");
  }
  if(!groups){
    groups=[{indices:p.lines.map((_,i)=>i),scene:"コマ割り未確認（原稿一括）",number:1}];
    if(!cont?.panels)warnings.push("このページにコマ割りがありません。個別コマは創作せずページ全体の草稿にしています");
  }
  if(groups.length>30)invalid("コマ数が上限を超えています");
  const sourceCharacters=[...chars.keys()];
  const panels=groups.map(g=>({
    id:"FACTORY-"+p.id+"-"+String(g.number).padStart(2,"0"),
    scene:[p.sceneNotes||p.constraints||"",g.scene].filter(Boolean).join(" / ").slice(0,1000),
    phase:"investigation",cast:[],requiredCast:[],lines:[],
    requiredProps:[],visibleProps:[],requiredClues:[],visibleClues:[],
    hiddenClues:[],historicalClaims:[],
    visualChecks:{identity:false,bubbleSpeaker:false,storyLogic:false,visualEvidence:false},
    assetRef:"",status:"draft",revision:0
  }));
  groups.forEach((g,i)=>{
    const panel=panels[i],cast=new Set();
    for(const n of g.indices){
      const line=p.lines[n],who=speaker(line[0]);
      cast.add(who);
      panel.lines.push({speaker:who,target:"",text:line[1]});
    }
    for(const id of p.characters)cast.add(id);
    panel.cast=[...cast];
    panel.requiredCast=[...cast];
  });
  const canonCharacters=[...chars.values()].map(c=>({
    id:c.id,name:c.name,role:c.role
  }));
  const result={
    schema:"comic-workbench/v1",project:"mirror",
    title:[p.chapter||"章不明",p.pageno||"ページ番号未設定",p.title||"無題"].join(" ")+"（FACTORY読取コピー）",
    canon:{reference:"MIRROR FACTORY OS登録情報の読取コピー。承認済み画像は未インポート／再照合が必要。",
      characters:canonCharacters},
    pages:[{id:"factory-page-"+p.id,panels}],audit:[],
    sourceInfo:{
      origin:"mirror_factory_os_v09",originalPageId:p.id,
      originalLocked:p.locked===true,sourceLockHash:p.sourceLockHash||null,
      originalSourceLines:p.lines.map(l=>[l[0],l[1]]),
      expectedPanels:panels.map((panel,i)=>({
        id:panel.id,indices:groups[i].indices.slice(),
        lines:panel.lines.map(l=>({speaker:l.speaker,text:l.text}))
      })),
      sourceLineCount:p.lines.length,originalPanelCount:groups.length,
      originalSelectedPage:s.selectedPage===p.id,
      importedAs:"unapproved-lab-draft",reversible:false
    },
    importWarnings:warnings
  };
  return copy(result);
 }
 return Object.freeze({KEY,sourceHash,extract,listPages,fromStorage,convert});
});
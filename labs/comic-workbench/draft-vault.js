/* Versioned, consent-only, local draft checkpoints.
 * Never touches MIRROR FACTORY OS keys, IndexedDB, Canon, or network. */
(function(root,factory){
 "use strict";
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 root.ComicDraftVault=api;
})(typeof globalThis==="object"?globalThis:this,function(){
 "use strict";
 const PREFIX="comic_workbench_private_drafts_v1:";
 const KEYS=Object.freeze({consent:PREFIX+"enabled",latest:PREFIX+"latest",previous:PREFIX+"previous"});
 const SCHEMA="comic-draft-checkpoint/v1",MAX_BYTES=900000;
 const utf8=s=>new TextEncoder().encode(s);
 const copy=x=>JSON.parse(JSON.stringify(x));
 const sha=s=>{
  const h=typeof globalThis!=="undefined"?globalThis.ComicHash:null;
  if(h?.pure)return h.pure(utf8(s));
  // Node tests supply ComicHash globally; browser loads sha256.js before this module.
  throw Error("SHA-256ライブラリが未接続です");
 };
 function checkedStore(storage){
  if(!storage||typeof storage.getItem!=="function"||
    typeof storage.setItem!=="function"||typeof storage.removeItem!=="function")
    throw Error("ブラウザの草稿保存領域を利用できません");
  return storage;
 }
 function enabled(storage){return checkedStore(storage).getItem(KEYS.consent)==="yes";}
 function setEnabled(storage,yes){
  checkedStore(storage);
  if(yes===true)storage.setItem(KEYS.consent,"yes");
  else if(yes===false)storage.removeItem(KEYS.consent);
  else throw Error("草稿保存の許可状態が不正です");
 }
 function make(doc,selected,now){
  if(!doc||typeof doc!=="object"||doc.schema!=="comic-workbench/v1")
    throw Error("保存対象の作品データが不正です");
  if(typeof selected!=="string"||!selected||
    !doc.pages?.some(pg=>pg.panels?.some(p=>p.id===selected)))
    throw Error("保存対象コマが見つかりません");
  const date=now===undefined?new Date().toISOString():now;
  if(typeof date!=="string"||!Number.isFinite(Date.parse(date))||date.length>40)
    throw Error("チェックポイント日時が不正です");
  const payload=JSON.stringify({schema:SCHEMA,createdAt:date,selected,doc});
  if(utf8(payload).length>MAX_BYTES)
    throw Error("草稿が端末自動保存の上限を超えました。JSONを直接保存してください");
  const envelope={schema:SCHEMA,digest:sha(payload),payload};
  return JSON.stringify(envelope);
 }
 function unpack(raw,assertDocument){
  if(typeof raw!=="string"||raw.length>MAX_BYTES*1.4)throw Error("チェックポイントのサイズが不正です");
  const outer=JSON.parse(raw);
  if(outer?.schema!==SCHEMA||typeof outer.payload!=="string"||
     !/^[a-f0-9]{64}$/.test(outer.digest||"")||
     sha(outer.payload)!==outer.digest)throw Error("草稿チェックポイントの検証に失敗しました");
  const obj=JSON.parse(outer.payload);
  if(obj?.schema!==SCHEMA||typeof obj.createdAt!=="string"||
    !Number.isFinite(Date.parse(obj.createdAt))||
    typeof obj.selected!=="string"||!obj.doc)
     throw Error("草稿チェックポイントの形式が不正です");
  assertDocument(obj.doc);
  if(!obj.doc.pages.some(pg=>pg.panels.some(p=>p.id===obj.selected)))
    throw Error("保存されていたコマが見つかりません");
  return copy(obj);
 }
 function slot(storage,name,assertDocument){
  checkedStore(storage);
  if(!["latest","previous"].includes(name))throw Error("復元対象が不正です");
  const raw=storage.getItem(KEYS[name]);
  if(!raw)return {slot:name,state:"EMPTY"};
  try{
   const obj=unpack(raw,assertDocument);
   return {slot:name,state:"VALID",createdAt:obj.createdAt,
     title:obj.doc.title,project:obj.doc.project,selected:obj.selected,
     bytes:utf8(raw).length};
  }catch(e){return {slot:name,state:"CORRUPTED",error:e.message};}
 }
 function inspect(storage,assertDocument){
  return {enabled:enabled(storage),latest:slot(storage,"latest",assertDocument),
    previous:slot(storage,"previous",assertDocument)};
 }
 function restore(storage,name,assertDocument){
  checkedStore(storage);
  if(!["latest","previous"].includes(name))throw Error("復元対象が不正です");
  const raw=storage.getItem(KEYS[name]);
  if(!raw)throw Error("選択した復元ポイントがありません");
  return unpack(raw,assertDocument);
 }
 function save(storage,doc,selected,assertDocument,now){
  checkedStore(storage);
  if(!enabled(storage))return {saved:false,reason:"DISABLED"};
  assertDocument(doc);
  const next=make(doc,selected,now);
  const older=storage.getItem(KEYS.latest);
  // Rotate only verified latest records; corrupted records cannot displace a valid previous.
  if(older){
   try{
    unpack(older,assertDocument);
    storage.setItem(KEYS.previous,older);
   }catch(_){}
  }
  storage.setItem(KEYS.latest,next); // if quota error: never report success
  return {saved:true,bytes:utf8(next).length};
 }
 function clear(storage){
  checkedStore(storage);
  storage.removeItem(KEYS.latest);
  storage.removeItem(KEYS.previous);
 }
 return Object.freeze({KEYS,SCHEMA,MAX_BYTES,enabled,setEnabled,inspect,slot,
   restore,save,clear,unpack,make});
});
/* Local-only reference registry. No canonical images or external code bundled. */
(function(root,factory){
  "use strict";
  const api=factory();
  if(typeof module==="object" && module.exports) module.exports=api;
  root.ComicAuthority=api;
})(typeof globalThis==="object"?globalThis:this,function(){
  "use strict";
  const SCHEMA="comic-authority-registry/v1";
  const sha=/^[a-f0-9]{64}$/;
  const idPattern=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
  const ALLOWED=["mirror","himiko"];
  function fail(s){throw Error(s)}
  function validateFile(f){
    if(!f||typeof f!=="object"||!sha.test(f.sha256||"")||!Number.isInteger(f.width)||
       !Number.isInteger(f.height)||f.width<1||f.height<1||!Number.isInteger(f.bytes)||
       f.bytes<1||f.bytes>10*1024*1024)fail("画像SHA-256・寸法・サイズが不正です");
    return {sha256:f.sha256,width:f.width,height:f.height,bytes:f.bytes};
  }
  function cleanEntry(e){
    if(!e||typeof e!=="object"||Array.isArray(e)||
      !idPattern.test(e.characterId||"")||!["character","scene"].includes(e.kind)||
      typeof e.label!=="string"||e.label.trim().length<1||e.label.length>120||
      typeof e.note!=="string"||e.note.length>500||e.assertion!=="user-asserted"||
      typeof e.fileName!=="string"||e.fileName.length>180) {
      fail("MASTER参照項目の形式が不正です");
    }
    return {
      characterId:e.characterId,kind:e.kind,label:e.label,note:e.note,
      assertion:"user-asserted",fileName:e.fileName,
      ...validateFile(e)
    };
  }
  function create(project){
    if(!ALLOWED.includes(project))fail("作品名が不正です");
    return {schema:SCHEMA,project,entries:[]};
  }
  function normalize(json){
    if(!json||typeof json!=="object"||Array.isArray(json)||
      json.schema!==SCHEMA||!ALLOWED.includes(json.project)||
      !Array.isArray(json.entries)||json.entries.length>50) {
      fail("参照台帳の形式が不正です");
    }
    const keys=new Set();
    const entries=json.entries.map(e=>{
      const clean=cleanEntry(e),key=clean.kind+":"+clean.characterId;
      if(keys.has(key))fail("同じMASTER参照IDを複数登録できません");
      keys.add(key);
      return clean;
    });
    return {schema:SCHEMA,project:json.project,entries};
  }
  function register(registry,project,detail,file,manualConfirmed){
    const reg=normalize(registry);
    if(reg.project!==project)fail("別作品のMASTERを混在させません");
    if(manualConfirmed!==true)fail("承認済みMASTER原本か利用者の確認が必要です");
    const meta=validateFile(file);
    if(!detail||typeof detail!=="object"||!idPattern.test(detail.characterId||"")||
       !["character","scene"].includes(detail.kind)||typeof detail.label!=="string"||
       !detail.label.trim()||detail.label.length>120||
       typeof detail.note!=="string"||detail.note.length>500) {
      fail("人物ID・区分・表示名・確認メモを見直してください");
    }
    const entry=cleanEntry({
      characterId:detail.characterId,kind:detail.kind,label:detail.label,
      note:detail.note,assertion:"user-asserted",
      fileName:String(file.name||"").slice(0,180),...meta
    });
    const key=entry.kind+":"+entry.characterId;
    const existing=reg.entries.find(e=>e.kind+":"+e.characterId===key);
    if(existing){
      if(existing.sha256!==entry.sha256)fail("既存のMASTER参照を上書きできません。別ID・別台帳で検証してください");
      return reg;
    }
    if(reg.entries.length>=50)fail("登録上限（50件）に達しました");
    reg.entries.push(entry);
    return reg;
  }
  function verify(registry,project,kind,characterId,file){
    if(!registry)return {status:"NO_REGISTRY",characterId,kind};
    const reg=normalize(registry);
    if(project!==reg.project)return {status:"WRONG_PROJECT",characterId,kind};
    if(!idPattern.test(characterId||"")||!["character","scene"].includes(kind)){
      return {status:"UNREGISTERED",characterId:String(characterId||""),kind};
    }
    const entry=reg.entries.find(e=>e.kind===kind&&e.characterId===characterId);
    if(!entry)return {status:"UNREGISTERED",characterId,kind};
    if(!file)return {status:"NO_IMAGE",characterId,kind,expectedSha256:entry.sha256};
    const info=validateFile(file);
    const ok=info.sha256===entry.sha256&&info.width===entry.width&&info.height===entry.height&&info.bytes===entry.bytes;
    return {status:ok?"MATCH":"MISMATCH",characterId,kind,
      expectedSha256:entry.sha256,actualSha256:info.sha256};
  }
  function safeJson(reg){return JSON.stringify(normalize(reg),null,2)}
  return Object.freeze({SCHEMA,create,normalize,register,verify,safeJson});
});
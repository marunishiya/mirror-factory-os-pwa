'use strict';
/**
 * Offline end-to-end proof: real source/Master byte checks -> existing preflight
 * -> provider boundary (MOCK ONLY) -> image-byte SHA & PNG dimensions
 * -> existing postflight. No network, API key, publishing or Canon mutation.
 */
const crypto=require('node:crypto');
const {validatePlan,validateCandidate}=require('./page-gate.cjs');
const {assessRetry,assessResult}=require('./retry-controller.cjs');
const SHA=/^[0-9a-f]{64}$/i;
const digest=buf=>crypto.createHash('sha256').update(buf).digest('hex');
const maxSource=1024*1024, maxMaster=16*1024*1024, maxImage=24*1024*1024;
const mockPng=Buffer.from(
 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64'
);
function inspectPng(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<33||bytes.length>maxImage)
   throw Error('IMAGE_BYTES_INVALID');
 if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
    bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')
   throw Error('ONLY_PNG_SUPPORTED');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(!width||!height||width>8192||height>8192||width*height>64_000_000)
   throw Error('IMAGE_SIZE_INVALID');
 return {width,height,sha256:digest(bytes)};
}
function blocked(reason,details={}) {
 return {status:'BLOCKED',reason,...details,providerCalled:false,
  artApproved:false,canonApproved:false,publicationApproved:false};
}
function verifyMasterFiles(characterIds,masters,registry){
 const result=[],issues=[];
 for(const id of characterIds){
  const bytes=masters?.[id], entry=registry?.[id];
  if(!Buffer.isBuffer(bytes)||bytes.length<33||bytes.length>maxMaster){
   issues.push({code:'MASTER_FILE_MISSING_OR_INVALID',characterId:id});continue;
  }
  const actual=digest(bytes);
  if(!entry||entry.confirmedByUser!==true||!SHA.test(entry.sha256)||
      entry.sha256!==actual){
   issues.push({code:'MASTER_AUTHORITY_UNVERIFIED',characterId:id});continue;
  }
  // User-approved masters include JPEG (Kenta) and PNG (Mina).
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&
    bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217;
  let png=false;
  try {inspectPng(bytes);png=true;} catch{}
  if(!jpeg&&!png){
   issues.push({code:'MASTER_IMAGE_FORMAT_UNSUPPORTED',characterId:id});continue;
  }
  result.push({characterId:id,sha256:actual,fileAccessible:true,
   hashMatched:true,suppliedToGenerator:true});
 }
 return {references:result,issues};
}
function runMockPanel({
 intent='generate',sourceBytes,plan,panelId,prompt,masterBytes,
 approvedRegistry,approvedAssets=[],history=[],fix,renderMode='mock'
}={}){
 if(renderMode!=='mock')return blocked('PAID_OR_UNKNOWN_PROVIDER_DISABLED');
 if(!Buffer.isBuffer(sourceBytes)||sourceBytes.length>maxSource)
   return blocked('SOURCE_BYTES_MISSING_OR_TOO_LARGE');
 let raw;
 try {raw=JSON.parse(sourceBytes.toString('utf8'));}
 catch{return blocked('SOURCE_LOCK_JSON_INVALID');}
 const sourceLockSha256=digest(sourceBytes);
 if(!raw||!Array.isArray(raw.panels)||!raw.panels.length||!raw.pageId)
   return blocked('SOURCE_LOCK_SCHEMA_INVALID');
 if(!plan||plan.pageId!==raw.pageId||plan.sourceLockSha256!==sourceLockSha256)
   return blocked('LOCK_DOES_NOT_MATCH_BYTES');
 if(!Number.isInteger(panelId)||panelId<1||panelId>raw.panels.length||
    !raw.panels.some(x=>x.panel===panelId))
   return blocked('INVALID_PANEL_ID');
 if(!Array.isArray(plan.requiredCharacterIds)||!plan.requiredCharacterIds.length)
   return blocked('REQUIRED_MASTER_UNKNOWN');
 const checks=verifyMasterFiles(plan.requiredCharacterIds,masterBytes,approvedRegistry);
 if(checks.issues.length)return blocked('MASTER_CHECK_FAILED',{issues:checks.issues});
 if(typeof prompt!=='string'||!prompt.trim()||prompt.length>12000)
   return blocked('PROMPT_MISSING');
 // Identity for the ENTIRE input. No self-reported hash or untracked retry.
 const inputSha256=digest(Buffer.from(JSON.stringify({
  sourceLockSha256,pageId:raw.pageId,panelId,prompt,
  storyboard:plan.storyboard,masters:checks.references.map(x=>[x.characterId,x.sha256]),
  engine:'offline-mock-v1'
 })));
 const onPanel=Array.isArray(history)&&history.some(x=>x?.pageId===raw.pageId&&x?.panelId===panelId);
 const retryEvidence={panelId,history,approvedAssets,fix,proposedInputSha256:inputSha256};
 const populated={...plan,masterReferences:checks.references,
   previousFailedCandidate:Boolean(onPanel),
   retryEvidence,fix:onPanel?{
    failureCode:fix?.defectCode,rootCause:fix?.rootCause,
    changedElement:fix?.changedElement,
    measurableAcceptanceCriterion:fix?.verificationMethod
   }:undefined
 };
 // New works also pass the approved-art and budget guard (not only retakes).
 const retry=assessRetry({intent,pageId:raw.pageId,panelId,
  sourceLockSha256,history,approvedAssets,fix,proposedInputSha256:inputSha256});
 if(retry.status==='BLOCKED')return blocked('RETRY_OR_APPROVAL_GUARD',{retry});
 const lock={...raw,sha256:sourceLockSha256};
 const preflight=validatePlan({intent,plan:populated,lock});
 if(preflight.status!=='REVIEW_REQUIRED')
   return blocked('PAGE_PREFLIGHT_BLOCKED',{retry,preflight});
 // Real provider boundary intentionally unimplemented; mock PNG only.
 const bytes=Buffer.from(mockPng);
 const actual=inspectPng(bytes);
 const candidate={pageId:raw.pageId,panelId,sourceLockSha256,inputSha256,
   outputSha256:actual.sha256,sha256:actual.sha256,
   width:actual.width,height:actual.height,renderProvenance:'mock-only'};
 const resultQa=assessResult({sourceLockSha256,history,candidate,verifiedQA:null});
 const pageQa=validateCandidate({lock,candidate,review:null});
 return {
  status:'MOCK_ONLY_NOT_ART',providerCalled:false,
  lockSha256:sourceLockSha256,inputSha256,
  candidate,preflight,retry,resultQa,pageQa,
  outputBytes:bytes,
  artApproved:false,canonApproved:false,publicationApproved:false,
  note:'1x1のテスト画像。作画/本人性/日本語吹き出しは未実行。外部画像生成APIは呼んでいない。'
 };
}
module.exports={runMockPanel,verifyMasterFiles,inspectPng,digest};

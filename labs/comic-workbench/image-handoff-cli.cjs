#!/usr/bin/env node
'use strict';
/**
 * Offline read-only PNG handoff.
 * node labs/comic-workbench/image-handoff-cli.cjs job.json candidate.png [report.json]
 * Does not generate artwork, call any API, or mutate supplied images.
 */
const fs=require('node:fs');
const path=require('node:path');
const {ingestOfflineCandidate}=require('./image-handoff.cjs');
function main(argv){
 if(argv.length<2||argv.length>3)throw Error('USAGE: node image-handoff-cli.cjs job.json candidate.png [report.json]');
 const [jobPath,imagePath,outPath]=argv.map(x=>path.resolve(x));
 if(!fs.statSync(jobPath).isFile()||fs.statSync(jobPath).size>1024*1024)
   throw Error('JOB_MANIFEST_MISSING_OR_TOO_LARGE');
 const job=JSON.parse(fs.readFileSync(jobPath,'utf8'));
 if(!job||typeof job!=='object'||!job.sourceLockFile||
     !job.plan||!job.masterFiles||!job.approvedRegistry)
   throw Error('JOB_SCHEMA_INVALID');
 const sourceBytes=fs.readFileSync(path.resolve(job.sourceLockFile));
 const masterBytes={};
 for(const id of job.plan.requiredCharacterIds||[]){
   if(!Object.hasOwn(job.masterFiles,id))throw Error('MASTER_PATH_MISSING');
   masterBytes[id]=fs.readFileSync(path.resolve(job.masterFiles[id]));
 }
 const imageBytes=fs.readFileSync(imagePath);
 const result=ingestOfflineCandidate({
   intent:'generate',sourceBytes,plan:job.plan,panelId:job.panelId,
   prompt:job.prompt,masterBytes,approvedRegistry:job.approvedRegistry,
   approvedAssets:job.approvedAssets||[],history:job.history||[],
   fix:job.fix,expectedOutput:job.expectedOutput||'single_panel',imageBytes
 });
 const text=JSON.stringify(result,null,2)+'\n';
 process.stdout.write(text);
 if(outPath){
   if(outPath===imagePath||outPath===jobPath||
      outPath===path.resolve(job.sourceLockFile))
     throw Error('REFUSE_TO_OVERWRITE_INPUT');
   if(fs.existsSync(outPath))throw Error('REFUSE_TO_OVERWRITE_EXISTING_REPORT');
   fs.writeFileSync(outPath,text,{flag:'wx',mode:0o600});
 }
 return result.status==='QUARANTINED'?2:0;
}
if(require.main===module){
 try{process.exitCode=main(process.argv.slice(2));}
 catch(e){process.stderr.write(String(e.message)+'\n');process.exitCode=2;}
}
module.exports={main};

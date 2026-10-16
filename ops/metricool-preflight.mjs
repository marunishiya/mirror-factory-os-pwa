// PROJECT MIRROR: Metricool publishing preflight. Read-only, no external calls.
// Accept a locally exported getScheduledPosts response on stdin. Never commit
// real unpublished captions, media URLs, IDs or credentials to this repository.
import {readFileSync} from 'node:fs';

export function inspect(raw,{now=new Date(),required=['instagram','tiktok','youtube']}={}){
  let payload=typeof raw==='string'?JSON.parse(raw):raw;
  if(typeof payload?.text==='string')payload=JSON.parse(payload.text);
  const posts=Array.isArray(payload)?payload:payload?.data;
  if(!Array.isArray(posts))throw Error('Expected Metricool data array');
  const networks=Object.fromEntries(required.map(k=>[k,{pending:0,failed:0,other:0}]));
  const failures=[],warnings=[],seen=new Set();
  let future=0,autoReady=0;
  const withDate=posts.map(p=>({p,date:Date.parse((p.publicationDate?.dateTime||'')+'+09:00')}));
  for(const {p,date} of withDate){
    if(!Array.isArray(p.providers)||!p.publicationDate?.dateTime) {warnings.push('incomplete_post_metadata');continue;}
    if(!Number.isFinite(date)) {warnings.push('invalid_date');continue;}
    const isFuture=date>=now.getTime();
    if(isFuture)future++;
    const providers=p.providers.map(v=>v.network);
    if(new Set(providers).size!==providers.length)warnings.push('duplicate_network_in_post');
    for(const pr of p.providers){
      const net=pr.network,status=String(pr.status||'UNKNOWN').toUpperCase();
      if(!networks[net])networks[net]={pending:0,failed:0,other:0};
      if(status==='ERROR'||status==='FAILED'){
        networks[net].failed++;
        failures.push({network:net,date:p.publicationDate.dateTime,reason:pr.detailedStatus||'unknown'});
      }else if(status==='PENDING'||status==='SCHEDULED'){
        networks[net].pending++;
        if(isFuture && p.autoPublish===true && p.draft!==true)autoReady++;
      }else networks[net].other++;
      if(isFuture && (status==='PENDING'||status==='SCHEDULED')){
        if(p.autoPublish!==true)warnings.push(net+':manual_delivery');
        if(p.draft===true)warnings.push(net+':is_draft');
        if(['instagram','tiktok','youtube'].includes(net) && (!Array.isArray(p.media)||p.media.length===0))
          warnings.push(net+':media_missing');
        const key=net+'|'+p.publicationDate.dateTime+'|'+String(p.text||'').trim();
        if(seen.has(key))warnings.push(net+':possible_duplicate_scheduled_post');
        seen.add(key);
      }
    }
  }
  const ready=required.every(k=>networks[k]?.pending>0) && failures.length===0 && warnings.length===0 && autoReady>0;
  return {asOf:now.toISOString(),posts:posts.length,future,autoReady,networks,failures,warnings:[...new Set(warnings)],ready,
    note:'PENDING means scheduled, not published. Ready is preflight only, not proof of delivery.'};
}

if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const input=readFileSync(0,'utf8');
    const result=inspect(input);
    console.log(JSON.stringify(result,null,2));
    if(process.argv.includes('--strict') && !result.ready)process.exitCode=2;
  }catch(e){console.error('Invalid schedule input:',e.message);process.exitCode=1;}
}

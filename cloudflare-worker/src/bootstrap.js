/** MIRROR SOCIAL ENGINE v0.4 bootstrap: NO social posting, NO job submission. */
const ORIGIN = 'https://marunishiya.github.io';
const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':ORIGIN};
const respond = (data,status=200) => new Response(JSON.stringify(data),{status,headers});
export default {
  async fetch(request,env){
    const path = new URL(request.url).pathname;
    if(request.method !== 'GET') return respond({error:'writes_locked'},405);
    if(path !== '/' && path !== '/health') return respond({error:'not_found'},404);
    try {
      if(!env.DB) throw Error('no_db');
      const check=await env.DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('jobs','job_events')").first();
      const ok=Number(check?.n)===2;
      return respond({service:'MIRROR SOCIAL ENGINE',version:'0.4-bootstrap',databaseReady:ok,publishingEnabled:false,jobSubmissionEnabled:false},ok?200:503);
    } catch(e) {return respond({service:'MIRROR SOCIAL ENGINE',version:'0.4-bootstrap',databaseReady:false,publishingEnabled:false},503);}
  },
  async scheduled(){ console.log('DRY RUN bootstrap: no SNS action'); }
};

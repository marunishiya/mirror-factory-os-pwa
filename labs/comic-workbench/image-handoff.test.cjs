'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const zlib=require('node:zlib');
const {ingestOfflineCandidate}=require('./image-handoff.cjs');
const {digest}=require('./offline-render-pipeline.cjs');
function crc32(buffer){
 let v=-1;
 for(const byte of buffer){v^=byte;for(let i=0;i<8;i++)v=(v>>>1)^((v&1)?0xedb88320:0);}
 return (v^(-1))>>>0;
}
function chunk(type,data){
 const name=Buffer.from(type,'ascii'),n=Buffer.alloc(4),crc=Buffer.alloc(4);
 n.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));
 return Buffer.concat([n,name,data,crc]);
}
function png(w=300,h=450,grid=false,dark=false){
 const hdr=Buffer.alloc(13);hdr.writeUInt32BE(w,0);hdr.writeUInt32BE(h,4);hdr[8]=8;hdr[9]=2;
 const rows=[];
 for(let y=0;y<h;y++){
  const row=Buffer.alloc(1+w*3);
  for(let x=0;x<w;x++){
    const edge=grid&&(Math.abs(x-w/2)<3||Math.abs(y-h/3)<3||Math.abs(y-2*h/3)<3);
    const c=edge?(dark?9:255):101;
    const i=1+x*3;row[i]=c;row[i+1]=edge?c:88;row[i+2]=edge?c:77;
  }
  rows.push(row);
 }
 return Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR',hdr),chunk('IDAT',zlib.deflateSync(Buffer.concat(rows))),
  chunk('IEND',Buffer.alloc(0))
 ]);
}
const pngMaster=png(16,32),jpegMaster=Buffer.concat([
 Buffer.from([255,216,255]),Buffer.alloc(40,8),Buffer.from([255,217])
]);
const panels=['右上','左上','右中','左中','右下','左下']
 .map((position,i)=>({panel:i+1,position,lines:[]}));
const sourceBytes=Buffer.from(JSON.stringify({pageId:'CH04_P10',panels}));
const sourceLockSha256=digest(sourceBytes);
const plan={pageId:'CH04_P10',sourceLockSha256,
 requiredCharacterIds:['K','M'],storyboard:panels.map((p,i)=>({
  panel:p.panel,position:p.position,
  camera:['wide','close','detail','profile','two-shot','medium'][i],
  emotion:i===5?'hope':'silence'
 }))};
const masterBytes={K:jpegMaster,M:pngMaster};
const approvedRegistry={
 K:{sha256:digest(jpegMaster),confirmedByUser:true},
 M:{sha256:digest(pngMaster),confirmedByUser:true}
};
const args=()=>({
 sourceBytes,plan,panelId:6,prompt:'第六コマ、最後のセリフ',masterBytes,
 approvedRegistry,approvedAssets:[],history:[],
 imageBytes:png(300,450,true),expectedOutput:'single_panel'
});
test('1 panel request with real six-grid PNG is QUARANTINED',()=>{
 const r=ingestOfflineCandidate(args());
 assert.equal(r.status,'QUARANTINED');
 assert.equal(r.reason,'PAGE_GRID_INSTEAD_OF_SINGLE_PANEL');
 assert.equal(r.safeToAddAsFinishedArtwork,false);
 assert.equal(r.structure.two_by_three_grid_detected,true);
});
test('dark grid is also quarantined',()=>{
 const a=args();a.imageBytes=png(300,450,true,true);
 assert.equal(ingestOfflineCandidate(a).reason,'PAGE_GRID_INSTEAD_OF_SINGLE_PANEL');
});
test('single panel structure may proceed to review but cannot become approved art',()=>{
 const a=args();a.imageBytes=png(300,450,false);
 const r=ingestOfflineCandidate(a);
 assert.equal(r.status,'REVIEW_REQUIRED');
 assert.equal(r.safeToAddAsFinishedArtwork,false);
 assert.equal(r.artApproved,false);
 assert.equal(r.independentQA.status,'REVIEW_REQUIRED');
 assert(r.independentQA.issues.some(i=>i.code==='PANEL_VISUAL_QA_REQUIRED'));
});
test('real output hash and dimensions come from image bytes',()=>{
 const a=args(),r=ingestOfflineCandidate(a);
 assert.equal(r.image.sha256,digest(a.imageBytes));
 assert.equal(r.image.width,300);assert.equal(r.image.height,450);
});
test('single image must not be accepted as a page',()=>{
 const a=args();a.expectedOutput='page';a.imageBytes=png(300,450,false);
 assert.equal(ingestOfflineCandidate(a).status,'QUARANTINED');
});
test('six-grid page is still review-only even with expected page type',()=>{
 const a=args();a.expectedOutput='page';
 const r=ingestOfflineCandidate(a);
 assert.equal(r.status,'REVIEW_REQUIRED');assert.equal(r.wholePageQA.status,'BLOCKED');
});
test('approved work is never accepted for retake',()=>{
 const a=args();a.approvedAssets=[{pageId:'CH04_P10',panelId:6}];
 assert.equal(ingestOfflineCandidate(a).reason,'PRE_GENERATION_NOT_CLEAR');
});
test('unknown source hash is blocked before reading image',()=>{
 const a=args();a.plan={...plan,sourceLockSha256:'a'.repeat(64)};
 assert.equal(ingestOfflineCandidate(a).reason,'PRE_GENERATION_NOT_CLEAR');
});
test('wrong MASTER source is blocked before reading image',()=>{
 const a=args();a.approvedRegistry={...approvedRegistry,K:{...approvedRegistry.K,sha256:'b'.repeat(64)}};
 assert.equal(ingestOfflineCandidate(a).reason,'PRE_GENERATION_NOT_CLEAR');
});
test('corrupt PNG does not enter review',()=>{
 const a=args();a.imageBytes=Buffer.alloc(200,4);
 assert.equal(ingestOfflineCandidate(a).status,'QUARANTINED');
});
test('unknown output contract is always quarantined',()=>{
 const a=args();a.expectedOutput='anything';
 assert.equal(ingestOfflineCandidate(a).reason,'UNKNOWN_OUTPUT_CONTRACT');
});
test('paid provider activation cannot be hidden in postflight',()=>{
 const a=args();a.renderMode='paid';
 assert.equal(ingestOfflineCandidate(a).reason,'NETWORK_GENERATION_DISABLED');
});

const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
function makeJobDir(grid){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mirror-handoff-test-'));
 const src=path.join(dir,'source.json'),out=path.join(dir,'candidate.png'),
   mk=path.join(dir,'K.jpg'),mm=path.join(dir,'M.png'),manifest=path.join(dir,'job.json'),
   report=path.join(dir,'report.json');
 fs.writeFileSync(src,sourceBytes);fs.writeFileSync(out,png(300,450,grid));
 fs.writeFileSync(mk,jpegMaster);fs.writeFileSync(mm,pngMaster);
 fs.writeFileSync(manifest,JSON.stringify({
  sourceLockFile:src,masterFiles:{K:mk,M:mm},plan,approvedRegistry,
  panelId:6,prompt:'第六コマ、最後のセリフ',expectedOutput:'single_panel'
 }));
 return {dir,src,out,manifest,report};
}
test('one CLI command quarantines 6-panel output and records unchanged file hash',()=>{
 const x=makeJobDir(true);
 try{
  const before=digest(fs.readFileSync(x.out));
  const r=cp.spawnSync(process.execPath,[path.join(__dirname,'image-handoff-cli.cjs'),
    x.manifest,x.out,x.report],{encoding:'utf8',timeout:15000});
  assert.equal(r.status,2,(r.stderr||'')+' '+(r.stdout||''));
  assert.equal(JSON.parse(fs.readFileSync(x.report,'utf8')).status,'QUARANTINED');
  assert.equal(digest(fs.readFileSync(x.out)),before);
 }finally{fs.rmSync(x.dir,{recursive:true,force:true});}
});
test('CLI allows review-only result for one panel but does not approve it',()=>{
 const x=makeJobDir(false);
 try{
  const r=cp.spawnSync(process.execPath,[path.join(__dirname,'image-handoff-cli.cjs'),
    x.manifest,x.out,x.report],{encoding:'utf8',timeout:15000});
  assert.equal(r.status,0,(r.stderr||'')+' '+(r.stdout||''));
  const result=JSON.parse(fs.readFileSync(x.report,'utf8'));
  assert.equal(result.status,'REVIEW_REQUIRED');
  assert.equal(result.artApproved,false);
  assert.equal(result.safeToAddAsFinishedArtwork,false);
 }finally{fs.rmSync(x.dir,{recursive:true,force:true});}
});
test('CLI never replaces an existing report',()=>{
 const x=makeJobDir(false);
 try{
  fs.writeFileSync(x.report,'protected');
  const r=cp.spawnSync(process.execPath,[path.join(__dirname,'image-handoff-cli.cjs'),
    x.manifest,x.out,x.report],{encoding:'utf8',timeout:15000});
  assert.equal(r.status,2);
  assert.equal(fs.readFileSync(x.report,'utf8'),'protected');
 }finally{fs.rmSync(x.dir,{recursive:true,force:true});}
});

/* Non-Canon visual-production preflight: dimensional and graphic-band heuristics.
   It cannot authenticate faces, certify originality, or prove Canon correctness. */
(function(root,factory){
 "use strict";
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 root.ComicShotPreflight=api;
})(typeof globalThis==="object"?globalThis:this,function(){
 "use strict";
 function bands(rates,cutoff=0.90){
  const out=[];let start=-1,last=-1;
  for(let i=0;i<rates.length;i++){
   const hit=rates[i]>=cutoff&&i>=rates.length*.05&&i<rates.length*.95;
   if(hit){
    if(start<0)start=i;
    else if(i-last>4){out.push({start,end:last});start=i;}
    last=i;
   }
  }
  if(start>=0)out.push({start,end:last});
  return out.map(v=>({...v,center:Math.round((v.start+v.end)/2)}));
 }
 function inspect(data,width,height,originalWidth=width,originalHeight=height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<24||height<24||
     !Number.isInteger(originalWidth)||!Number.isInteger(originalHeight)||
     originalWidth<1||originalHeight<1||width*height>1800000||
     !data||data.length!==width*height*4)throw Error("画像データの形式または大きさが不正です");
  const rows=new Uint32Array(height),cols=new Uint32Array(width);
  // Read no personal data, retain no pixels. Count near-black band coverage only.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const i=(y*width+x)*4;
   if(data[i+3]>=200&&data[i]<46&&data[i+1]<46&&data[i+2]<46){rows[y]++;cols[x]++;}
  }
  const horizontal=bands(Array.from(rows,v=>v/width));
  const vertical=bands(Array.from(cols,v=>v/height));
  const issues=[];
  if(originalWidth<1600||originalHeight<900)issues.push({
   code:"IMAGE_DIMENSIONS_TOO_SMALL",reason:"独立した場面原画は1600×900以上を推奨します"});
  const ratio=originalWidth/originalHeight;
  if(ratio<1.4||ratio>2.05)issues.push({
   code:"NON_STANDARD_SCENE_ASPECT",reason:"原画の横縦比が目安の16:9から大きく外れています"});
  if(horizontal.length>=2)issues.push({
   code:"MULTI_PANEL_SUSPECTED",reason:"画像内に複数の長い暗色の水平帯があり、コマ割り・見出し付きポスターの疑いがあります"});
  if(horizontal.length===1&&vertical.length>=1)issues.push({
   code:"GRAPHIC_DIVIDER_SUSPECTED",reason:"縦横の長い暗色線があります。独立した一場面か目視確認してください"});
  return {
   status:issues.length?"HOLD_FOR_REVIEW":"NO_OBVIOUS_GRID_DETECTED",
   pixelAnalysisOnly:true,personIdentityVerified:false,canonApproved:false,
   original:{width:originalWidth,height:originalHeight},
   scanned:{width,height},
   graphicBands:{horizontal,vertical},issues,
   warning:"これは暗い罫線の簡易検出です。色付きのポスター、細線コマ割り、画像内文字、顔の同一性は自動証明できません。機械判定が通っても人の目視QAが必須です。"
  };
 }
 return Object.freeze({inspect,bands});
});
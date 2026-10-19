/* Makes two dependency-free HTML files for offline Chrome/Android use.
 * Original lab/source unchanged. No deploy, image, credential or external API. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname),out=path.join(root,"portable-dist");
fs.mkdirSync(out,{recursive:true});
const included=new Set();
function inlined(name){
 const source=fs.readFileSync(path.join(root,name),"utf8");
 const html=source.replace(/<script\s+src="\.\/([^"]+\.js)"\s*><\/script>/g,(tag,file)=>{
  const resolved=path.resolve(root,file);
  if(!resolved.startsWith(root+path.sep))throw Error("Path escape: "+file);
  if(!fs.existsSync(resolved))throw Error("Missing script: "+file);
  included.add(file);
  const js=fs.readFileSync(resolved,"utf8");
  new vm.Script(js,{filename:file});
  if(/<\/script/i.test(js))throw Error("Embedded </script> forbidden in "+file);
  return "<script>\n"+js+"\n</script>";
 });
 if(/<script\s+src=/.test(html))throw Error("External script link remains: "+name);
 const ret=html.replace(/\.\/image-lab\.html/g,"./image-lab.html")
   .replace(/\.\/index\.html/g,"./index.html");
 for(const m of ret.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))
   if(m[1].trim())new vm.Script(m[1],{filename:name});
 fs.writeFileSync(path.join(out,name),ret,"utf8");
 return ret;
}
const index=inlined("index.html"),image=inlined("image-lab.html"),balloon=inlined("balloon-lab.html");
if(!index.includes("ComicWorkbench")||!image.includes("ComicImageQA")||
 !image.includes("ComicAuthority")||!image.includes("ComicHash")||
 !balloon.includes("ComicBalloonQA"))throw Error("Missing bundled API");
const guide=[
"Comic Workbench OFFLINE v0.9",
"",
"スマホ用：index.html、image-lab.html、balloon-lab.htmlの3つのHTMLをChrome等で開いてください。",
"吹き出しQA：原稿JSON→コマ画像→吹き出しをタップ→話者・文字を目視で入力→注釈の照合→JSON保存。",
"手順：画像ラボ →「練習用画像で試す」→「修正前後を比較する」→「指定範囲だけ合成してPNG保存」。",
"ZIPの中にある3つのHTMLは同じフォルダに置いてください（画面間リンク用）。",
"端末がHTMLファイルをブラウザで開けない場合は、PCのChrome/Edgeで開けます。",
"作品の画像は端末内のメモリで処理。自動ネット送信・ログイン・APIキー・課金はありません。",
"画像自体は保存されません。必要な合成PNG／台帳JSON／レポートJSONを各ボタンから保存してください。",
"正式Canonの認証、異なる表情のAI顔一致判定、AI画像生成、本番PWAへの統合は未実装です。",
"公開リポジトリやPRに正式MASTER画像をアップロードしないでください。"
].join("\n");
fs.writeFileSync(path.join(out,"使い方.txt"),guide+"\n","utf8");
console.log(JSON.stringify({output:out,files:fs.readdirSync(out),scripts:[...included],bytes:{
 index:Buffer.byteLength(index),image:Buffer.byteLength(image),balloon:Buffer.byteLength(balloon)}}));
/* Comic Workbench Image QA v0.2 — local-only pixel comparison, no external SDK. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ComicImageQA = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const DEFAULTS = Object.freeze({ channelTolerance: 24, maxOutsideFraction: 0.005, maxRoiFraction: 0.6 });
  const isUnit = n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  const round = n => Number(n.toFixed(4));
  const fail = message => { throw new Error(message); };
  function validateRect(rect, cfg = DEFAULTS) {
    if (!rect || !["x","y","width","height"].every(k=>isUnit(rect[k]))) {
      fail("修正範囲の座標は0～1の有限数で指定してください");
    }
    if (rect.width <= 0 || rect.height <= 0) fail("修正範囲に面積がありません");
    if (rect.x + rect.width > 1 + 1e-9 || rect.y + rect.height > 1 + 1e-9) {
      fail("修正範囲が画像の外側にあります");
    }
    if (rect.width * rect.height >= cfg.maxRoiFraction) {
      fail("修正範囲が大きすぎます。ページ全体の変更を部分修正として扱えません");
    }
    return Object.freeze({
      x: round(rect.x), y: round(rect.y),
      width: round(rect.width), height: round(rect.height)
    });
  }
  function validateSettings(settings = {}) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) fail("検査設定が不正です");
    const cfg = { ...DEFAULTS, ...settings };
    if (!Number.isInteger(cfg.channelTolerance) || cfg.channelTolerance < 0 || cfg.channelTolerance > 64) {
      fail("画素許容差は0～64の整数にしてください");
    }
    if (typeof cfg.maxOutsideFraction !== "number" || !Number.isFinite(cfg.maxOutsideFraction)
      || cfg.maxOutsideFraction < 0 || cfg.maxOutsideFraction > 0.1) fail("範囲外の許容率は0～10%までです");
    if (typeof cfg.maxRoiFraction !== "number" || cfg.maxRoiFraction <= 0 || cfg.maxRoiFraction > 0.8) {
      fail("修正領域上限が不正です");
    }
    return cfg;
  }
  function compare(before, after, width, height, roi, settings = {}) {
    const cfg = validateSettings(settings);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
        || width * height > 4000000) fail("画像サイズが不正か、400万画素を超えています");
    const bytes = width * height * 4;
    if (!before || !after || before.length !== bytes || after.length !== bytes) {
      fail("修正前後の画像は同じ縦横サイズのRGBAデータが必要です");
    }
    const r = validateRect(roi, cfg);
    let insideTotal=0, outsideTotal=0, insideChanged=0, outsideChanged=0;
    let minX=width, minY=height, maxX=-1, maxY=-1;
    // Pixel-center test makes ROI selection deterministic independent of display scaling.
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const offset=(y*width+x)*4;
      let difference=0;
      for(let channel=0;channel<4;channel++){
        difference=Math.max(difference,Math.abs(before[offset+channel]-after[offset+channel]));
      }
      const changed=difference>cfg.channelTolerance;
      const inside=(x+0.5)/width>=r.x && (x+0.5)/width<=r.x+r.width
        && (y+0.5)/height>=r.y && (y+0.5)/height<=r.y+r.height;
      if(inside){insideTotal++;if(changed)insideChanged++;}
      else {outsideTotal++;if(changed)outsideChanged++;}
      if(changed){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    }
    if(!insideTotal || !outsideTotal) fail("有効な画像内・画像外の両領域が必要です");
    const outsideFraction=outsideChanged/outsideTotal;
    const insideFraction=insideChanged/insideTotal;
    // A candidate that only edits protected pixels is never a successful local edit.
    const verdict=outsideFraction>cfg.maxOutsideFraction || (insideChanged===0&&outsideChanged>0)?"FAIL":
      insideChanged+outsideChanged===0?"NO_CHANGE":"PASS";
    return {
      verdict, dimensions:{width,height}, roi:r,
      settings:{channelTolerance:cfg.channelTolerance,maxOutsideFraction:cfg.maxOutsideFraction},
      inside:{total:insideTotal,changed:insideChanged,fraction:round(insideFraction)},
      outside:{total:outsideTotal,changed:outsideChanged,fraction:round(outsideFraction)},
      changedBounds:maxX<0?null:{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1},
      note: "画素差分検査のみ。顔の同一性・美術品質・伏線の意味は自動保証しません。"
    };
  }
  function composeRegion(before, candidate, width, height, roi) {
    // Copy only candidate pixels whose center lies inside ROI. Pixels outside ROI
    // retain their original RGBA bytes exactly; never modify the input buffers.
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
        || width*height > 4000000 || !before || !candidate ||
        before.length !== width*height*4 || candidate.length !== width*height*4) {
      fail("合成する2画像のサイズとRGBAデータが不正です");
    }
    const r=validateRect(roi), out=new Uint8ClampedArray(before);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const inside=(x+.5)/width>=r.x && (x+.5)/width<=r.x+r.width
        && (y+.5)/height>=r.y && (y+.5)/height<=r.y+r.height;
      if(inside){
        const index=(y*width+x)*4;
        out[index]=candidate[index];
        out[index+1]=candidate[index+1];
        out[index+2]=candidate[index+2];
        out[index+3]=candidate[index+3];
      }
    }
    return out;
  }
  function sampleChangedPixels(before, after, width, height, tolerance=24) {
    validateSettings({channelTolerance:tolerance});
    if (!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
      width*height>4000000||before.length!==width*height*4||after.length!==width*height*4) {
      fail("画像データの形式が不正です");
    }
    const mask=new Uint8ClampedArray(width*height*4);
    for(let i=0;i<width*height;i++){
      let d=0;
      for(let k=0;k<4;k++)d=Math.max(d,Math.abs(before[i*4+k]-after[i*4+k]));
      if(d>tolerance){mask.set([255,65,86,158],i*4);}
    }
    return mask;
  }
  function imageFingerprint(fileInfo) {
    if (!fileInfo || !/^[0-9a-f]{64}$/.test(fileInfo.sha256||"") ||
      !Number.isInteger(fileInfo.width) || !Number.isInteger(fileInfo.height) ||
      fileInfo.width<1||fileInfo.height<1||!Number.isInteger(fileInfo.bytes)||
      fileInfo.bytes<1||typeof fileInfo.name!=="string") fail("画像ハッシュ記録が不正です");
    return {
      sha256:fileInfo.sha256, width:fileInfo.width,height:fileInfo.height,
      bytes:fileInfo.bytes, name:fileInfo.name.slice(0,180)
    };
  }
  function makeReport({project,panelId,master,before,after,result,review}) {
    if(!["mirror","himiko"].includes(project) || typeof panelId!=="string" ||
      !panelId.trim() || panelId.length>100)fail("作品IDまたはコマIDが不正です");
    if(!result || !["PASS","FAIL","NO_CHANGE"].includes(result.verdict))fail("差分検査がありません");
    if(!review || typeof review!=="object"||Array.isArray(review) ||
      !["identity","clothing","dialogue","story"].every(k=>typeof review[k]==="boolean")) {
      fail("目視確認の記録が必要です");
    }
    const manualComplete=Object.values(review).every(Boolean);
    const sameFiles=before.sha256===after.sha256;
    return {
      schema:"comic-image-report/v1",project,panelId,
      master:master?imageFingerprint(master):null,
      before:imageFingerprint(before),after:imageFingerprint(after),
      result,review:{...review},manualComplete,
      readyForHumanReview:result.verdict==="PASS"&&!sameFiles,
      // Never auto-approve artwork or mutate Canon based on a pixel test.
      canonApproved:false,
      note:"ハッシュは端末のファイル内容の同一性を確認するためのもの。人物同一性は人がMASTER原本と照合。"
    };
  }
  return Object.freeze({DEFAULTS,validateRect,validateSettings,compare,sampleChangedPixels,
    imageFingerprint,makeReport,composeRegion});
});
'use strict';
// STORY CONTINUITY GATE v0.2 - experimental structured-story preflight.
// No image generation, face detection, OCR, Canon changes or publication actions.
const isText=x=>typeof x==='string'&&x.trim().length>0;
const validPage=x=>/^CH\d{2}-P\d{2}$/.test(x||'');
function validateStoryContinuity(book){
  const issues=[];
  const add=(code,where,detail)=>issues.push({code,where,detail});
  if(!book||!Array.isArray(book.pages)||book.pages.length===0){
    add('PAGES_MISSING','book','ページ一覧が必要');return verdict(issues);
  }
  const chars=book.characters||{};
  if(!Object.keys(chars).length)add('CHARACTERS_MISSING','book','人物台帳が必要');
  const known=new Map(Object.keys(chars).map(id=>[id,new Set(book.initialKnowledge?.[id]||[])]));
  const locations={...(book.initialLocations||{})};
  const objects=JSON.parse(JSON.stringify(book.initialObjects||{}));
  const eventIds=new Set(book.initialEvents||[]);
  const characterNames=Object.entries(chars).filter(([,c])=>isText(c?.surname));
  const seenPages=new Set();
  let lastMinute=-Infinity,previousPage=-1,previousChapter='';
  for(const page of book.pages){
    const pageId=page?.id||'?';
    if(!validPage(pageId)){add('PAGE_ID_BAD',pageId,'CH03-P02形式');continue;}
    if(seenPages.has(pageId))add('DUPLICATE_PAGE',pageId,'ページID重複');
    seenPages.add(pageId);
    const chapter=pageId.slice(0,4),pageNumber=Number(pageId.slice(-2));
    if(chapter===previousChapter&&pageNumber<=previousPage)add('PAGE_SEQUENCE',pageId,'ページ順の逆転');
    previousPage=pageNumber;previousChapter=chapter;
    const panels=page.panels;
    if(!Array.isArray(panels)||![6,8].includes(panels.length)){
      add('PANEL_COUNT',pageId,'6コマ又は8コマが必要');continue;
    }
    for(let i=0;i<panels.length;i++){
      const p=panels[i]||{},at=pageId+':'+(i+1);
      const row=Math.floor(i/2)+1,col=i%2===0?'right':'left';
      if(p.number!==i+1||p.row!==row||p.col!==col)
        add('READING_ORDER',at,'期待: '+(i+1)+'='+row+'段目 '+col);
      if(!Number.isFinite(p.minute))add('TIME_UNVERIFIED',at,'時刻の登録が必要');
      else if(!p.flashback&&p.minute<lastMinute)add('TIME_BACKWARD',at,'回想指定なしの時間逆行');
      else if(!p.flashback)lastMinute=p.minute;
      if(!isText(p.location))add('LOCATION_MISSING',at,'場所未登録');
      const present=p.present||[];
      if(!Array.isArray(present))add('PRESENT_INVALID',at,'登場人物一覧が必要');
      else for(const actor of present){
        if(!chars[actor]){add('UNKNOWN_CHARACTER',at,actor);continue;}
        if(locations[actor]!==p.location){
          const arrival=p.arrivals?.[actor];
          if(!arrival||arrival.from!==locations[actor]||
             !isText(arrival.reason)||!isText(arrival.from))
            add('UNEXPLAINED_ARRIVAL',at,actor+'の移動理由未登録');
          locations[actor]=p.location;
        }
      }
      // A learn must document who, what, source and visible evidence.
      // The source field is not independently verified; editorial review is mandatory.
      for(const entry of p.learns||[]){
        if(!chars[entry?.who]||!isText(entry?.fact)||
           !isText(entry?.source)||!isText(entry?.evidence))
          add('KNOWLEDGE_SOURCE_MISSING',at,'情報取得の根拠が必要');
        else known.get(entry.who).add(entry.fact);
      }
      for(const line of p.dialogue||[]){
        if(!Array.isArray(present)||!present.includes(line?.speaker))
          add('SPEAKER_NOT_PRESENT',at,'話者が登場していない');
        if(!isText(line?.text))add('EMPTY_DIALOGUE',at,'セリフ未登録');
        if(line?.tailTo&&line.tailTo!==line.speaker)
          add('TAIL_METADATA_MISMATCH',at,'尻尾の指定と話者が異なる');
        for(const [id,c] of characterNames){
          if(line?.speaker!==id&&line?.text?.includes(c.surname)&&
            !known.get(line.speaker)?.has('name:'+id))
            add('KNOWLEDGE_LEAK',at,line.speaker+'は'+c.surname+'をまだ知らない');
        }
      }
      for(const ev of p.events||[]){
        if(!isText(ev?.id)){add('EVENT_ID_MISSING',at,'事件ID欠落');continue;}
        if(eventIds.has(ev.id))add('EVENT_DUPLICATE',at,ev.id);
        for(const pre of ev.dependsOn||[])
          if(!eventIds.has(pre))add('MISSING_CAUSE',at,ev.id+'には'+pre+'が必要');
        eventIds.add(ev.id);
      }
      for(const item of p.objects||[]){
        const spec=book.objectCanon?.[item?.id];
        if(!spec){add('OBJECT_NOT_REGISTERED',at,item?.id||'?');continue;}
        if(!isText(item.state)||!isText(item.holder))
          add('OBJECT_STATE_MISSING',at,item.id);
        if(spec.color&&item.color!==spec.color)
          add('OBJECT_COLOR_DRIFT',at,item.id+'の色が違う');
        const prev=objects[item.id];
        if(prev&&(prev.state!==item.state||prev.holder!==item.holder)&&
          !isText(item.changeCause))
          add('UNEXPLAINED_OBJECT_CHANGE',at,item.id+'の状態変化に原因なし');
        objects[item.id]={state:item.state,holder:item.holder};
      }
      for(const hist of p.history||[]){
        if(!book.approvedHistoryIds?.includes(hist.id))
          add('UNAPPROVED_HISTORY',at,'未承認の過去情報: '+(hist.id||'?'));
        const c=chars[hist.person];
        if(c&&Number.isInteger(hist.year)&&Number.isInteger(c.ageAtReferenceYear)&&
          Number.isInteger(book.referenceYear)&&Number.isFinite(hist.minAge)){
          const approx=c.ageAtReferenceYear-(book.referenceYear-hist.year);
          if(approx+1<hist.minAge)
            add('AGE_CONFLICT',at,hist.person+'の'+hist.year+'年の年齢は約'+approx+'歳');
        }
      }
    }
  }
  return verdict(issues);
}
function verdict(issues){return {
  stage:'STORY_PRE_GENERATION',status:issues.length?'BLOCKED':'REVIEW_REQUIRED',
  issues,automaticVisualApproval:false,canonApproved:false,publicationApproved:false,
  note:'構造化された宣言を検査する試験版。画像内の真偽・魅力・人物同一性の自動承認はしない。'
};}
module.exports={validateStoryContinuity};
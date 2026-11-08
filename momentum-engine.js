// Independent descriptive LIVE momentum engine.
// Uses ESPN counters only; dangerous attacks are deliberately not used.
// It does not create betting signals or probabilities.
(function(root){
  "use strict";
  const MIN_GAP_MINUTES=3, MAX_GAP_MINUTES=15;
  const DEFINITIONS=[
    {key:"sot",aliases:["shots on target","shots on goal","on target"],weight:3},
    {key:"off",aliases:["shots off target","off target"],weight:1},
    {key:"corners",aliases:["corner kicks","corners"],weight:1.5}
  ];
  const normalise=s=>String(s??"").toLowerCase().replace(/[^a-z0-9]/g,"");
  function number(v){
    if(v===null||v===undefined||String(v).trim()==="")return null;
    const n=Number(String(v).replace(",",".").replace(/[^0-9.-]/g,""));
    return Number.isFinite(n)&&n>=0?n:null;
  }
  function pair(stats,aliases){
    const rows=Array.isArray(stats)?stats:[];
    const keys=aliases.map(normalise);
    let item=rows.find(x=>keys.includes(normalise(x?.label||x?.name||x?.type)));
    if(!item)item=rows.find(x=>{const label=normalise(x?.label||x?.name||x?.type);return keys.some(k=>label.includes(k));});
    if(!item)return null;
    const home=number(item.home),away=number(item.away);
    return home===null||away===null?null:{home,away};
  }
  function snapshotStats(match){
    const stats=match?.stats||[];
    const result={};
    for(const d of DEFINITIONS)result[d.key]=pair(stats,d.aliases);
    result.possession=pair(stats,["possession"]);
    return result;
  }
  function share(p){
    if(!p)return null;
    const total=p.home+p.away;
    return total>0?p.home/total*100:50;
  }
  function cumulativePressure(stats){
    const s=snapshotStats({stats});
    const components=[
      {value:share(s.sot),weight:.55},
      {value:share(s.off),weight:.25},
      {value:share(s.possession),weight:.20}
    ].filter(x=>x.value!==null);
    if(!components.length)return null;
    const w=components.reduce((a,x)=>a+x.weight,0);
    const home=components.reduce((a,x)=>a+x.value*x.weight,0)/w;
    return {home:Math.round(home),away:Math.round(100-home),coverage:components.length};
  }
  function interval(previous,current){
    const minutes=(current.time-previous.time)/60000;
    if(!Number.isFinite(minutes)||minutes<MIN_GAP_MINUTES||minutes>MAX_GAP_MINUTES)return null;
    const old=snapshotStats(previous.match),now=snapshotStats(current.match);
    let home=0,away=0,used=[];
    for(const d of DEFINITIONS){
      const a=old[d.key],b=now[d.key];
      if(!a||!b||b.home<a.home||b.away<a.away)continue;
      const dh=b.home-a.home,da=b.away-a.away;
      home+=dh*d.weight;away+=da*d.weight;
      used.push({key:d.key,home:dh,away:da});
    }
    if(!used.length)return null;
    const total=home+away;
    const homeRate=home/minutes*10,awayRate=away/minutes*10;
    const activityShare=total>0?home/total*100:null;
    const pressure=cumulativePressure(current.match.stats||[]);
    const homeIndex=activityShare===null?(pressure?.home??null):Math.round((pressure?pressure.home*.30:50*.30)+activityShare*.70);
    return {time:current.time,minutes,homeRate,awayRate,activityHome:home,activityAway:away,
      activityShare,home:homeIndex,away:homeIndex===null?null:100-homeIndex,used};
  }
  function analyse(match,records,collectedAt){
    const now=Date.parse(collectedAt||"");
    if(!Number.isFinite(now))return {ready:false,reason:"Chýba čas aktuálneho merania."};
    const all=(Array.isArray(records)?records:[]).filter(x=>Number.isFinite(x.time)&&x.match?.stats)
      .filter(x=>Math.abs(x.time-now)>=1000);
    all.push({time:now,match});
    all.sort((a,b)=>a.time-b.time);
    const unique=all.filter((x,i)=>i===0||x.time!==all[i-1].time);
    const points=[];
    for(let i=1;i<unique.length;i++){const p=interval(unique[i-1],unique[i]);if(p)points.push(p);}
    const pressure=cumulativePressure(match?.stats||[]);
    const latest=points[points.length-1]||null;
    const recent=latest&&latest.activityShare!==null?{
      home:latest.home,away:latest.away,homeRate:latest.homeRate,awayRate:latest.awayRate,
      minutes:Number(latest.minutes.toFixed(1)),used:latest.used
    }:null;
    let acceleration=null;
    if(points.length>=2){
      const a=points[points.length-2],b=points[points.length-1];
      const hd=Number((b.homeRate-a.homeRate).toFixed(1)),ad=Number((b.awayRate-a.awayRate).toFixed(1));
      const classify=x=>x>=1.5?"ZRÝCHĽUJE":x<=-1.5?"SPOMAĽUJE":"STABILNÉ";
      acceleration={homeDelta:hd,awayDelta:ad,homeState:classify(hd),awayState:classify(ad),
        homePreviousRate:Number(a.homeRate.toFixed(1)),homeLatestRate:Number(b.homeRate.toFixed(1)),
        awayPreviousRate:Number(a.awayRate.toFixed(1)),awayLatestRate:Number(b.awayRate.toFixed(1))};
    }
    const core=unique.filter(x=>{const s=snapshotStats(x.match);return !!(s.sot||s.off);}).length;
    const full=unique.filter(x=>{const s=snapshotStats(x.match);return !!(s.sot&&s.off);}).length;
    const possession=unique.filter(x=>!!snapshotStats(x.match).possession).length;
    const reliability={count:unique.length,coreCoverage:unique.length?Math.round(core/unique.length*100):0,
      shotCoverage:unique.length?Math.round(full/unique.length*100):0,
      possessionCoverage:unique.length?Math.round(possession/unique.length*100):0,
      intervalCount:points.length};
    const visible=points.filter(p=>p.time>=now-45*60000).slice(-10);
    return {ready:true,pressure,recent,acceleration,trend:visible,reliability,
      status:recent?"LIVE MOMENTUM AKTÍVNE":pressure?"IBA KUMULATÍVNE ŠTATISTIKY":"ČAKÁM NA ŠTATISTIKY"};
  }
  root.LiveMomentumEngine={analyse};
})(typeof window!=="undefined"?window:globalThis);

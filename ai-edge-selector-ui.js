"use strict";
(() => {
  const FEED = "https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./live-data-v2/data/flashscore-primary-current.json";
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "—").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const fmt = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString("sk-SK") : "—";
  const date = value => { const d=new Date(value||""); return Number.isNaN(d.getTime())?"—":d.toLocaleTimeString("sk-SK"); };
  async function load(){
    const res=await fetch(FEED+"?t="+Date.now(),{cache:"no-store",headers:{Accept:"application/json"}});
    if(!res.ok) throw new Error("LIVE feed HTTP "+res.status);
    return res.json();
  }
  function stat(stats, tests){
    if(!Array.isArray(stats)) return null;
    const found=stats.find(s=>tests.some(re=>re.test(String(s.label||s.name||"")))&&(!s.period||String(s.period).toLowerCase()==="match"));
    if(!found) return null;
    const n=v=>{const x=Number(String(v??"").replace("%","").replace(",","."));return Number.isFinite(x)?x:null;};
    const h=n(found.home_numeric??found.home),a=n(found.away_numeric??found.away);
    return h===null||a===null?null:{home:h,away:a};
  }
  const defs={
    sot:[/shots on target/i,/strely na bránu/i],
    shots:[/total shots/i,/shots off target/i,/celkové strely/i],
    off:[/shots off target/i],
    corners:[/corner kicks/i,/corners/i,/rohov/i],
    possession:[/ball possession/i,/possession/i,/držanie lopty/i],
    xg:[/expected goals\s*\(xg\)/i,/^expected goals$/i,/^xg$/i],
    xgot:[/xg on target/i],
    box:[/shots inside the box/i],
    touches:[/touches in opposition box/i],
    big:[/big chances/i]
  };
  function features(match, history, collectedAt){
    const stats=match.stats||match.flashscore_stats||[];
    const values={}; for(const [k,re] of Object.entries(defs)) values[k]=stat(stats,re);
    const previous=(history||[]).filter(x=>String(x.match?.id)===String(match.id)&&Number(x.time)<Date.parse(collectedAt||"")&&Array.isArray(x.match?.stats)&&x.match.stats.length).slice(-1)[0];
    const old=previous?.match?.stats||[];
    const delta={home:0,away:0,minutes:null,ready:false};
    if(previous){
      const elapsed=(Date.parse(collectedAt||"")-Number(previous.time))/60000;
      const oldSot=stat(old,defs.sot),oldShots=stat(old,defs.shots),oldCorners=stat(old,defs.corners);
      if(elapsed>0&&elapsed<=12&&values.sot&&values.shots&&oldSot&&oldShots){
        const nowC=values.corners,oldC=stat(old,defs.corners);
        const dif=(now,was,side)=>now&&was?Math.max(0,now[side]-was[side]):0;
        delta.home=dif(values.sot,oldSot,"home")*12+dif(values.shots,oldShots,"home")*3+(nowC&&oldC?dif(nowC,oldC,"home")*2:0);
        delta.away=dif(values.sot,oldSot,"away")*12+dif(values.shots,oldShots,"away")*3+(nowC&&oldC?dif(nowC,oldC,"away")*2:0);
        delta.minutes=elapsed;delta.ready=true;
      }
    }
    const score=(side)=>{
      const v=k=>values[k]?.[side]??0;
      const raw=v("sot")*9+v("off")*3+v("corners")*2+v("big")*11+v("xg")*13+(delta.ready?delta[side]:0);
      const poss=values.possession?.[side];
      return Math.max(0,Math.min(100,Math.round(raw+ (poss?Math.max(0,poss-50)*0.18:0))));
    };
    const home=score("home"),away=score("away");
    const hasCore=!!(values.sot||values.shots||values.corners||values.xg||values.xgot||values.box||values.touches||values.big);
    const statsAge=Date.parse(match.stats_collected_at||match.match_collected_at||match.collected_at||collectedAt||"");
    const age=Number.isFinite(statsAge)?Math.max(0,(Date.now()-statsAge)/60000):null;
    return {values,delta,home,away,hasCore,age,ready:hasCore&&age!==null&&age<=12};
  }
  function band(score,ready){
    if(!ready)return ["NEDOSTATOK DÁT","—"];
    if(score>=48)return ["VYSOKÝ TLAK","high"];
    if(score>=25)return ["ZVÝŠENÝ TLAK","mid"];
    return ["NÍZKY TLAK","low"];
  }

  const LEDGER_KEY="live-edge-ai-edge-shadow-v1";
  function ledgerRead(){try{return JSON.parse(localStorage.getItem(LEDGER_KEY)||"[]").filter(x=>x&&x.id);}catch(_){return[];}}
  function ledgerWrite(items){try{localStorage.setItem(LEDGER_KEY,JSON.stringify(items.slice(-500)));return true;}catch(_){return false;}}
  function updateShadowPredictions(usable,data){
    const items=ledgerRead(),history=Array.isArray(data.recent_history)?data.recent_history:[];
    const now=Date.parse(data.collected_at||"")||Date.now();
    const scoreOf=m=>(Number(m?.home_score)||0)+(Number(m?.away_score)||0);
    const minuteOf=m=>Number(m?.live_minute);
    for(const p of items.filter(x=>x.status==="OPEN")){
      const timeline=history.filter(x=>String(x.match?.id)===String(p.matchId)&&Number(x.time)>=p.createdAt)
        .map(x=>({time:Number(x.time),match:x.match}));
      const live=usable.find(x=>String(x.record.match.id)===String(p.matchId));
      if(live) timeline.push({time:now,match:live.record.match});
      timeline.sort((a,b)=>a.time-b.time);
      const firstGoal=timeline.find(x=>scoreOf(x.match)>p.startGoals);
      if(firstGoal){
        const goalMinute=minuteOf(firstGoal.match);
        const beforeGoal=timeline.filter(x=>x.time<firstGoal.time).slice(-1)[0];
        if(p.target==="NEXT_TEAM"){
          p.status=p.predictedTeam&&p.predictedTeam===p.goalTeam?"HIT":"MISS";
        }else if(Number.isFinite(goalMinute)&&goalMinute<=p.deadlineMinute){
          p.status="HIT";
        }else if(beforeGoal&&Number.isFinite(minuteOf(beforeGoal.match))&&minuteOf(beforeGoal.match)>=p.deadlineMinute){
          p.status="MISS";
        }else{
          // The first observed score change crossed the deadline: exact goal timing is unknown.
          p.status="UNRESOLVED";
        }
        p.checkedAt=firstGoal.time;p.resultMinute=Number.isFinite(goalMinute)?goalMinute:null;
        p.resultScore=(Number(firstGoal.match.home_score)||0)+":"+(Number(firstGoal.match.away_score)||0);
        const homeDelta=(Number(firstGoal.match.home_score)||0)-p.startHome,awayDelta=(Number(firstGoal.match.away_score)||0)-p.startAway;
        p.goalTeam=homeDelta>0&&awayDelta>0?"Neznámy tím":homeDelta>0?p.home:awayDelta>0?p.away:"Neznámy tím";
        if(p.target==="NEXT_TEAM"&&p.goalTeam==="Neznámy tím") p.status="UNRESOLVED";
      }else{
        const last=timeline[timeline.length-1];
        const lastMinute=last?minuteOf(last.match):NaN;
        const ended=last&&/finished|ended|after penalties|ft/i.test(String(last.match?.status||last.match?.status_text||""));
        if((p.target==="FT"||p.target==="NEXT_TEAM")&&ended){
          p.status="MISS";p.checkedAt=last.time;p.resultScore=(Number(last.match.home_score)||0)+":"+(Number(last.match.away_score)||0);
        }else if(last&&Number.isFinite(lastMinute)&&lastMinute>=p.deadlineMinute){
          p.status="MISS";p.checkedAt=last.time;p.resultScore=(Number(last.match.home_score)||0)+":"+(Number(last.match.away_score)||0);
        }else if(last&&ended){
          // A match ended before the prediction horizon expired; this is not a fair miss.
          p.status="UNRESOLVED";p.checkedAt=last.time;p.resultScore=(Number(last.match.home_score)||0)+":"+(Number(last.match.away_score)||0);
        }
      }
    }
    const liveIds=new Set();
    for(const {record,fx} of usable){
      const m=record.match,minute=minuteOf(m);
      if(m.status!=="live"||!fx.ready||!Number.isFinite(minute)) continue;
      const pressure=Math.max(fx.home,fx.away);
      for(const target of [{mins:15,threshold:45},{mins:25,threshold:35},{mins:"FT",threshold:40}]){
        if(pressure<target.threshold||(target.mins!=="FT"&&minute>90-target.mins)) continue;
        const bucket=target.mins==="FT"?"FT":Math.floor(minute/5),key=[m.id,target.mins,bucket,m.home_score,m.away_score].join(":");
        if(items.some(x=>x.id===key)) continue;
        items.push({id:key,matchId:String(m.id),home:m.home,away:m.away,target:target.mins,
          startMinute:minute,deadlineMinute:target.mins==="FT"?120:minute+target.mins,createdAt:now,
          startHome:Number(m.home_score)||0,startAway:Number(m.away_score)||0,
          startGoals:scoreOf(m),pressure,pressureSide:fx.home>fx.away?m.home:fx.away>fx.home?m.away:"Vyrovnaný",
          status:"OPEN"});
      }
      if(Math.abs(fx.home-fx.away)>=8&&pressure>=40){
        const predictedTeam=fx.home>fx.away?m.home:m.away;
        const key=[m.id,"NEXT_TEAM",Math.floor(minute/5),m.home_score,m.away_score].join(":");
        if(!items.some(x=>x.id===key)) items.push({id:key,matchId:String(m.id),home:m.home,away:m.away,
          target:"NEXT_TEAM",predictedTeam,startMinute:minute,deadlineMinute:120,createdAt:now,
          startHome:Number(m.home_score)||0,startAway:Number(m.away_score)||0,startGoals:scoreOf(m),
          pressure,pressureSide:predictedTeam,status:"OPEN"});
      }
    }
    const saved=ledgerWrite(items);
    const hits=items.filter(x=>x.status==="HIT").length,misses=items.filter(x=>x.status==="MISS").length,unresolved=items.filter(x=>x.status==="UNRESOLVED").length,open=items.filter(x=>x.status==="OPEN").length;
    const summary=$("ai-edge-prediction-summary"),list=$("ai-edge-prediction-log");
    if(summary){
      const groups=[{id:15,label:"Gól do 15 min"},{id:25,label:"Gól do 25 min"},{id:"FT",label:"Gól do konca zápasu"},{id:"NEXT_TEAM",label:"Ďalší skórujúci tím"}];
      const groupHtml=groups.map(g=>{
        const rows=items.filter(x=>x.target===g.id),h=rows.filter(x=>x.status==="HIT").length,m=rows.filter(x=>x.status==="MISS").length,u=rows.filter(x=>x.status==="UNRESOLVED").length,o=rows.filter(x=>x.status==="OPEN").length;
        const decided=h+m,rate=decided?Math.round(h/decided*100)+"%":"—";
        return '<div class="ai-edge-prediction-group"><strong>'+g.label+'</strong><span>HIT '+fmt(h)+' · MISS '+fmt(m)+' · nevyhodnotiteľné '+fmt(u)+' · otvorené '+fmt(o)+'</span><b>Úspešnosť vyhodnotených: '+rate+' ('+fmt(decided)+')</b></div>';
      }).join("");
      summary.innerHTML='<div><span>Všetky pozorovania</span><b>'+fmt(items.length)+'</b></div><div><span>HIT</span><b>'+fmt(hits)+'</b></div><div><span>MISS</span><b>'+fmt(misses)+'</b></div><div><span>Nevyhodnotiteľné</span><b>'+fmt(unresolved)+'</b></div><div><span>Otvorené</span><b>'+fmt(open)+'</b></div>'+groupHtml;
    }
    if(list){
      const recent=items.slice().reverse().slice(0,8);
      list.innerHTML=recent.length?recent.map(p=>{
        const status=p.status==="HIT"?"HIT":p.status==="MISS"?"MISS":p.status==="UNRESOLVED"?"NEVYHODNOTITEĽNÉ":"OPEN";
        const horizon=p.target==="FT"?"konca zápasu":p.target==="NEXT_TEAM"?"ďalší gól · "+esc(p.predictedTeam):p.target+" min";
        const extra=p.status==="HIT"?" · gól "+(p.resultMinute??"—")+"′":p.status==="MISS"?" · bez gólu v horizonte":p.status==="UNRESOLVED"?" · čas gólu alebo celý horizont sa nedá potvrdiť":" · čaká na výsledok";
        return '<div class="ai-edge-prediction-item"><span class="ai-edge-prediction-status '+(p.status==="UNRESOLVED"?"unresolved":status.toLowerCase())+'">'+status+'</span><strong>'+esc(p.home)+' – '+esc(p.away)+'</strong><br>Gól do '+horizon+' · '+p.startMinute+'′ · tlak '+p.pressure+'/100'+esc(extra)+'</div>';
      }).join(""):'<p>Zatiaľ nebol zachytený dostatočne silný tlak na vytvorenie pozorovania.</p>';
      if(!saved) list.innerHTML+='<p class="ai-edge-note">Prehliadač nepovolil lokálne uloženie histórie.</p>';
    }
  }
  function render(data){
    const records=(data.records||[]).filter(r=>r.match?.source==="Flashscore"&&r.match.status==="live");
    const history=data.recent_history||[];
    const usable=records.map(r=>({record:r,fx:features(r.match,history,r.collected_at||data.collected_at)}));
    const withStats=usable.filter(x=>x.fx.hasCore).length;
    const fresh=usable.filter(x=>x.fx.ready).length;
    updateShadowPredictions(usable,data);
    $("ai-edge-metrics").innerHTML=[
      ["<b>"+fmt(records.length)+"</b>","LIVE zápasy"],
      ["<b>"+fmt(withStats)+"</b>","So štatistikami"],
      ["<b>"+fmt(fresh)+"</b>","Čerstvé merania"],
      ["<b>"+(data.collected_at?esc(date(data.collected_at)):"—")+"</b>","Posledný zber"]
    ].map(x=>'<div class="ai-edge-metric">'+x[0]+'<span>'+x[1]+'</span></div>').join("");
    const state=$("ai-edge-state");
    state.className="ai-edge-state "+(fresh?"good":"warn");
    state.textContent=fresh?"LIVE ANALÝZA AKTÍVNA · "+fresh+" zápasov s použiteľnými dátami":"LIVE FEED NAČÍTANÝ · čakám na čerstvé kompletné štatistiky";
    usable.sort((a,b)=>Math.max(b.fx.home,b.fx.away)-Math.max(a.fx.home,a.fx.away));
    $("ai-edge-live-list").innerHTML=usable.length?usable.map(({record,fx})=>{
      const m=record.match, h=band(fx.home,fx.ready),a=band(fx.away,fx.ready);
      const top=fx.home>fx.away?m.home:fx.away>fx.home?m.away:"Vyrovnaný tlak";
      const minute=m.live_minute??"—", score=(m.home_score??0)+":"+ (m.away_score??0);
      const f15=fx.ready?(Math.max(fx.home,fx.away)>=48?"Silný tlak · sledovať gólový vývoj":Math.max(fx.home,fx.away)>=25?"Zvýšená aktivita · bez potvrdenej predikcie":"Bez výrazného tlaku"):"Nedostatok čerstvých dát";
      const f25=fx.ready?(Math.max(fx.home,fx.away)>=38?"Tlak prítomný · dlhší horizont":Math.max(fx.home,fx.away)>=20?"Mierna aktivita · neistota vysoká":"Nízka zachytená aktivita"):"Nedostatok čerstvých dát";
      const statText=["SOT "+(fx.values.sot?fx.values.sot.home+":"+fx.values.sot.away:"—"),"strely "+(fx.values.shots?fx.values.shots.home+":"+fx.values.shots.away:"—"),"rohy "+(fx.values.corners?fx.values.corners.home+":"+fx.values.corners.away:"—"),"xG "+(fx.values.xg?fx.values.xg.home.toFixed(2)+":"+fx.values.xg.away.toFixed(2):"—"),"xGOT "+(fx.values.xgot?fx.values.xgot.home.toFixed(2)+":"+fx.values.xgot.away.toFixed(2):"—"),"v šestnástke "+(fx.values.box?fx.values.box.home+":"+fx.values.box.away:"—")].join(" · ");
      return '<article class="ai-edge-match"><div class="ai-edge-match-head"><span>'+esc(m.home)+' – '+esc(m.away)+'</span><span>'+esc(minute)+'′ · '+esc(score)+'</span></div><div class="ai-edge-match-sub">'+esc(m.competition||"")+' · dominantný tlak: '+esc(top)+'</div>'+
      '<div class="ai-edge-teamrow"><span>'+esc(m.home)+' · '+h[0]+'</span><b>'+fx.home+'/100</b></div><div class="ai-edge-bar"><i style="width:'+fx.home+'%"></i></div>'+
      '<div class="ai-edge-teamrow"><span>'+esc(m.away)+' · '+a[0]+'</span><b>'+fx.away+'/100</b></div><div class="ai-edge-bar"><i style="width:'+fx.away+'%;background:#f59e0b"></i></div>'+
      '<div class="ai-edge-forecast"><div><b>VÝHĽAD · 15 MIN</b>'+esc(f15)+'</div><div><b>VÝHĽAD · 25 MIN</b>'+esc(f25)+'</div></div>'+
      '<div class="ai-edge-note">'+esc(statText)+' · '+(fx.delta.ready?"nová aktivita za "+fx.delta.minutes.toFixed(1)+" min":"bez platného porovnania dvoch meraní")+' · štatistiky: '+(fx.age===null?"neznámy čas":Math.round(fx.age)+" min staré")+'</div></article>';
    }).join(""):'<p>Momentálne nie sú vo feede aktívne Flashscore zápasy.</p>';
    $("ai-edge-data-meta").innerHTML='<div><span>Zdroj</span><b>Flashscore LIVE · '+esc(data.data_status||"—")+'</b></div><div><span>História v LIVE feede</span><b>'+fmt(data.recent_history_count||history.length)+' snímok</b></div><div><span>Čerstvé štatistiky</span><b>'+fresh+' / '+records.length+'</b></div>';
    $("ai-edge-warning").textContent="Tlakové skóre 0–100 je transparentný experimentálny index z aktuálnych štatistík a prírastkov medzi meraniami; NIE JE to pravdepodobnosť gólu ani potvrdený AI model. Päťminútové oneskorenie zatiaľ nie je individuálne zmerané. Predikcie a stávkové odporúčania zostávajú v shadow režime.";
    $("ai-edge-updated").textContent="Feed: "+date(data.collected_at)+" · automatická obnova každých 60 s";
    $("ai-edge-audit-status").textContent="LIVE shadow · bez kurzov";
  }
  async function refresh(){
    try{const data=await load();if(data.source!=="Flashscore")throw new Error("Zdroj nie je Flashscore");render(data);}
    catch(e){const s=$("ai-edge-state");if(s){s.className="ai-edge-state bad";s.textContent="LIVE DÁTA NEDOSTUPNÉ · "+e.message;}}
  }
  document.addEventListener("DOMContentLoaded",()=>{if(!$("ai-edge-selector-panel"))return;refresh();window.setInterval(refresh,60000);});
})();
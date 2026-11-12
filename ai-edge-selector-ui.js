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

  function renderPredictionLedger(ledger){
    const summary=$("ai-edge-prediction-summary"),list=$("ai-edge-prediction-log");
    if(!ledger){
      if(summary)summary.innerHTML="<div><span>Trvalá história</span><b>Čaká na prvý zber</b></div>";
      if(list)list.innerHTML="<p>Trvalá história sa vytvorí po prvom úspešnom zbere s novým modulom.</p>";
      return;
    }
    const counts=ledger.counts||{};
    const groups=Object.entries(ledger.by_target||{});
    if(summary){
      const totals=[["Všetky predikcie",ledger.total_predictions||0],["HIT",counts.HIT||0],["MISS",counts.MISS||0],["Nevyhodnotiteľné",counts.UNRESOLVED||0],["Otvorené",counts.OPEN||0]];
      const cards=totals.map(x=>"<div><span>"+esc(x[0])+"</span><b>"+fmt(x[1])+"</b></div>").join("");
      const breakdown=groups.map(([id,g])=>"<div class='ai-edge-prediction-group'><strong>"+esc(g.label)+"</strong><span>HIT "+fmt(g.HIT)+" · MISS "+fmt(g.MISS)+" · nevyhodnotiteľné "+fmt(g.UNRESOLVED)+" · otvorené "+fmt(g.OPEN)+"</span><b>Úspešnosť vyhodnotených: "+(g.accuracy===null||g.accuracy===undefined?"—":Math.round(g.accuracy*100)+"%")+" ("+fmt(g.decided)+")</b></div>").join("");
      summary.innerHTML=cards+breakdown;
    }
    if(list){
      const rows=(ledger.predictions||[]).slice(0,12);
      list.innerHTML=rows.length?rows.map(p=>{
        const status=p.status==="HIT"?"HIT":p.status==="MISS"?"MISS":p.status==="UNRESOLVED"?"NEVYHODNOTITEĽNÉ":"OTVORENÉ";
        const target=p.target==="RESULT_1X2"?"1X2 · "+(p.predictedOutcome==="HOME"?esc(p.home):p.predictedOutcome==="AWAY"?esc(p.away):"remíza"):p.target==="NEXT_TEAM"?"ďalší skórujúci · "+esc(p.predictedTeam||"—"):p.target==="BTTS"?"oba tímy skórujú do FT":p.target==="FT"?"gól do konca zápasu":"gól do "+p.target+" min";
        const result=p.resultScore?" · výsledok "+esc(p.resultScore):"";
        const actual=p.actualOutcome?" · skutočný výsledok "+(p.actualOutcome==="HOME"?esc(p.home):p.actualOutcome==="AWAY"?esc(p.away):"remíza"):"";
        const pressure=p.target==="BTTS"?" · tlak tímu bez gólu "+fmt(p.scorelessPressure)+"/100":" · tlak "+fmt(p.pressure)+"/100";
        const stats=p.startStats||{};const statline=["SOT "+fmt(stats.sot?.home)+":"+fmt(stats.sot?.away),"strely "+fmt(stats.shots?.home)+":"+fmt(stats.shots?.away),"rohy "+fmt(stats.corners?.home)+":"+fmt(stats.corners?.away),"xG "+(stats.xg?Number(stats.xg.home).toFixed(2)+":"+Number(stats.xg.away).toFixed(2):"—")].join(" · ");
        const actualTeam=p.actualTeam?" · skóroval "+esc(p.actualTeam):"";
        const detail=p.status==="OPEN"?" · čaká na vyhodnotenie":p.status==="UNRESOLVED"?" · nedostatočné dôkazy na férové vyhodnotenie":result+actual+actualTeam;
        return "<div class='ai-edge-prediction-item'><span class='ai-edge-prediction-status "+(p.status==="UNRESOLVED"?"unresolved":p.status==="HIT"?"hit":p.status==="MISS"?"miss":"open")+"'>"+status+"</span><strong>"+esc(p.home)+" – "+esc(p.away)+"</strong><br>"+esc(target)+" · "+fmt(p.startMinute)+"′ · skóre pri predikcii "+fmt(p.startHome)+":"+fmt(p.startAway)+pressure+"<br><span class='ai-edge-note'>"+esc(statline)+"</span>"+esc(detail)+"</div>";
      }).join(""):"<p>Zatiaľ nebola zachytená žiadna predikcia.</p>";
      list.innerHTML+="<p class='ai-edge-note'>Trvalý záznam · aktualizácia "+esc(date(ledger.updated_at))+" · zdroj Flashscore</p>";
    }
  }
  async function loadLedger(){
    const url="https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./live-data-v2/data/ai-edge-prediction-history.json?t="+Date.now();
    const res=await fetch(url,{cache:"no-store",headers:{Accept:"application/json"}});
    if(res.status===404)return null;
    if(!res.ok)throw new Error("Predikčná história HTTP "+res.status);
    const data=await res.json();
    if(data.source!=="Flashscore"||data.mode!=="LIVE_PREDICTION_LEDGER")throw new Error("Neplatný formát trvalej histórie");
    return data;
  }
  function render(data,ledger){
    const records=(data.records||[]).filter(r=>r.match?.source==="Flashscore"&&r.match.status==="live");
    const history=data.recent_history||[];
    const usable=records.map(r=>({record:r,fx:features(r.match,history,r.collected_at||data.collected_at)}));
    const withStats=usable.filter(x=>x.fx.hasCore).length;
    const fresh=usable.filter(x=>x.fx.ready).length;
    renderPredictionLedger(ledger);
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
    $("ai-edge-warning").textContent="Predikcie sa vytvárajú z aktuálnych Flashscore štatistík a ukladajú sa trvalo na server. Index tlaku ani pravidlá predikcie zatiaľ nie sú kalibrované pravdepodobnosti; úspešnosť sa počíta len z vyhodnotených záznamov. Päťminútové oneskorenie je pracovný predpoklad, nie individuálne meranie.";
    $("ai-edge-updated").textContent="Feed: "+date(data.collected_at)+" · automatická obnova každých 60 s";
    $("ai-edge-audit-status").textContent="LIVE predikcie · trvalá história · bez kurzov";
  }
  async function refresh(){
    try{const [data,ledger]=await Promise.all([load(),loadLedger()]);if(data.source!=="Flashscore")throw new Error("Zdroj nie je Flashscore");render(data,ledger);}
    catch(e){const s=$("ai-edge-state");if(s){s.className="ai-edge-state bad";s.textContent="LIVE DÁTA NEDOSTUPNÉ · "+e.message;}}
  }
  document.addEventListener("DOMContentLoaded",()=>{if(!$("ai-edge-selector-panel"))return;refresh();window.setInterval(refresh,60000);});
})();
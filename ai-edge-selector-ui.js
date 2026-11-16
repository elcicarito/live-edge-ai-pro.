"use strict";
(() => {
  const FEED = "https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./live-data-v2/data/flashscore-primary-current.json";
  const SIMULATION = "https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./live-data-v2/data/ai-edge-strategy-simulation.json";
  const LATE_FT_MODEL = "https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./live-data-v2/data/ai-edge-live-late-ft-model.json";
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "—").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const fmt = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString("sk-SK") : "—";
  const date = value => { const d=new Date(value||""); return Number.isNaN(d.getTime())?"—":d.toLocaleTimeString("sk-SK"); };
  const dateTime = value => { const d=new Date(value||""); return Number.isNaN(d.getTime())?"—":d.toLocaleString("sk-SK",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}); };
  const ODDS_STORAGE_KEY = "live-edge-ai-pro-found-odds-v1";
  const foundOdds = new Map();
  try { const saved=JSON.parse(localStorage.getItem(ODDS_STORAGE_KEY)||"{}"); for(const [key,value] of Object.entries(saved)) foundOdds.set(key,String(value)); } catch {}
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

  async function loadModel(){
    const url="https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./live-data-v2/data/ai-edge-live-model.json?t="+Date.now();
    const res=await fetch(url,{cache:"no-store",headers:{Accept:"application/json"}});
    if(res.status===404)return null;
    if(!res.ok)throw new Error("LIVE model HTTP "+res.status);
    const model=await res.json();
    if(model.source!=="Flashscore"||model.mode!=="FORWARD_ONLY_LIVE_TRAINING")throw new Error("Neplatný formát LIVE modelu");
    return model;
  }
  async function loadLateFTModel(){
    const res=await fetch(LATE_FT_MODEL+"?t="+Date.now(),{cache:"no-store",headers:{Accept:"application/json"}});
    if(res.status===404)return null;
    if(!res.ok)throw new Error("LIVE full-time model HTTP "+res.status);
    const model=await res.json();
    if(model.source!=="Flashscore"||model.mode!=="FORWARD_ONLY_LIVE_TRAINING_LATE_FT")throw new Error("Neplatný formát full-time modelu");
    return model;
  }
  function renderModelStatus(model,lateFtModel){
    const el=$("ai-edge-model-status");if(!el)return;
    if(!model){
      el.textContent="Čakám na prvý zber po aktivácii tréningu. Model prijíma iba nové Flashscore LIVE snímky; staršie zápasy sa spätne nenačítavajú.";
      return;
    }
    const policy=model.validation_policy||{};
    const line=[15,25].map(h=>{
      const item=model.models?.[String(h)]||{},counts=item.counts||{},m=item.metrics||{};
      const status=item.status==="SHADOW_VALIDATED"?(policy.min_validation_matches?"tieňovo validovaný":"čaká na prísnejšie overenie"):item.status==="NOT_VALIDATED"?"nesplnil validačné kritériá":"zbiera vzorky";
      const progress=(counts.validation_matches||0)+"/"+(policy.min_validation_matches||50)+" nezávislých zápasov";
      const quality=m.log_loss!==undefined?" · log-loss "+Number(m.log_loss).toFixed(3)+" / základ "+Number(m.baseline_log_loss).toFixed(3)+" · Brier "+Number(m.brier).toFixed(3)+" / základ "+Number(m.baseline_brier).toFixed(3):"";
      const cal=m.calibration;
      const calibrationText=cal?" · kalibrácia ECE "+(Number(cal.expected_calibration_error)*100).toFixed(1)+" % · MCE "+(Number(cal.maximum_calibration_error)*100).toFixed(1)+" % · intervaly "+(cal.populated_bins||0)+"/"+(cal.bin_count||10):" · kalibrácia čaká na nové vyhodnotenie";
      return h+" min: "+status+" · tréning "+fmt(counts.train||0)+" vzoriek · overenie "+progress+quality+calibrationText;
    }).join(" | ");
    const calibrationTables=[15,25].map(h=>{
      const item=model.models?.[String(h)]||{},cal=item.metrics?.calibration;
      if(!cal||!Array.isArray(cal.bins)||!cal.bins.length)return "";
      const rows=cal.bins.map(b=>{
        const sparse=Number(b.matches_weight||0)<5;
        return "<tr><td>"+esc(b.range)+" %</td><td>"+fmt(b.count)+"</td><td>"+Number(b.matches_weight||0).toFixed(1)+"</td><td>"+(Number(b.mean_predicted)*100).toFixed(1)+" %</td><td>"+(Number(b.observed_rate)*100).toFixed(1)+" %</td><td>"+(Number(b.absolute_error)*100).toFixed(1)+" %"+(sparse?" · malá vzorka":"")+"</td></tr>";
      }).join("");
      return "<div style='overflow-x:auto;margin:8px 0 12px'><b>Kalibrácia "+h+" min · "+(cal.populated_bins||0)+"/"+(cal.bin_count||10)+" obsadených intervalov</b><table style='width:100%;border-collapse:collapse;font-size:12px;margin-top:5px'><thead><tr><th>Rozsah</th><th>Počet</th><th>Váha zápasov</th><th>Predikcia</th><th>Realita</th><th>Odchýlka</th></tr></thead><tbody>"+rows+"</tbody></table></div>";
    }).join("");
    const ft=lateFtModel?.model||{},ftCounts=ft.counts||{},ftPolicy=lateFtModel?.validation_policy||{};
    const ftStatus=ft.status==="SHADOW_VALIDATED"?"tieňovo validovaný":ft.status==="NOT_VALIDATED"?"nesplnil validačné kritériá":"zbiera vzorky";
    const ftLine="Gól do konca zápasu: "+ftStatus+" · tréning "+fmt(ftCounts.train||0)+" vzoriek / "+fmt(ftCounts.train_matches||0)+" zápasov · overenie "+fmt(ftCounts.validation||0)+" vzoriek / "+fmt(ftCounts.validation_matches||0)+" zápasov (cieľ min. "+fmt(ftPolicy.min_validation_matches||50)+" validačných zápasov)";
    const shortStatus=[15,25].map(h=>{const item=model.models?.[String(h)]||{};return h+" min: "+(item.status==="SHADOW_VALIDATED"?"tieňovo validovaný":item.status==="NOT_VALIDATED"?"bez validácie":"zbiera vzorky");}).join(" · ")+" · FT: "+ftStatus;
    el.innerHTML="<details class='ai-edge-training-details'><summary><span>ONLINE TRÉNING · IBA NOVÉ LIVE MERANIA</span><small>"+esc(shortStatus)+" · "+fmt(model.total_labeled_samples||0)+" LIVE vzoriek</small></summary><div class='ai-edge-training-content'><div>Spustené "+esc(date(model.started_at))+" · oneskorenie započítané: 5 min · "+fmt(model.total_labeled_samples||0)+" označených LIVE vzoriek. "+esc(line)+" | "+esc(ftLine)+". Každý zápas má pri vyhodnotení rovnakú váhu. Predikciu model vynechá, ak kalibračný interval nemá aspoň "+fmt(model.calibration_policy?.min_effective_match_weight||8)+" efektívnych zápasov alebo odchýlka presahuje "+(Number(model.calibration_policy?.max_absolute_error??0.08)*100).toFixed(0)+" %. Staršie výsledky bez nových validačných pravidiel sa nepovažujú za potvrdenie modelu. Pravdepodobnosti sú tieňové a automaticky vyhodnocované; nejde o potvrdenú produkčnú ani stávkovú výhodu.</div>"+calibrationTables+"</div></details>";
  }

  function renderPredictionLedger(ledger){
    const summary=$("ai-edge-prediction-summary"),topSummary=$("ai-edge-top-simulation-summary"),list=$("ai-edge-prediction-log");
    if(!ledger){
      if(summary)summary.innerHTML="<div><span>Trvalá história</span><b>Čaká na prvý zber</b></div>";
      if(topSummary)topSummary.innerHTML="<div class=\"ai-edge-prediction-group\"><strong>Čaká sa na prvý zber</strong><span>Simulácia sa zobrazí po načítaní predikčného ledgeru.</span></div>";
      if(list)list.innerHTML="<p>Trvalá história sa vytvorí po prvom úspešnom zbere s novým modulom.</p>";
      return;
    }
    const counts=ledger.counts||{};
    const groups=Object.entries(ledger.by_target||{});
    if(summary){
      const totals=[["Všetky predikcie",ledger.total_predictions||0],["HIT",counts.HIT||0],["MISS",counts.MISS||0],["Nevyhodnotiteľné",counts.UNRESOLVED||0],["Otvorené",counts.OPEN||0]];
      const cards=totals.map(x=>"<div><span>"+esc(x[0])+"</span><b>"+fmt(x[1])+"</b></div>").join("");
      const renderMinimumOddsSimulation=([id,g])=>{const sim=g.minimum_odds_simulation;if(!sim||!["MODEL_15","MODEL_25","MODEL_FT"].includes(id))return "";return "<div class='ai-edge-prediction-group'><strong>"+esc(g.label)+"</strong><span>SIMULÁCIA PRI INDIVIDUÁLNOM MINIMÁLNOM KURZE · 1 jednotka na zápas</span><b>Čistý výsledok: "+(sim.net_profit>0?"+":"")+Number(sim.net_profit||0).toFixed(2)+" j. · ROI "+(sim.roi===null?"—":(sim.roi>0?"+":"")+Number(sim.roi).toFixed(2)+" %")+"</b><span>Vyhodnotené "+fmt(sim.decided)+" · HIT "+fmt(sim.HIT)+" / MISS "+fmt(sim.MISS)+" · otvorené "+fmt(sim.OPEN)+" · nevyriešené "+fmt(sim.UNRESOLVED)+" · priemerný min. kurz "+(sim.average_minimum_odds===null?"—":Number(sim.average_minimum_odds).toFixed(2))+"</span></div>";};
      const breakdown=groups.map(([id,g])=>{const sim=g.minimum_odds_simulation;const simulation=sim?"<span>SIMULÁCIA PRI INDIVIDUÁLNOM MINIMÁLNOM KURZE · 1 jednotka na zápas</span><b>Čistý výsledok: "+(sim.net_profit>0?"+":"")+Number(sim.net_profit||0).toFixed(2)+" j. · ROI "+(sim.roi===null?"—":(sim.roi>0?"+":"")+Number(sim.roi).toFixed(2)+" %")+"</b><span>Vyhodnotené "+fmt(sim.decided)+" · HIT "+fmt(sim.HIT)+" / MISS "+fmt(sim.MISS)+" · otvorené "+fmt(sim.OPEN)+" · nevyriešené "+fmt(sim.UNRESOLVED)+" · priemerný min. kurz "+(sim.average_minimum_odds===null?"—":Number(sim.average_minimum_odds).toFixed(2))+"</span>":"";return "<div class='ai-edge-prediction-group'><strong>"+esc(g.label)+"</strong><span>HIT "+fmt(g.HIT)+" · MISS "+fmt(g.MISS)+" · nevyhodnotiteľné "+fmt(g.UNRESOLVED)+" · otvorené "+fmt(g.OPEN)+"</span><b>Úspešnosť vyhodnotených: "+(g.accuracy===null||g.accuracy===undefined?"—":Math.round(g.accuracy*100)+"%")+" ("+fmt(g.decided)+")</b>"+simulation+"</div>";}).join("");
      summary.innerHTML=cards+breakdown;
      const topSimulations=groups.map(renderMinimumOddsSimulation).join("");
      if(topSummary)topSummary.innerHTML=topSimulations||"<div class=\"ai-edge-prediction-group\"><strong>Simulácia čaká na vhodné predikcie</strong><span>Výsledky sa zobrazia po uzavretí predikcií s uloženým individuálnym minimálnym kurzom.</span></div>";
    }
    if(list){
      const allRows=ledger.predictions||[];const rows=allRows.slice(0,30);
      list.innerHTML=rows.length?rows.map(p=>{
        const status=p.status==="HIT"?"HIT":p.status==="MISS"?"MISS":p.status==="UNRESOLVED"?"NEVYHODNOTITEĽNÉ":"OTVORENÉ";
        const target=p.target==="RESULT_1X2"?"1X2 · "+(p.predictedOutcome==="HOME"?p.home:p.predictedOutcome==="AWAY"?p.away:"remíza"):p.target==="NEXT_TEAM"?"ďalší skórujúci · "+esc(p.predictedTeam||"—"):p.target==="BTTS"?"oba tímy skórujú do FT":(p.target==="MODEL_15"||p.target==="MODEL_25")?"AI EDGE · gól do "+(p.target==="MODEL_15"?15:25)+" min · "+(Number.isFinite(Number(p.modelProbability))?(Number(p.modelProbability)*100).toFixed(1)+"% SHADOW":"bez pravdepodobnosti"):p.target==="MODEL_FT"?"AI EDGE · gól do konca zápasu · "+(Number.isFinite(Number(p.modelProbability))?(Number(p.modelProbability)*100).toFixed(1)+"% SHADOW":"bez pravdepodobnosti"):p.target==="FT"?"gól do konca zápasu":"gól do "+p.target+" min";
        const result=p.resultScore?" · výsledok "+p.resultScore:"";
        const actual=p.actualOutcome?" · skutočný výsledok "+(p.actualOutcome==="HOME"?p.home:p.actualOutcome==="AWAY"?p.away:"remíza"):"";
        const pressure=p.target==="BTTS"?" · tlak tímu bez gólu "+fmt(p.scorelessPressure)+"/100":" · tlak "+fmt(p.pressure)+"/100";
        const stats=p.startStats||{};const statline=["SOT "+fmt(stats.sot?.home)+":"+fmt(stats.sot?.away),"strely "+fmt(stats.shots?.home)+":"+fmt(stats.shots?.away),"rohy "+fmt(stats.corners?.home)+":"+fmt(stats.corners?.away),"xG "+(stats.xg?Number(stats.xg.home).toFixed(2)+":"+Number(stats.xg.away).toFixed(2):"—")].join(" · ");
        const actualTeam=p.actualTeam?" · skóroval "+p.actualTeam:"";
        const detail=p.status==="OPEN"?" · čaká na vyhodnotenie":p.status==="UNRESOLVED"?" · "+(p.unresolvedReason||"nedostatočné dôkazy na férové vyhodnotenie"):result+actual+actualTeam;
        const modelInfo=(p.target==="MODEL_15"||p.target==="MODEL_25"||p.target==="MODEL_FT")?"<br><span class='ai-edge-model-time'>SHADOW · vygenerované "+esc(dateTime(p.createdAt))+" · P "+(Number(p.modelProbability)*100).toFixed(1)+" % · férový kurz "+(Number(p.modelProbability)>0?(1/Number(p.modelProbability)).toFixed(2):"—")+" · minimálny kurz "+(Number.isFinite(Number(p.modelMinimumOdds))?Number(p.modelMinimumOdds).toFixed(2):"—")+" · okno "+fmt(p.actionableAfterMinute)+"′–"+fmt(p.deadlineMinute)+"′</span>":"";
        return "<div class='ai-edge-prediction-item'><span class='ai-edge-prediction-status "+(p.status==="UNRESOLVED"?"unresolved":p.status==="HIT"?"hit":p.status==="MISS"?"miss":"open")+"'>"+status+"</span><strong>"+esc(p.home)+" – "+esc(p.away)+"</strong><br>"+esc(target)+" · "+fmt(p.startMinute)+"′ · skóre pri predikcii "+fmt(p.startHome)+":"+fmt(p.startAway)+pressure+modelInfo+"<br><span class='ai-edge-note'>"+esc(statline)+"</span>"+esc(detail)+"</div>";
      }).join(""):"<p>Zatiaľ nebola zachytená žiadna predikcia.</p>";
      list.innerHTML+="<p class='ai-edge-note'>Zobrazených "+fmt(rows.length)+" z "+fmt(ledger.total_predictions||allRows.length)+" trvalých predikcií · aktualizácia "+esc(date(ledger.updated_at))+" · zdroj Flashscore</p>";
    }
  }
  async function loadStrategy(){const res=await fetch(SIMULATION+"?t="+Date.now(),{cache:"no-store",headers:{Accept:"application/json"}});if(!res.ok)throw new Error("Simulátor HTTP "+res.status);const data=await res.json();if(data.source!=="Flashscore"||data.mode!=="AI_EDGE_STRATEGY_SIMULATION_DATA"||!Array.isArray(data.predictions))throw new Error("Neplatné dáta simulátora");return data;}
  function runStrategySimulation(data){
    const out=$("ai-edge-strategy-results");if(!out)return;
    const odds=Number($("ai-edge-sim-odds")?.value),bankroll=Number($("ai-edge-sim-bankroll")?.value),stake=Number($("ai-edge-sim-stake")?.value);
    if(![odds,bankroll,stake].every(Number.isFinite)||odds<=1||bankroll<=0||stake<=0){out.textContent="Zadaj kurz vyšší ako 1, kladný bankroll a kladný rovný vklad.";return;}
    const all=(data.predictions||[]).filter(r=>r.target==="MODEL_FT"&&(r.status==="HIT"||r.status==="MISS"));
    const money=x=>x.toLocaleString("sk-SK",{minimumFractionDigits:2,maximumFractionDigits:2});
    const run=(rows,scenarioOdds=odds)=>{let balance=bankroll,peak=bankroll,drawdown=0,wins=0,losses=0,skippedOdds=0,duplicate=0,staked=0;const used=new Set();for(const row of rows.slice().sort((a,b)=>Number(a.createdAt)-Number(b.createdAt))){if(scenarioOdds+1e-9<Number(row.minimumOdds)){skippedOdds++;continue;}const key=String(row.matchId||row.id||"");if(used.has(key)){duplicate++;continue;}used.add(key);const wager=Math.min(balance,stake);if(wager<=0)break;staked+=wager;if(row.status==="HIT"){balance+=wager*(scenarioOdds-1);wins++;}else{balance-=wager;losses++;}peak=Math.max(peak,balance);drawdown=Math.max(drawdown,peak-balance);}return{bets:wins+losses,wins,losses,skippedOdds,duplicate,net:balance-bankroll,end:balance,drawdown,staked};};
    const base=run(all),card="<div class='ai-edge-sim-result'><strong>ROVNÝ VKLAD · IBA MODEL GÓL DO KONCA</strong><b>"+(base.net>=0?"+":"")+money(base.net)+" jednotiek</b><span>Konečný bankroll: "+money(base.end)+" · stávky: "+base.bets+" (HIT "+base.wins+" / MISS "+base.losses+")</span><span>Max. prepad od maxima: "+money(base.drawdown)+" · vsadené spolu: "+money(base.staked)+" · vynechané pre kurz: "+base.skippedOdds+" · duplicity: "+base.duplicate+"</span></div>";
    const oddsGrid=[2,2.25,2.5,2.75,3],sensitivity="<div class='ai-edge-section-title'>CITLIVOSŤ NA HYPOTETICKÝ KURZ · VŽDY ROVNAKÝ VKLAD</div><div class='ai-edge-sim-table-wrap'><table class='ai-edge-sim-table'><thead><tr><th>kurz</th><th>stávky</th><th>HIT / MISS</th><th>čistý výsledok</th><th>max. prepad</th></tr></thead><tbody>"+oddsGrid.map(q=>{const x=run(all,q);return "<tr><td>"+money(q)+"</td><td>"+x.bets+"</td><td>"+x.wins+" / "+x.losses+"</td><td>"+(x.net>=0?"+":"")+money(x.net)+"</td><td>"+money(x.drawdown)+"</td></tr>";}).join("")+"</tbody></table></div>";
    out.innerHTML="<div class='ai-edge-sim-meta'>Samostatné vyhodnotenie full-time OVER modelu · hypotetický kurz: "+money(odds)+" · počiatočný bankroll: "+money(bankroll)+" · rovnaký vklad: "+money(stake)+" · uzavreté predikcie: "+fmt(all.length)+" · dáta: "+esc(date(data.updated_at))+"</div>"+card+sensitivity+"<p class='ai-edge-note'>Počíta sa najviac jedna stávka na zápas, iba ak hypotetický kurz dosahuje individuálny minimálny kurz. Ide o spätný modelový test pri rovnakom hypotetickom kurze, nie o skutočné historické kurzy ani potvrdený zisk. OPEN a UNRESOLVED sú vylúčené.</p>";
  }

  async function loadLedger(){
    const url="https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./live-data-v2/data/ai-edge-prediction-live.json?t="+Date.now();
    const res=await fetch(url,{cache:"no-store",headers:{Accept:"application/json"}});
    if(res.status===404)return null;
    if(!res.ok)throw new Error("Predikčná história HTTP "+res.status);
    const data=await res.json();
    if(data.source!=="Flashscore"||data.mode!=="LIVE_PREDICTION_LEDGER_VIEW")throw new Error("Neplatný formát trvalej histórie");
    return data;
  }
  async function loadTopLedger(){
    const url="https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./live-data-v2/data/ai-edge-top-opportunity-ledger.json?t="+Date.now();
    const res=await fetch(url,{cache:"no-store",headers:{Accept:"application/json"}});
    if(res.status===404)return null;
    if(!res.ok)throw new Error("TOP história HTTP "+res.status);
    const data=await res.json();
    if(data.source!=="Flashscore"||data.mode!=="TOP_OPPORTUNITY_LEDGER")throw new Error("Neplatný formát TOP histórie");
    return data;
  }
  function renderTopOpportunities(data,ledger,model,lateFtModel,usable,topLedger){
    const panel=$("ai-edge-top-opportunities");if(!panel)return;
    const title="<div style='font-size:13px;font-weight:900;letter-spacing:.6px;color:#d7f2ff'>🎯 TOP LIVE PRÍLEŽITOSTI</div>";
    const note="<div style='font-size:10px;color:#9bb1c7;line-height:1.45;margin:5px 0 9px'>Panel zobrazuje dva oddelené modely: <b>AI EDGE 25</b> = gól v nasledujúcich 25 minútach po 5-minútovom oneskorení; <b>MODEL_FT</b> = gól do konca riadneho zápasu. Ich pravdepodobnosti ani trhy sa nezamieňajú. Minimálny kurz sa pri zachytení uloží natrvalo a po skončení zápasu sa vyhodnotí simulovaný zisk pri tomto individuálnom kurze. Ručne zadaný kurz je iba doplnkový.</div>";
    const liveAt=Date.parse(data.collected_at||""),ledgerAt=Date.parse(ledger?.updated_at||"");
    if(!ledger||!Number.isFinite(liveAt)||Date.now()-liveAt>8*60000||!Number.isFinite(ledgerAt)||Date.now()-ledgerAt>6*60000){
      panel.innerHTML=title+note+"<div style='padding:10px;border:1px solid #40536a;border-radius:9px;color:#f4d28d;font-size:11px'>Výber je pozastavený: čakám na čerstvé LIVE dáta a aktuálnu predikčnú históriu.</div>";return;
    }
    const live=new Map(usable.filter(x=>x.fx.ready).map(x=>[String(x.record.match?.id),x]));
    const latest=new Map();
    for(const row of ledger.predictions||[]){
      if(!["MODEL_25","MODEL_FT"].includes(row.target)||row.status!=="OPEN"||row.modelStatus!=="SHADOW_VALIDATED"||!Number.isFinite(Number(row.modelProbability))||!Number.isFinite(Number(row.modelMinimumOdds))||!Number.isFinite(Number(row.modelCalibrationError)))continue;
      const id=String(row.matchId||"")+"|"+row.target,previous=latest.get(id);
      if(!previous||Number(row.createdAt)>Number(previous.createdAt))latest.set(id,row);
    }
    // Jeden TOP záznam na zápas a model počas celého zápasu.
    // Po zachytení v trvalom TOP registri sa ďalšie časovo posunuté predikcie
    // toho istého zápasu už v paneli nezobrazujú, ani keď pôvodný tip skončil.
    const alreadyCaptured=new Set((topLedger?.entries||[])
      .filter(x=>["MODEL_25","MODEL_FT"].includes(x.target))
      .map(x=>String(x.matchId||"")+"|"+x.target));
    const candidates=[],candidateKeys=new Set();
    const addCandidate=(row,current)=>{
      const m=current.record.match||{},minute=Number.parseInt(m.live_minute,10);
      if(!Number.isFinite(minute)||minute<1||minute>110)return;
      const deadline=Number(row.deadlineMinute),after=Number(row.actionableAfterMinute),createdRaw=row.createdAt,createdAt=typeof createdRaw==="number"?createdRaw:(Number.isFinite(Number(createdRaw))?Number(createdRaw):Date.parse(createdRaw)),rowAge=Date.now()-createdAt;
      if(!Number.isFinite(after)||!Number.isFinite(deadline)||deadline<=after||minute>deadline)return;
      if(!Number.isFinite(rowAge)||rowAge<0)return;
      const p=Number(row.modelProbability),error=Number(row.modelCalibrationError),conservative=Number.isFinite(Number(row.conservativeProbability))?Number(row.conservativeProbability):Math.max(0.01,p-error);
      const is25=row.target==="MODEL_25";
      const market=is25?"GÓL V NASLEDUJÚCICH 25 MIN":"OVER "+((Number(m.home_score)||0)+(Number(m.away_score)||0)+0.5).toFixed(1);
      const oddsKey=String(row.id||row.matchId+"|"+row.target)+"|"+(is25?"GOAL_25_MIN":market.replace(/\s+/g,"_"));
      const entered=foundOdds.get(oddsKey)||"",enteredNum=Number(entered.replace(",",".")),ev=entered.trim()&&Number.isFinite(enteredNum)&&enteredNum>1?(enteredNum*conservative-1)*100:null;
      const min=Number(row.modelMinimumOdds);
      const groupId=String(row.matchId||"")+"|"+row.target;
      if(candidateKeys.has(groupId))return;
      candidateKeys.add(groupId);
      candidates.push({row,current,minute,conservative,after,deadline,target:row.target,market,oddsKey,entered,ev,min});
    };
    // Zobraziť už zachytené otvorené TOP tipy; register nesmie skryť aktívnu príležitosť.
    for(const entry of topLedger?.entries||[]){
      if(entry.status!=="OPEN"||!["MODEL_25","MODEL_FT"].includes(entry.target))continue;
      const current=live.get(String(entry.matchId||""));if(!current)continue;
      const score=String(entry.capturedScore||"0:0").split(":").map(Number);
      const row={...entry,id:entry.predictionId,createdAt:entry.sourcePredictionAt,startMinute:entry.capturedMinute,startHome:score[0],startAway:score[1],modelCalibrationError:entry.calibrationError,modelMinimumOdds:entry.minimumOdds,modelProbability:entry.modelProbability,conservativeProbability:entry.conservativeProbability};
      addCandidate(row,current);
    }
    // Nové kandidáty iba ak zápas + model ešte nie sú v TOP registri.
    for(const row of latest.values()){
      const groupId=String(row.matchId||"")+"|"+row.target;
      if(alreadyCaptured.has(groupId))continue;
      const current=live.get(String(row.matchId||""));if(!current)continue;
      addCandidate(row,current);
    }
    candidates.sort((a,b)=>(b.ev===null?-1:b.ev)-(a.ev===null?-1:a.ev)||b.conservative-a.conservative||Number(b.row.modelCalibrationMatchesWeight)-Number(a.row.modelCalibrationMatchesWeight));
    const top=candidates;
    const cards=top.map((item,index)=>{
      const r=item.row,m=item.current.record.match||{},entered=item.entered,v=Number(entered.replace(",",".")),p=Number(r.modelProbability),fair=1/p,min=item.min,error=Number(r.modelCalibrationError),conservative=item.conservative;
      const ev=entered.trim()&&Number.isFinite(v)&&v>1?(v*conservative-1)*100:null;
      const meets=Number.isFinite(v)&&v>1&&v+1e-9>=min;
      const comparison=!entered.trim()?"<span class='ai-edge-odds-result neutral'>ČAKÁ NA TVOJ KURZ</span>":!Number.isFinite(v)||v<=1?"<span class='ai-edge-odds-result neutral'>NEPLATNÝ KURZ</span>":meets?"<span class='ai-edge-odds-result good'>KURZ DOSAHUJE MINIMUM · EV+ ODHAD</span>":ev>0?"<span class='ai-edge-odds-result neutral'>EV KLADNÉ, ALE KURZ POD BEZPEČNÝM MINIMOM</span>":"<span class='ai-edge-odds-result bad'>KURZ POD MINIMOM · EV NIE JE KLADNÉ</span>";
      const timing=item.minute<item.after?"ČAKÁ NA OKNO od "+item.after+"′":"OKNO AKTÍVNE";
      const color=meets?"#39d98a":ev!==null&&ev>0?"#f4d27a":"#f08b8b";
      const horizon=item.target==="MODEL_25"?"AI EDGE 25 · GÓL V NASLEDUJÚCICH 25 MIN":"MODEL_FT · GÓL DO KONCA RIADNEHO ČASU";
      const marketHint=item.target==="MODEL_25"?"Nie je to automaticky OVER do konca zápasu.":"Trh OVER podľa aktuálneho skóre.";
      return "<article class='ai-edge-match' style='border-color:"+color+"'><div class='ai-edge-match-head'><span>"+(index+1)+". "+esc(m.home)+" – "+esc(m.away)+"</span><span>"+esc(m.live_minute)+"′ · "+esc(m.home_score)+":"+esc(m.away_score)+"</span></div><div class='ai-edge-match-sub'>"+esc(m.competition||m.league||"")+" · <span style='color:"+color+";font-weight:900'>"+horizon+"</span> · "+timing+"</div><div style='font-size:11px;font-weight:900;color:#d7f2ff;margin-top:5px'>TRH / CIEĽ: "+esc(item.market)+"</div><div class='ai-edge-model-numbers' style='margin-top:8px'><b>"+(p*100).toFixed(1)+" %</b><span>modelová pravdepodobnosť</span><b>"+(conservative*100).toFixed(1)+" %</b><span>konzervatívna pravdepodobnosť</span><b>"+fair.toFixed(2)+"</b><span>férový kurz</span><b>"+min.toFixed(2)+"</b><span>minimálny kurz pre EV +5 %</span></div><div class='ai-edge-model-time'>Zachytené: "+fmt(r.startMinute)+"′ pri skóre "+fmt(r.startHome)+":"+fmt(r.startAway)+" · "+esc(dateTime(r.createdAt))+" · rozhodovacie okno "+fmt(item.after)+"′–"+fmt(item.deadline)+"′</div><div class='ai-edge-odds-check'><label>DOPLNKOVÝ SKUTOČNÝ KURZ (NEPOVINNÝ)<input type='number' min='1.01' step='0.01' inputmode='decimal' placeholder='napr. 2.10' value='"+esc(entered)+"' data-ai-edge-odds='"+esc(item.oddsKey)+"' data-min-odds='"+min+"' data-conservative-probability='"+conservative+"'></label>"+comparison+"<span class='ai-edge-model-time' data-ev-output='' style='color:"+color+";font-weight:900'>"+(ev===null?"Odhadované EV pri zadanom kurze: —":"Odhadované EV pri zadanom kurze: "+(ev>=0?"+":"")+ev.toFixed(1)+" % na vklad")+"</span></div><div class='ai-edge-model-foot'>"+marketHint+" Výpočet EV = (skutočný kurz × konzervatívna pravdepodobnosť) − 1. Použitá P = modelová P − chyba kalibrácie ("+(error*100).toFixed(1)+" %); bezpečnostná rezerva minimálneho kurzu je 5 %. Vzorka kalibrácie: "+(Number.isFinite(Number(r.modelCalibrationMatchesWeight))?fmt(r.modelCalibrationMatchesWeight):"údaj nie je uložený")+" vážených zápasov. Je to odhad podľa modelu, nie dôkaz ziskovosti.</div></article>";
    }).join("");
    const summaryRows=["MODEL_25","MODEL_FT"].map(target=>{
      const x=topLedger?.summary?.[target]||{},label=target==="MODEL_25"?"AI EDGE 25":"MODEL_FT";
      const decided=Number(x.decided||0),wins=Number(x.HIT||0),losses=Number(x.MISS||0),total=Number(x.total||0),open=Number(x.OPEN||0),unresolved=Number(x.UNRESOLVED||0);
      const hitRate=decided?wins/decided*100:null,roi=x.roi===null||x.roi===undefined?null:Number(x.roi),net=x.netProfit===null||x.netProfit===undefined?null:Number(x.netProfit),draw=x.maxDrawdown===null||x.maxDrawdown===undefined?null:Number(x.maxDrawdown);
      const positive=net!==null&&net>0,negative=net!==null&&net<0,accent=positive?"#48d69a":negative?"#ff7185":"#8eb5d8",roiColor=roi===null?"#9fb2c6":roi>0?"#48d69a":roi<0?"#ff7185":"#d8e5f2";
      const pct=hitRate===null?0:Math.max(0,Math.min(100,hitRate));
      const metric=(value,label,extra="")=>"<div style='min-width:0;padding:9px 10px;border:1px solid rgba(137,165,194,.15);background:rgba(9,19,31,.56);border-radius:10px'><div style='font-size:17px;line-height:1.15;font-weight:850;letter-spacing:-.3px;color:"+ (extra||"#e8f1fa")+";font-variant-numeric:tabular-nums'>"+value+"</div><div style='font-size:9px;line-height:1.35;color:#8fa6bc;margin-top:4px;text-transform:uppercase;letter-spacing:.65px'>"+label+"</div></div>";
      return "<article style='position:relative;overflow:hidden;border:1px solid rgba(125,164,199,.24);border-radius:14px;padding:13px;background:linear-gradient(145deg,rgba(27,48,69,.92),rgba(12,24,38,.96));box-shadow:0 8px 24px rgba(0,0,0,.16)'><div style='position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,"+(target==="MODEL_25"?"#38bdf8":"#a78bfa")+",transparent)'></div><div style='display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px'><div><div style='font-size:9px;color:#91a9bf;letter-spacing:1.2px;font-weight:800'>MODEL PERFORMANCE</div><div style='font-size:15px;font-weight:900;color:#edf6ff;margin-top:3px'>"+label+"</div></div><div style='font-size:10px;color:#9bb4ca;border:1px solid rgba(143,174,202,.2);border-radius:20px;padding:5px 8px;background:rgba(8,17,28,.42)'>1 UNIT / TIP</div></div><div style='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px'>"+metric(fmt(total),"zachytené v TOP")+metric(wins+" / "+losses,"HIT / MISS")+metric(roi===null?"—":(roi>0?"+":"")+fmt(roi)+" %","ROI",roiColor)+metric(net===null?"—":(net>0?"+":"")+fmt(net),"čistý výsledok · jednotky",accent)+metric(draw===null?"—":fmt(draw),"max. prepad · jednotky")+metric(hitRate===null?"—":fmt(hitRate)+" %","úspešnosť",hitRate===null?"#9fb2c6":hitRate>=50?"#48d69a":"#ffbd69")+"</div><div style='margin-top:11px'><div style='display:flex;justify-content:space-between;gap:8px;font-size:10px;color:#9bb1c6;margin-bottom:5px'><span>Úspešnosť rozhodnutých tipov</span><b style='color:#dceafa'>"+(hitRate===null?"bez vyhodnotenia":fmt(hitRate)+" %")+"</b></div><div style='height:5px;border-radius:8px;background:#26394c;overflow:hidden'><div style='height:100%;width:"+pct+"%;border-radius:8px;background:linear-gradient(90deg,#28b987,#77e2b6)'></div></div></div><div style='display:flex;flex-wrap:wrap;gap:6px;margin-top:10px'><span style='font-size:10px;color:#b9cadd;background:rgba(8,18,29,.55);border:1px solid rgba(143,174,202,.14);border-radius:7px;padding:5px 7px'>OPEN <b style='color:#f2d28a'>"+fmt(open)+"</b></span><span style='font-size:10px;color:#b9cadd;background:rgba(8,18,29,.55);border:1px solid rgba(143,174,202,.14);border-radius:7px;padding:5px 7px'>NEVYRIEŠENÉ <b style='color:#c5d5e4'>"+fmt(unresolved)+"</b></span><span style='font-size:10px;color:#b9cadd;background:rgba(8,18,29,.55);border:1px solid rgba(143,174,202,.14);border-radius:7px;padding:5px 7px'>VYHODNOTENÉ <b style='color:#dceafa'>"+fmt(decided)+"</b></span></div></article>";
    }).join("");
    const topStats="<details class='ai-edge-top-performance'><summary class='ai-edge-top-performance-summary'><div style='display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:0'><div><div style='font-size:9px;letter-spacing:1.5px;color:#8fa9c0;font-weight:850'>ANALYTICS · PERFORMANCE</div><div style='font-size:14px;font-weight:950;letter-spacing:.3px;color:#eff7ff;margin-top:3px'>📊 SAMOSTATNÉ VYHODNOTENIE TOP</div></div><span style='font-size:9px;color:#70d8ae;border:1px solid rgba(72,214,154,.25);background:rgba(29,126,91,.12);padding:5px 8px;border-radius:20px;white-space:nowrap'>FIXNÝ VKLAD 1 U</span></div></summary><div class='ai-edge-top-performance-content'><div style='display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,245px),1fr));gap:9px'>"+summaryRows+"</div><div style='font-size:10px;line-height:1.55;color:#8fa5ba;margin-top:11px;padding-top:9px;border-top:1px solid rgba(137,165,194,.13)'>Meranie sa začína od nasadenia TOP registra; staršie zaradenia sa spätne nedopočítavajú. Eviduje sa najviac jeden tip na zápas a model. Simulácia používa uzamknutý individuálny minimálny kurz, nie skutočný historický kurz stávkovej kancelárie. ROI je preto hypotetické. História TOP sa uchováva trvalo.<div style='margin-top:5px;color:#748da4'>"+(topLedger?.updated_at?"Posledná aktualizácia: "+esc(dateTime(topLedger.updated_at)):"TOP register čaká na prvý beh kolektora.")+"</div></div></div></details>";
    panel.innerHTML=title+note+(cards||"<div style='padding:10px;border:1px solid #40536a;border-radius:9px;color:#c3d2e1;font-size:11px'>Momentálne nie je kandidát z AI EDGE 25 ani MODEL_FT, ktorý súčasne spĺňa vlastnú validáciu, kalibráciu, čerstvosť dát a aktívne časové okno. Žiadny tip sa nebude vytvárať nasilu.</div>")+(topLedger?topStats:"<div style='margin-top:12px;padding:9px;color:#f4d28d;font-size:11px'>Samostatný TOP register sa ešte pripravuje; štatistika sa zobrazí po prvom úspešnom behu kolektora.</div>");
  }

  function render(data,ledger,model,lateFtModel,topLedger){
    const records=(data.records||[]).filter(r=>r.match?.source==="Flashscore"&&r.match.status==="live");
    const history=data.recent_history||[];
    const usable=records.map(r=>({record:r,fx:features(r.match,history,r.collected_at||data.collected_at)}));
    const withStats=usable.filter(x=>x.fx.hasCore).length;
    const fresh=usable.filter(x=>x.fx.ready).length;
    renderPredictionLedger(ledger);
    renderModelStatus(model,lateFtModel);
    renderTopOpportunities(data,ledger,model,lateFtModel,usable,topLedger);
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
      const horizonState=h=>{
        const item=model?.models?.[String(h)]||{},policy=model?.validation_policy||{},counts=item.counts||{};
        if(item.status==="SHADOW_VALIDATED"&&Array.isArray(item.weights)&&item.weights.length) return "Model tieňovo validovaný · pravdepodobnosť sa zapisuje pri vhodných LIVE dátach";
        if(item.status==="NOT_VALIDATED") return "Model nesplnil validačné kritériá · bez predikcie";
        return "Tréning / overovanie · "+fmt(counts.validation_matches||0)+"/"+fmt(policy.min_validation_matches||50)+" nezávislých zápasov";
      };
      const modelRow15=(ledger?.predictions||[]).find(p=>p.matchId===String(m.id)&&p.target==="MODEL_15");const modelRow25=(ledger?.predictions||[]).find(p=>p.matchId===String(m.id)&&p.target==="MODEL_25");const modelLine=(row,h)=>{if(!row||!Number.isFinite(Number(row.modelProbability)))return "<span class='ai-edge-badge neutral'>BEZ PREDIKCIE</span><span>"+esc(horizonState(h))+"</span>";const p=Number(row.modelProbability),fair=p>0&&p<1?(1/p).toFixed(2):"—",minimum=Number.isFinite(Number(row.modelMinimumOdds))?Number(row.modelMinimumOdds):null,minText=minimum===null?"—":minimum.toFixed(2),key=String(row.id||row.matchId+"|MODEL_"+h),entered=foundOdds.get(key)||"",enteredNum=Number(entered.replace(',','.')),comparison=!entered.trim()?"<span class='ai-edge-odds-result neutral'>Zadaj kurz, ktorý si našiel</span>":!Number.isFinite(enteredNum)||enteredNum<=1?"<span class='ai-edge-odds-result neutral'>Neplatný kurz</span>":minimum===null?"<span class='ai-edge-odds-result neutral'>Minimálny kurz nie je dostupný</span>":enteredNum+1e-9>=minimum?"<span class='ai-edge-odds-result good'>LIMIT SPLNENÝ · SHADOW</span>":"<span class='ai-edge-odds-result bad'>POD MINIMÁLNYM KURZOM</span>",after=Number(row.actionableAfterMinute??(Number(row.startMinute)+5)),until=Number(row.deadlineMinute),window=Number.isFinite(after)&&Number.isFinite(until)?after+"′ – "+until+"′":"—";return "<div class='ai-edge-model-prediction'><span class='ai-edge-badge shadow'>SHADOW · TIEŇOVÁ PREDIKCIA</span><div class='ai-edge-model-numbers'><b>"+(p*100).toFixed(1)+" %</b><span>pravdepodobnosť</span><b>"+fair+"</b><span>férový kurz</span><b>"+minText+"</b><span>minimálny kurz</span></div><div class='ai-edge-model-time'>Vygenerované: "+esc(dateTime(row.createdAt))+" · pri minúte "+fmt(row.startMinute)+"′ · skóre "+fmt(row.startHome)+":"+fmt(row.startAway)+"</div><div class='ai-edge-model-time'>Časové okno podľa 5-minútového bufferu: <b>"+window+"</b> · rozhodovací okamih najskôr od "+(Number.isFinite(after)?after+"′":"—")+"</div><div class='ai-edge-odds-check'><label>DOPLNKOVÝ SKUTOČNÝ KURZ<input type='number' min='1.01' step='0.01' inputmode='decimal' placeholder='napr. 2.10' value='"+esc(entered)+"' data-ai-edge-odds='"+esc(key)+"' data-min-odds='"+(minimum===null?"":minimum)+"'></label>"+comparison+"</div><div class='ai-edge-model-foot'>Záznam: "+(row.status==="OPEN"?"čaká na vyhodnotenie":esc(row.status))+" · výstup modelu nie je pokyn na stávku ani potvrdená produkčná výhoda.</div></div>";};const f15=modelLine(modelRow15,15);const f25=modelLine(modelRow25,25);const selectorPreview=(row,h)=>row&&Number.isFinite(Number(row.modelProbability))?(h+" MIN · "+(Number(row.modelProbability)*100).toFixed(1)+" % SHADOW"):(h+" MIN · BEZ PREDIKCIE");const selectorSummary=selectorPreview(modelRow15,15)+" · "+selectorPreview(modelRow25,25);
      const statText=["SOT "+(fx.values.sot?fx.values.sot.home+":"+fx.values.sot.away:"—"),"strely "+(fx.values.shots?fx.values.shots.home+":"+fx.values.shots.away:"—"),"rohy "+(fx.values.corners?fx.values.corners.home+":"+fx.values.corners.away:"—"),"xG "+(fx.values.xg?fx.values.xg.home.toFixed(2)+":"+fx.values.xg.away.toFixed(2):"—"),"xGOT "+(fx.values.xgot?fx.values.xgot.home.toFixed(2)+":"+fx.values.xgot.away.toFixed(2):"—"),"v šestnástke "+(fx.values.box?fx.values.box.home+":"+fx.values.box.away:"—")].join(" · ");
      return '<article class="ai-edge-match"><div class="ai-edge-match-head"><span>'+esc(m.home)+' – '+esc(m.away)+'</span><span>'+esc(minute)+'′ · '+esc(score)+'</span></div><div class="ai-edge-match-sub">'+esc(m.competition||"")+' · dominantný tlak: '+esc(top)+'</div>'+
      '<div class="ai-edge-teamrow"><span>'+esc(m.home)+' · '+h[0]+'</span><b>'+fx.home+'/100</b></div><div class="ai-edge-bar"><i style="width:'+fx.home+'%"></i></div>'+
      '<div class="ai-edge-teamrow"><span>'+esc(m.away)+' · '+a[0]+'</span><b>'+fx.away+'/100</b></div><div class="ai-edge-bar"><i style="width:'+fx.away+'%;background:#f59e0b"></i></div>'+
      '<details class="ai-edge-selector-details"><summary><span>DETAIL PREDIKCIE</span><small>'+esc(selectorSummary)+'</small></summary><div class="ai-edge-forecast"><div><b>VÝHĽAD · 15 MIN</b>'+f15+'</div><div><b>VÝHĽAD · 25 MIN</b>'+f25+'</div></div></details>'+
      '<div class="ai-edge-note">'+esc(statText)+' · '+(fx.delta.ready?"nová aktivita za "+fx.delta.minutes.toFixed(1)+" min":"bez platného porovnania dvoch meraní")+' · štatistiky: '+(fx.age===null?"neznámy čas":Math.round(fx.age)+" min staré")+'</div></article>';
    }).join(""):'<p>Momentálne nie sú vo feede aktívne Flashscore zápasy.</p>';
    $("ai-edge-data-meta").innerHTML='<div><span>Zdroj</span><b>Flashscore LIVE · '+esc(data.data_status||"—")+'</b></div><div><span>História v LIVE feede</span><b>'+fmt(data.recent_history_count||history.length)+' snímok</b></div><div><span>Čerstvé štatistiky</span><b>'+fresh+' / '+records.length+'</b></div>';
    $("ai-edge-warning").textContent="Index tlaku je iba opis aktivity, nie pravdepodobnosť. AI EDGE SHADOW je experimentálna tieňová predikcia; každý horizont sa zobrazuje iba vtedy, keď prejde vlastnou validáciou a kalibračným filtrom. Zelené označenie znamená iba to, že ručne zadaný kurz dosahuje vypočítaný minimálny limit — nie potvrdenú stávkovú výhodu ani pokyn na podanie. Časové okno vychádza z päťminútového predpokladu oneskorenia.";
    $("ai-edge-updated").textContent="Feed: "+date(data.collected_at)+" · automatická obnova každých 60 s";
    $("ai-edge-audit-status").textContent="LIVE analytika · trvalá história · bez kurzov";
  }
  async function refresh(){
    const [feedResult,ledgerResult,modelResult,lateFtResult,simulationResult,topLedgerResult]=await Promise.allSettled([load(),loadLedger(),loadModel(),loadLateFTModel(),loadStrategy(),loadTopLedger()]);
    if(feedResult.status!=="fulfilled"){
      const s=$("ai-edge-state");if(s){s.className="ai-edge-state bad";s.textContent="LIVE DÁTA NEDOSTUPNÉ · "+(feedResult.reason?.message||"chyba LIVE feedu");}
      const panel=$("ai-edge-top-opportunities");if(panel)panel.innerHTML="<div style='font-size:13px;font-weight:900;color:#d7f2ff'>🎯 TOP LIVE PRÍLEŽITOSTI</div><div style='padding:10px;color:#f4d28d;font-size:11px'>LIVE feed sa nepodarilo načítať. Výber kandidátov je pozastavený, aby sa nezobrazovali neaktuálne údaje.</div>";
      return;
    }
    if(feedResult.value.source!=="Flashscore"){
      const s=$("ai-edge-state");if(s){s.className="ai-edge-state bad";s.textContent="LIVE DÁTA NEDOSTUPNÉ · Zdroj nie je Flashscore";}
      return;
    }
    const ledger=ledgerResult.status==="fulfilled"?ledgerResult.value:null;
    const model=modelResult.status==="fulfilled"?modelResult.value:null;
    const lateFtModel=lateFtResult.status==="fulfilled"?lateFtResult.value:null;
    const topLedger=topLedgerResult.status==="fulfilled"?topLedgerResult.value:null;
    try{render(feedResult.value,ledger,model,lateFtModel,topLedger);}catch(e){
      const panel=$("ai-edge-top-opportunities");if(panel)panel.innerHTML="<div style='font-size:13px;font-weight:900;color:#d7f2ff'>🎯 TOP LIVE PRÍLEŽITOSTI</div><div style='padding:10px;color:#f4d28d;font-size:11px'>Výber kandidátov sa nepodarilo spracovať: "+esc(e?.message||"neznáma chyba")+". Ostatné LIVE údaje zostávajú oddelené.</div>";
    }
    if(simulationResult.status==="fulfilled")runStrategySimulation(simulationResult.value);
    else {const out=$("ai-edge-strategy-results");if(out)out.textContent="Simulátor je momentálne nedostupný: "+(simulationResult.reason?.message||"chyba načítania")+". LIVE výber kandidátov funguje nezávisle.";}
    const warnings=[];
    if(ledgerResult.status!=="fulfilled")warnings.push("história predikcií: "+(ledgerResult.reason?.message||"nedostupná"));
    if(modelResult.status!=="fulfilled")warnings.push("model: "+(modelResult.reason?.message||"nedostupný"));
    if(lateFtResult.status!=="fulfilled")warnings.push("model gól do FT: "+(lateFtResult.reason?.message||"nedostupný"));
    if(topLedgerResult.status!=="fulfilled")warnings.push("TOP register: "+(topLedgerResult.reason?.message||"nedostupný"));
    if(warnings.length){const meta=$("ai-edge-updated");if(meta)meta.textContent+=" · "+warnings.join(" · ");}
  }
  document.addEventListener("DOMContentLoaded",()=>{document.addEventListener("input",event=>{const input=event.target.closest("[data-ai-edge-odds]");if(!input)return;const key=input.dataset.aiEdgeOdds;foundOdds.set(key,input.value);try{localStorage.setItem(ODDS_STORAGE_KEY,JSON.stringify(Object.fromEntries(foundOdds)));}catch{}const wrap=input.closest(".ai-edge-odds-check"),result=wrap?.querySelector(".ai-edge-odds-result");if(!result)return;const value=Number(input.value.replace(',','.')),minimum=Number(input.dataset.minOdds),conservative=Number(input.dataset.conservativeProbability),ev=input.value.trim()&&Number.isFinite(value)&&value>1&&Number.isFinite(conservative)?(value*conservative-1)*100:null,evOutput=wrap.querySelector("[data-ev-output]");if(evOutput){evOutput.textContent=ev===null?"Odhadované EV pri zadanom kurze: —":"Odhadované EV pri zadanom kurze: "+(ev>=0?"+":"")+ev.toFixed(1)+" % na vklad";evOutput.style.color=ev!==null&&value+1e-9>=minimum?"#39d98a":ev!==null&&ev>0?"#f4d27a":"#f08b8b";}if(!input.value.trim()){result.className="ai-edge-odds-result neutral";result.textContent="ČAKÁ NA TVOJ KURZ";}else if(!Number.isFinite(value)||value<=1){result.className="ai-edge-odds-result neutral";result.textContent="NEPLATNÝ KURZ";}else if(!Number.isFinite(minimum)||minimum<=1){result.className="ai-edge-odds-result neutral";result.textContent="MINIMÁLNY KURZ NIE JE DOSTUPNÝ";}else if(value+1e-9>=minimum){result.className="ai-edge-odds-result good";result.textContent="KURZ DOSAHUJE MINIMUM · EV+ ODHAD";}else if(ev!==null&&ev>0){result.className="ai-edge-odds-result neutral";result.textContent="EV KLADNÉ, ALE POD BEZPEČNÝM MINIMOM";}else{result.className="ai-edge-odds-result bad";result.textContent="KURZ POD MINIMOM · EV NIE JE KLADNÉ";}});$("ai-edge-sim-run")?.addEventListener("click",async()=>{try{runStrategySimulation(await loadStrategy());}catch(e){const out=$("ai-edge-strategy-results");if(out)out.textContent=e.message;}});refresh();window.setInterval(refresh,60000);});
})();
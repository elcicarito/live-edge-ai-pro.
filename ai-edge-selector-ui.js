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
    el.innerHTML="<div>Spustené "+esc(date(model.started_at))+" · oneskorenie započítané: 5 min · "+fmt(model.total_labeled_samples||0)+" označených LIVE vzoriek. "+esc(line)+" | "+esc(ftLine)+". Každý zápas má pri vyhodnotení rovnakú váhu. Predikciu model vynechá, ak kalibračný interval nemá aspoň "+fmt(model.calibration_policy?.min_effective_match_weight||8)+" efektívnych zápasov alebo odchýlka presahuje "+(Number(model.calibration_policy?.max_absolute_error??0.08)*100).toFixed(0)+" %. Staršie výsledky bez nových validačných pravidiel sa nepovažujú za potvrdenie modelu. Pravdepodobnosti sú tieňové a automaticky vyhodnocované; nejde o potvrdenú produkčnú ani stávkovú výhodu.</div>"+calibrationTables;
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
  function runStrategySimulation(data){const out=$("ai-edge-strategy-results");if(!out)return;const odds=Number($("ai-edge-sim-odds")?.value),bankroll=Number($("ai-edge-sim-bankroll")?.value),baseStake=Number($("ai-edge-sim-stake")?.value);if(![odds,bankroll,baseStake].every(Number.isFinite)||odds<=1||bankroll<=0||baseStake<=0){out.textContent="Zadaj kurz vyšší ako 1, kladný bankroll a kladný vklad.";return;}const all=data.predictions||[];const money=x=>x.toLocaleString("sk-SK",{minimumFractionDigits:2,maximumFractionDigits:2});const run=(rows,progressive,scenarioOdds=odds)=>{let balance=bankroll,peak=bankroll,drawdown=0,stake=baseStake,wins=0,losses=0,skippedOdds=0,duplicate=0,streak=0,maxStreak=0,staked=0;const used=new Set();const ordered=rows.slice().sort((a,b)=>Number(a.createdAt)-Number(b.createdAt));for(const row of ordered){if(scenarioOdds+1e-9<Number(row.minimumOdds)){skippedOdds++;continue;}const key=String(row.matchId||row.id||row.target+"|"+row.createdAt);if(used.has(key)){duplicate++;continue;}used.add(key);const wager=Math.min(balance,progressive?Math.min(stake,baseStake*5):baseStake);if(wager<=0)break;staked+=wager;if(row.status==="HIT"){balance+=wager*(scenarioOdds-1);wins++;streak=0;stake=baseStake;}else if(row.status==="MISS"){balance-=wager;losses++;streak++;maxStreak=Math.max(maxStreak,streak);if(progressive)stake=Math.min(baseStake*5,stake*1.5);}peak=Math.max(peak,balance);drawdown=Math.max(drawdown,peak-balance);}return{bets:wins+losses,wins,losses,skippedOdds,duplicate,net:balance-bankroll,end:balance,drawdown,maxStreak,staked,uniqueMatches:used.size};};const card=(name,x)=>"<div class='ai-edge-sim-result'><strong>"+name+"</strong><b>"+(x.net>=0?"+":"")+money(x.net)+" jednotiek</b><span>Konečný bankroll: "+money(x.end)+" · stávky: "+x.bets+" (HIT "+x.wins+" / MISS "+x.losses+")</span><span>Max. prepad od maxima: "+money(x.drawdown)+" · najdlhšia séria prehier: "+x.maxStreak+" · vsadené spolu: "+money(x.staked)+"</span></div>";const section=target=>{const rows=all.filter(r=>r.target===target&&(r.status==="HIT"||r.status==="MISS"));const flat=run(rows,false),step=run(rows,true);const oddsGrid=[2,2.25,2.5,2.75,3];const sensitivity="<div class='ai-edge-section-title'>CITLIVOSŤ NA HYPOTETICKÝ KURZ · ROVNÝ VKLAD</div><div class='ai-edge-sim-table-wrap'><table class='ai-edge-sim-table'><thead><tr><th>kurz</th><th>stávky</th><th>HIT / MISS</th><th>čistý výsledok</th><th>max. prepad</th></tr></thead><tbody>"+oddsGrid.map(q=>{const x=run(rows,false,q);return "<tr><td>"+money(q)+"</td><td>"+x.bets+"</td><td>"+x.wins+" / "+x.losses+"</td><td>"+(x.net>=0?"+":"")+money(x.net)+"</td><td>"+money(x.drawdown)+"</td></tr>";}).join("")+"</tbody></table></div>";return"<section class='ai-edge-sim-horizon'><div class='ai-edge-section-title'>"+(target==="MODEL_15"?"MODEL 15 MINÚT":target==="MODEL_25"?"MODEL 25 MINÚT":"MODEL GÓL DO KONCA ZÁPASU")+"</div><div class='ai-edge-sim-meta'>Vyhodnotené predikcie: "+fmt(rows.length)+" · unikátne zápasy: "+fmt(new Set(rows.map(r=>String(r.matchId||r.id||r.target+"|"+r.createdAt))).size)+" · stávky pri zadanom kurze: "+fmt(flat.bets)+" · vynechané pre minimálny kurz: "+fmt(flat.skippedOdds)+" · duplicitné merania: "+fmt(flat.duplicate)+"</div>"+card("ROVNÝ VKLAD",flat)+card("NAVÝŠENIE PO PREHRE · ×1,5 · LIMIT 5×",step)+sensitivity+"</section>";};out.innerHTML="<div class='ai-edge-sim-meta'>Spoločné nastavenie modelov · hypotetický kurz: "+money(odds)+" · počiatočný bankroll: "+money(bankroll)+" · základný vklad: "+money(baseStake)+" · dáta: "+esc(date(data.updated_at))+"</div>"+section("MODEL_15")+section("MODEL_25")+section("MODEL_FT")+"<p class='ai-edge-note'>Modely sa vyhodnocujú oddelene. V rámci každého modelu sa započíta najviac jedna stávka na jeden zápas; opakované merania toho istého zápasu sa nezapočítajú. Ten istý zápas môže byť samostatne vyhodnotený vo viacerých modeloch, preto výsledky sekcií nesčítavaj. Predikcie pod individuálnym minimálnym kurzom sa vynechávajú. Hypotetický rovnaký kurz, bez skutočných historických kurzov, poplatkov a sklzu; nejde o reálne ROI ani odporúčanie. OPEN a UNRESOLVED sú vylúčené.</p>";}

  async function loadLedger(){
    const url="https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./live-data-v2/data/ai-edge-prediction-live.json?t="+Date.now();
    const res=await fetch(url,{cache:"no-store",headers:{Accept:"application/json"}});
    if(res.status===404)return null;
    if(!res.ok)throw new Error("Predikčná história HTTP "+res.status);
    const data=await res.json();
    if(data.source!=="Flashscore"||data.mode!=="LIVE_PREDICTION_LEDGER_VIEW")throw new Error("Neplatný formát trvalej histórie");
    return data;
  }
  function renderTopOpportunities(data,ledger,model,lateFtModel,usable){
    const panel=$("ai-edge-top-opportunities");if(!panel)return;
    const title="<div style='font-size:13px;font-weight:900;letter-spacing:.6px;color:#d7f2ff'>🎯 TOP LIVE PRÍLEŽITOSTI</div>";
    const note="<div style='font-size:10px;color:#9bb1c7;line-height:1.45;margin:5px 0 9px'>Tento panel vyberá iba samostatne validovaný model GÓL DO KONCA ZÁPASU, pretože jeho predikcia sa mapuje na hranicu OVER podľa aktuálneho skóre. AI EDGE 25 zostáva oddelený: bez trhu na gól v nasledujúcich 25 minútach sa nesmie zamieňať za OVER do konca. Kurz zadávaš ručne; EV sa počíta konzervatívne po odpočítaní chyby kalibrácie.</div>";
    const liveAt=Date.parse(data.collected_at||"");
    const ledgerAt=Date.parse(ledger?.updated_at||"");
    const ftItem=lateFtModel?.model||{},ftCounts=ftItem.counts||{},ftMetrics=ftItem.metrics||{},ftPolicy=lateFtModel?.validation_policy||{};
    const readyFT=lateFtModel?.source==="Flashscore"&&lateFtModel?.mode==="FORWARD_ONLY_LIVE_TRAINING_LATE_FT"&&ftItem.status==="SHADOW_VALIDATED"&&Array.isArray(ftItem.weights)&&ftItem.weights.length===17&&Number(ftCounts.train)>=Math.max(500,Number(ftPolicy.min_train_samples)||500)&&Number(ftCounts.validation)>=Math.max(300,Number(ftPolicy.min_validation_samples)||300)&&Number(ftCounts.train_matches)>=Math.max(100,Number(ftPolicy.min_train_matches)||100)&&Number(ftCounts.validation_matches)>=Math.max(50,Number(ftPolicy.min_validation_matches)||50)&&Number(ftMetrics.relative_log_loss_gain)>=(Number(ftPolicy.min_relative_log_loss_gain)||0.01)&&Number(ftMetrics.relative_brier_gain)>=(Number(ftPolicy.min_relative_brier_gain)||0.005);
    if(!readyFT||!ledger||!Number.isFinite(liveAt)||Date.now()-liveAt>8*60000||!Number.isFinite(ledgerAt)||Date.now()-ledgerAt>6*60000){
      panel.innerHTML=title+note+"<div style='padding:10px;border:1px solid #40536a;border-radius:9px;color:#f4d28d;font-size:11px'>Zatiaľ nie je možné bezpečne vybrať kandidátov: čakám na čerstvé LIVE dáta, aktuálnu históriu a aspoň jeden samostatne validovaný model.</div>";
      return;
    }
    const live=new Map(usable.filter(x=>x.fx.ready).map(x=>[String(x.record.match?.id),x]));
    const latest=new Map();
    for(const row of ledger.predictions||[]){
      if(row.target!=="MODEL_FT"||row.status!=="OPEN"||row.modelStatus!=="SHADOW_VALIDATED"||!Number.isFinite(Number(row.modelProbability))||!Number.isFinite(Number(row.modelMinimumOdds)))continue;
      const id=String(row.matchId||"")+"|"+row.target;const previous=latest.get(id);
      if(!previous||Number(row.createdAt)>Number(previous.createdAt))latest.set(id,row);
    }
    const candidates=[];
    for(const [id,row] of latest){
      const current=live.get(String(row.matchId||""));if(!current)continue;
      const m=current.record.match||{},minute=Number.parseInt(m.live_minute,10);
      if(!Number.isFinite(minute)||minute<1||minute>100)continue;
      const deadline=Number(row.deadlineMinute),after=Number(row.actionableAfterMinute),rowAge=Date.now()-Date.parse(row.createdAt);
      if(!Number.isFinite(after)||!Number.isFinite(deadline)||deadline<=after||after>=100||minute>deadline)continue;
      if(!Number.isFinite(rowAge)||rowAge<0||rowAge>7*60000||minute>after+4)continue;
      const p=Number(row.modelProbability),error=Number(row.modelCalibrationError??0),conservative=Math.max(0.01,p-error);
      const m=current.record.match||{},market="OVER "+((Number(m.home_score)||0)+(Number(m.away_score)||0)+0.5).toFixed(1);
      const oddsKey=String(row.id||row.matchId+"|MODEL_FT")+"|"+market.replace(/\s+/g,"_"),entered=foundOdds.get(oddsKey)||"",enteredNum=Number(entered.replace(",",".")),ev=entered.trim()&&Number.isFinite(enteredNum)&&enteredNum>1?(enteredNum*conservative-1)*100:null;
      candidates.push({row,current,minute,conservative,after,deadline,target:row.target,market,oddsKey,entered,ev});
    }
    candidates.sort((a,b)=>(b.ev===null?-1:b.ev)-(a.ev===null?-1:a.ev)||b.conservative-a.conservative||Number(b.row.modelCalibrationMatchesWeight)-Number(a.row.modelCalibrationMatchesWeight));
    const top=candidates.slice(0,5);
    const cards=top.map((item,index)=>{
      const r=item.row,m=item.current.record.match||{},market=item.market,key=item.oddsKey,entered=item.entered;
      const p=Number(r.modelProbability),fair=1/p,min=Number(r.modelMinimumOdds),error=Number(r.modelCalibrationError??0),v=Number(entered.replace(",",".")),conservative=item.conservative,ev=entered.trim()&&Number.isFinite(v)&&v>1?(v*conservative-1)*100:null,oddsDisabled=item.minute<item.after?" disabled":"";
      const comparison=!entered.trim()?"<span class='ai-edge-odds-result neutral'>ČAKÁ NA TVOJ KURZ</span>":!Number.isFinite(v)||v<=1?"<span class='ai-edge-odds-result neutral'>NEPLATNÝ KURZ</span>":ev>=5?"<span class='ai-edge-odds-result good'>EV+ ≥ 5 % · SHADOW TEST</span>":ev>0?"<span class='ai-edge-odds-result neutral'>POZITÍVNE EV, ALE POD BEZPEČNOSTNÝM LIMITOM</span>":"<span class='ai-edge-odds-result bad'>BEZ PREUKÁZANEJ VÝHODY</span>";
      const timing=item.minute<item.after?"ČAKÁ NA OKNO od "+item.after+"′":"OKNO AKTÍVNE";
      return "<article class='ai-edge-match' style='border-color:#3b6578'><div class='ai-edge-match-head'><span>"+(index+1)+". "+esc(m.home)+" – "+esc(m.away)+"</span><span>"+esc(m.live_minute)+"′ · "+esc(m.home_score)+":"+esc(m.away_score)+"</span></div><div class='ai-edge-match-sub'>"+esc(m.competition||m.league||"")+" · <span style='color:#f5d47c;font-weight:900'>SHADOW · GÓL DO KONCA ZÁPASU</span> · "+timing+"</div><div style='font-size:11px;font-weight:900;color:#d7f2ff;margin-top:5px'>TRH: "+esc(market)+"</div><div class='ai-edge-model-numbers' style='margin-top:8px'><b>"+(p*100).toFixed(1)+" %</b><span>modelová pravdepodobnosť</span><b>"+(conservative*100).toFixed(1)+" %</b><span>konzervatívna pravdepodobnosť</span><b>"+fair.toFixed(2)+"</b><span>férový kurz</span><b>"+min.toFixed(2)+"</b><span>minimálny kurz pre EV +5 %</span></div><div class='ai-edge-model-time'>Zachytené: "+fmt(r.startMinute)+"′ pri skóre "+fmt(r.startHome)+":"+fmt(r.startAway)+" · "+esc(dateTime(r.createdAt))+" · rozhodovacie okno "+fmt(item.after)+"′–"+fmt(item.deadline)+"′</div><div class='ai-edge-odds-check'><label>MÔJ NÁJDENÝ KURZ<input type='number' min='1.01' step='0.01' inputmode='decimal' placeholder='napr. 2.10' value='"+esc(entered)+"' data-ai-edge-odds='"+esc(key)+"' data-min-odds='"+min+"'"+oddsDisabled+"></label>"+comparison+(ev===null?"":"<span class='ai-edge-model-time'>Konzervatívne očakávané ROI: "+(ev>=0?"+":"")+ev.toFixed(1)+" % na vklad</span>")+"</div><div class='ai-edge-model-foot'>Výpočet používa P − chyba kalibrácie a 5 % bezpečnostnú rezervu. Kalibračná vzorka: "+fmt(r.modelCalibrationMatchesWeight)+" vážených zápasov · chyba intervalu "+(error*100).toFixed(1)+" %. EV+ je zatiaľ tieňový kandidát; ziskovosť musí potvrdiť evidencia skutočných kurzov a vyhodnotených stávok.</div></article>";
    }).join("");
    panel.innerHTML=title+note+(cards||"<div style='padding:10px;border:1px solid #40536a;border-radius:9px;color:#c3d2e1;font-size:11px'>Momentálne nie je žiadny kandidát, ktorý súčasne spĺňa validáciu, čerstvosť dát a aktívne časové okno. Žiadny tip sa nebude vytvárať nasilu.</div>");
  }

  function render(data,ledger,model,lateFtModel){
    const records=(data.records||[]).filter(r=>r.match?.source==="Flashscore"&&r.match.status==="live");
    const history=data.recent_history||[];
    const usable=records.map(r=>({record:r,fx:features(r.match,history,r.collected_at||data.collected_at)}));
    const withStats=usable.filter(x=>x.fx.hasCore).length;
    const fresh=usable.filter(x=>x.fx.ready).length;
    renderPredictionLedger(ledger);
    renderModelStatus(model,lateFtModel);
    renderTopOpportunities(data,ledger,model,lateFtModel,usable);
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
      const modelRow15=(ledger?.predictions||[]).find(p=>p.matchId===String(m.id)&&p.target==="MODEL_15");const modelRow25=(ledger?.predictions||[]).find(p=>p.matchId===String(m.id)&&p.target==="MODEL_25");const modelLine=(row,h)=>{if(!row||!Number.isFinite(Number(row.modelProbability)))return "<span class='ai-edge-badge neutral'>BEZ PREDIKCIE</span><span>"+esc(horizonState(h))+"</span>";const p=Number(row.modelProbability),fair=p>0&&p<1?(1/p).toFixed(2):"—",minimum=Number.isFinite(Number(row.modelMinimumOdds))?Number(row.modelMinimumOdds):null,minText=minimum===null?"—":minimum.toFixed(2),key=String(row.id||row.matchId+"|MODEL_"+h),entered=foundOdds.get(key)||"",enteredNum=Number(entered.replace(',','.')),comparison=!entered.trim()?"<span class='ai-edge-odds-result neutral'>Zadaj kurz, ktorý si našiel</span>":!Number.isFinite(enteredNum)||enteredNum<=1?"<span class='ai-edge-odds-result neutral'>Neplatný kurz</span>":minimum===null?"<span class='ai-edge-odds-result neutral'>Minimálny kurz nie je dostupný</span>":enteredNum+1e-9>=minimum?"<span class='ai-edge-odds-result good'>LIMIT SPLNENÝ · SHADOW</span>":"<span class='ai-edge-odds-result bad'>POD MINIMÁLNYM KURZOM</span>",after=Number(row.actionableAfterMinute??(Number(row.startMinute)+5)),until=Number(row.deadlineMinute),window=Number.isFinite(after)&&Number.isFinite(until)?after+"′ – "+until+"′":"—";return "<div class='ai-edge-model-prediction'><span class='ai-edge-badge shadow'>SHADOW · TIEŇOVÁ PREDIKCIA</span><div class='ai-edge-model-numbers'><b>"+(p*100).toFixed(1)+" %</b><span>pravdepodobnosť</span><b>"+fair+"</b><span>férový kurz</span><b>"+minText+"</b><span>minimálny kurz</span></div><div class='ai-edge-model-time'>Vygenerované: "+esc(dateTime(row.createdAt))+" · pri minúte "+fmt(row.startMinute)+"′ · skóre "+fmt(row.startHome)+":"+fmt(row.startAway)+"</div><div class='ai-edge-model-time'>Časové okno podľa 5-minútového bufferu: <b>"+window+"</b> · rozhodovací okamih najskôr od "+(Number.isFinite(after)?after+"′":"—")+"</div><div class='ai-edge-odds-check'><label>MÔJ NÁJDENÝ KURZ<input type='number' min='1.01' step='0.01' inputmode='decimal' placeholder='napr. 2.10' value='"+esc(entered)+"' data-ai-edge-odds='"+esc(key)+"' data-min-odds='"+(minimum===null?"":minimum)+"'></label>"+comparison+"</div><div class='ai-edge-model-foot'>Záznam: "+(row.status==="OPEN"?"čaká na vyhodnotenie":esc(row.status))+" · výstup modelu nie je pokyn na stávku ani potvrdená produkčná výhoda.</div></div>";};const f15=modelLine(modelRow15,15);const f25=modelLine(modelRow25,25);
      const statText=["SOT "+(fx.values.sot?fx.values.sot.home+":"+fx.values.sot.away:"—"),"strely "+(fx.values.shots?fx.values.shots.home+":"+fx.values.shots.away:"—"),"rohy "+(fx.values.corners?fx.values.corners.home+":"+fx.values.corners.away:"—"),"xG "+(fx.values.xg?fx.values.xg.home.toFixed(2)+":"+fx.values.xg.away.toFixed(2):"—"),"xGOT "+(fx.values.xgot?fx.values.xgot.home.toFixed(2)+":"+fx.values.xgot.away.toFixed(2):"—"),"v šestnástke "+(fx.values.box?fx.values.box.home+":"+fx.values.box.away:"—")].join(" · ");
      return '<article class="ai-edge-match"><div class="ai-edge-match-head"><span>'+esc(m.home)+' – '+esc(m.away)+'</span><span>'+esc(minute)+'′ · '+esc(score)+'</span></div><div class="ai-edge-match-sub">'+esc(m.competition||"")+' · dominantný tlak: '+esc(top)+'</div>'+
      '<div class="ai-edge-teamrow"><span>'+esc(m.home)+' · '+h[0]+'</span><b>'+fx.home+'/100</b></div><div class="ai-edge-bar"><i style="width:'+fx.home+'%"></i></div>'+
      '<div class="ai-edge-teamrow"><span>'+esc(m.away)+' · '+a[0]+'</span><b>'+fx.away+'/100</b></div><div class="ai-edge-bar"><i style="width:'+fx.away+'%;background:#f59e0b"></i></div>'+
      '<div class="ai-edge-forecast"><div><b>VÝHĽAD · 15 MIN</b>'+f15+'</div><div><b>VÝHĽAD · 25 MIN</b>'+f25+'</div></div>'+
      '<div class="ai-edge-note">'+esc(statText)+' · '+(fx.delta.ready?"nová aktivita za "+fx.delta.minutes.toFixed(1)+" min":"bez platného porovnania dvoch meraní")+' · štatistiky: '+(fx.age===null?"neznámy čas":Math.round(fx.age)+" min staré")+'</div></article>';
    }).join(""):'<p>Momentálne nie sú vo feede aktívne Flashscore zápasy.</p>';
    $("ai-edge-data-meta").innerHTML='<div><span>Zdroj</span><b>Flashscore LIVE · '+esc(data.data_status||"—")+'</b></div><div><span>História v LIVE feede</span><b>'+fmt(data.recent_history_count||history.length)+' snímok</b></div><div><span>Čerstvé štatistiky</span><b>'+fresh+' / '+records.length+'</b></div>';
    $("ai-edge-warning").textContent="Index tlaku je iba opis aktivity, nie pravdepodobnosť. AI EDGE SHADOW je experimentálna tieňová predikcia; každý horizont sa zobrazuje iba vtedy, keď prejde vlastnou validáciou a kalibračným filtrom. Zelené označenie znamená iba to, že ručne zadaný kurz dosahuje vypočítaný minimálny limit — nie potvrdenú stávkovú výhodu ani pokyn na podanie. Časové okno vychádza z päťminútového predpokladu oneskorenia.";
    $("ai-edge-updated").textContent="Feed: "+date(data.collected_at)+" · automatická obnova každých 60 s";
    $("ai-edge-audit-status").textContent="LIVE analytika · trvalá história · bez kurzov";
  }
  async function refresh(){
    const [feedResult,ledgerResult,modelResult,lateFtResult,simulationResult]=await Promise.allSettled([load(),loadLedger(),loadModel(),loadLateFTModel(),loadStrategy()]);
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
    try{render(feedResult.value,ledger,model,lateFtModel);}catch(e){
      const panel=$("ai-edge-top-opportunities");if(panel)panel.innerHTML="<div style='font-size:13px;font-weight:900;color:#d7f2ff'>🎯 TOP LIVE PRÍLEŽITOSTI</div><div style='padding:10px;color:#f4d28d;font-size:11px'>Výber kandidátov sa nepodarilo spracovať: "+esc(e?.message||"neznáma chyba")+". Ostatné LIVE údaje zostávajú oddelené.</div>";
    }
    if(simulationResult.status==="fulfilled")runStrategySimulation(simulationResult.value);
    else {const out=$("ai-edge-strategy-results");if(out)out.textContent="Simulátor je momentálne nedostupný: "+(simulationResult.reason?.message||"chyba načítania")+". LIVE výber kandidátov funguje nezávisle.";}
    const warnings=[];
    if(ledgerResult.status!=="fulfilled")warnings.push("história predikcií: "+(ledgerResult.reason?.message||"nedostupná"));
    if(modelResult.status!=="fulfilled")warnings.push("model: "+(modelResult.reason?.message||"nedostupný"));
    if(lateFtResult.status!=="fulfilled")warnings.push("model gól do FT: "+(lateFtResult.reason?.message||"nedostupný"));
    if(warnings.length){const meta=$("ai-edge-updated");if(meta)meta.textContent+=" · "+warnings.join(" · ");}
  }
  document.addEventListener("DOMContentLoaded",()=>{document.addEventListener("input",event=>{const input=event.target.closest("[data-ai-edge-odds]");if(!input)return;const key=input.dataset.aiEdgeOdds;foundOdds.set(key,input.value);try{localStorage.setItem(ODDS_STORAGE_KEY,JSON.stringify(Object.fromEntries(foundOdds)));}catch{}const result=input.parentElement?.querySelector(".ai-edge-odds-result");if(!result)return;const value=Number(input.value.replace(',','.')),minimum=Number(input.dataset.minOdds);if(!input.value.trim()){result.className="ai-edge-odds-result neutral";result.textContent="Zadaj kurz, ktorý si našiel";}else if(!Number.isFinite(value)||value<=1){result.className="ai-edge-odds-result neutral";result.textContent="Neplatný kurz";}else if(!Number.isFinite(minimum)||minimum<=1){result.className="ai-edge-odds-result neutral";result.textContent="Minimálny kurz nie je dostupný";}else if(value+1e-9>=minimum){result.className="ai-edge-odds-result good";result.textContent="LIMIT SPLNENÝ · SHADOW";}else{result.className="ai-edge-odds-result bad";result.textContent="POD MINIMÁLNYM KURZOM";}});$("ai-edge-sim-run")?.addEventListener("click",async()=>{try{runStrategySimulation(await loadStrategy());}catch(e){const out=$("ai-edge-strategy-results");if(out)out.textContent=e.message;}});refresh();window.setInterval(refresh,60000);});
})();
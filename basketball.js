(() => {
  const DATA_URL = "./data/basketball-current.json";
  const ARCHIVE_URL = "./data/basketball-archive.json";
  const root = document.getElementById("basketball-view");
  const list = document.getElementById("basketball-matches");
  const meta = document.getElementById("basketball-meta");
  const archiveList = document.getElementById("basketball-archive");
  const archiveMeta = document.getElementById("basketball-archive-meta");
  const predictorMeta = document.getElementById("basketball-predictor-meta");
  const predictorList = document.getElementById("basketball-predictor-list");
  const performanceContent = document.getElementById("basketball-model-performance-content");
  const livePanel = document.getElementById("basketball-live-panel");
  const archivePanel = document.getElementById("basketball-archive-panel");
  const liveTab = document.getElementById("basketball-live-tab");
  const archiveTab = document.getElementById("basketball-archive-tab");
  function selectBasketballView(view) {
    const showArchive = view === "archive";
    if (livePanel) livePanel.style.display = showArchive ? "none" : "block";
    if (archivePanel) archivePanel.style.display = showArchive ? "block" : "none";
    if (liveTab) {
      liveTab.classList.toggle("active", !showArchive);
      liveTab.setAttribute("aria-pressed", String(!showArchive));
    }
    if (archiveTab) {
      archiveTab.classList.toggle("active", showArchive);
      archiveTab.setAttribute("aria-pressed", String(showArchive));
    }
  }
  liveTab?.addEventListener("click", () => selectBasketballView("live"));
  archiveTab?.addEventListener("click", () => selectBasketballView("archive"));
  if (!root || !list || !meta) return;

  const textOf = (...values) => {
    for (const value of values) {
      if (value === undefined || value === null || value === "") continue;
      if (typeof value === "object") {
        const nested = value.name || value.title || value.short_name;
        if (nested) return String(nested);
        continue;
      }
      return String(value);
    }
    return "";
  };
  const statusOf = match => {
    const status = match?.status;
    if (typeof status === "string") return status;
    if (status && typeof status === "object") return status.type || status.name || status.short || status.description || "";
    return match?.status_text || match?.statusText || "";
  };
  const isLive = match => {
    const s = String(statusOf(match)).toLowerCase().replace(/[\s_-]+/g, "");
    return ["live","inplay","inprogress","playing","q1","q2","q3","q4","ot","overtime","halftime","break","period1","period2","period3","period4"].includes(s) || s.includes("inprogress") || s.includes("live");
  };
  const teamName = (match, side) => {
    const team = match?.teams?.[side] || match?.[side + "_team"] || match?.[side + "Team"];
    return textOf(team?.name, team?.short_name, typeof team === "string" ? team : null, match?.[side], match?.[side + "_name"]) || (side === "home" ? "Domáci" : "Hostia");
  };
  const scoreOf = (match, side) => {
    const score = match?.score || match?.scores || {};
    const teamScore = score?.[side];
    return textOf(typeof teamScore === "object" ? teamScore.current ?? teamScore.total ?? teamScore.points : teamScore, match?.[side + "_score"], match?.[side + "Score"], match?.[side + "_points"]) || "–";
  };
  const leagueOf = m => textOf(m?.competition?.name, m?.league?.name, m?.tournament?.name, m?.competition, m?.league);
  const formatOf = m => {
    const league = leagueOf(m).toLowerCase();
    const teams = [teamName(m, "home"), teamName(m, "away")].join(" ").toLowerCase();
    const ncaa = /ncaa|national collegiate athletic association/.test(league);
    const women = /women|woman|ladies|lady|female|wbb/.test(league) || /women|lady|ladies/.test(teams);
    return ncaa && !women ? "halves" : "quarters";
  };
  const periodCount = m => formatOf(m) === "halves" ? 2 : 4;
  const periodLabel = (m, i) => formatOf(m) === "halves"
    ? (i < 2 ? "H" + (i + 1) : "OT" + (i - 1))
    : (i < 4 ? "Q" + (i + 1) : "OT" + (i - 3));
  const periodStatusLabel = match => {
    const raw = textOf(match?.status_text, match?.period?.name, match?.period, match?.quarter, match?.period_name, match?.clock, match?.time_remaining);
    if (formatOf(match) !== "halves") return raw;
    if (/half.?time|halftime|break/i.test(raw)) return "Prestávka · polčas";
    const m = raw.match(/([1-2])(?:st|nd)?\s*(?:quarter|period|q)/i);
    return m ? (Number(m[1]) === 1 ? "1. polčas" : "2. polčas") : raw;
  };
  const flagOf = league => {
    const s = String(league || "").toLowerCase();
    if (/ncaa|national collegiate|usa|united states|nba|wnba/.test(s)) return "🇺🇸";
    if (/iceland|island/.test(s)) return "🇮🇸";
    if (/poland|poľ|polska/.test(s)) return "🇵🇱";
    if (/lithuania|lietuv/.test(s)) return "🇱🇹";
    if (/lebanon|liban/.test(s)) return "🇱🇧";
    if (/spain|acb|liga endesa/.test(s)) return "🇪🇸";
    if (/germany|bundesliga|bbl/.test(s)) return "🇩🇪";
    if (/france|lnb|pro a/.test(s)) return "🇫🇷";
    if (/italy|lega basket|serie a/.test(s)) return "🇮🇹";
    if (/turkey|türkiye|bsl/.test(s)) return "🇹🇷";
    if (/greece|greek/.test(s)) return "🇬🇷";
    if (/israel|israeli/.test(s)) return "🇮🇱";
    if (/euroleague|eurocup|fiba|champions league/.test(s)) return "🌍";
    return "🌐";
  };
  const periodValues = (match, side) => {
    const score = match?.score || match?.scores || {};
    const sideScore = score?.[side] && typeof score[side] === "object" ? score[side] : {};
    const periods = match?.periods?.[side] || match?.period_scores?.[side] || match?.[side + "_period_scores"] || match?.[side + "_quarters"];
    if (Array.isArray(periods)) return periods.slice(0, periodCount(match)).map(v => v === null || v === undefined ? "–" : (typeof v === "object" ? (v.score ?? v.points ?? v.value ?? "–") : v));
    const keys = ["period1","period2","period3","period4","overtime1","overtime2","q1","q2","q3","q4","quarter1","quarter2","quarter3","quarter4"];
    const vals = keys.map(k => sideScore[k] ?? score?.[side + "_" + k] ?? match?.[side + "_" + k]);
    const firstFour = vals.slice(0,4);
    if (firstFour.some(v => v !== undefined && v !== null)) {
      const out = firstFour.map(v => v ?? "–");
      vals.slice(4).forEach(v => { if (v !== undefined && v !== null) out.push(v); });
      return out.slice(0, periodCount(match));
    }
    return [];
  };
  const dateOf = m => {
    const raw = m?.time || m?.date || m?.start_time || m?.kickoff;
    const d = raw ? new Date(raw) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleString("sk-SK") : "Dátum neznámy";
  };
  function addQuarterTable(card, match) {
    const home = periodValues(match, "home");
    const away = periodValues(match, "away");
    const wrap = document.createElement("div");
    wrap.style.cssText = "overflow-x:auto;margin-top:12px";
    if (!home.length && !away.length) {
      wrap.textContent = "Štvrtinové skóre: zdroj zatiaľ neposkytol rozpis bodov po štvrtinách.";
      wrap.style.cssText += ";font-size:12px;color:#9baabe";
      card.appendChild(wrap);
      return;
    }
    const count = Math.max(home.length, away.length, periodCount(match));
    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;text-align:center;font-size:12px";
    const head = document.createElement("tr");
    ["Tím", ...Array.from({length:count},(_,i)=>periodLabel(match,i)), "Spolu"].forEach(label => {
      const th = document.createElement("th"); th.textContent = label; th.style.cssText = "padding:6px;border-bottom:1px solid #35465e;color:#9fb2c9"; head.appendChild(th);
    });
    table.appendChild(head);
    [[teamName(match,"home"),home,scoreOf(match,"home")],[teamName(match,"away"),away,scoreOf(match,"away")]].forEach(([name,vals,total]) => {
      const tr = document.createElement("tr");
      [name,...Array.from({length:count},(_,i)=>vals[i] ?? "–"),total].forEach((v,i) => {
        const td=document.createElement("td"); td.textContent=String(v); td.style.cssText="padding:6px;border-bottom:1px solid #263b55;white-space:nowrap"; if(i===0) td.style.textAlign="left"; tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    wrap.appendChild(table); card.appendChild(wrap);
  }
  function makeCard(match, archived=false) {
    const card=document.createElement("div");
    card.style.cssText="background:#101b2b;border:1px solid #2d435c;border-radius:12px;padding:14px;margin:10px 0";
    const league=leagueOf(match);
    const header=document.createElement("div");
    header.style.cssText="color:#39e6a5;font-size:12px;font-weight:bold;margin-bottom:10px";
    header.textContent=flagOf(league)+" "+(league||"Liga neznáma")+" · "+(archived?"UKONČENÝ ZÁPAS":textOf(statusOf(match),"LIVE"))+" · "+(archived?dateOf(match):periodStatusLabel(match));
    const row=document.createElement("div");
    row.style.cssText="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;margin:6px 0";
    const names=document.createElement("div"); names.style.cssText="font-weight:700;line-height:1.5;white-space:pre-line"; names.textContent=teamName(match,"home")+"\n"+teamName(match,"away");
    const scores=document.createElement("div"); scores.style.cssText="font-size:20px;font-weight:800;text-align:right;line-height:1.5;font-variant-numeric:tabular-nums;white-space:pre-line"; scores.textContent=scoreOf(match,"home")+"\n"+scoreOf(match,"away");
    row.append(names,scores); card.append(header,row); addQuarterTable(card,match); return card;
  }
  function renderArchiveQuality(matches, target, leagueName) {
    const total=matches.length;
    const halves=matches.length>0&&matches.every(match=>formatOf(match)==="halves");
    let complete=0,partial=0,missing=0,waiting=0;
    matches.forEach(match=>{
      const home=periodValues(match,"home"),away=periodValues(match,"away");
      const valid=Array.from({length:periodCount(match)},(_,i)=>i).filter(q=>{
        const h=Number(home[q]),a=Number(away[q]);
        return home[q]!==undefined&&home[q]!==null&&home[q]!=="–"&&away[q]!==undefined&&away[q]!==null&&away[q]!=="–"&&Number.isFinite(h)&&Number.isFinite(a)&&h+a>0;
      }).length;
      if(valid===periodCount(match))complete++;else if(valid>0)partial++;else{
        missing++;const checked=Date.parse(match.quarter_scores_checked_at||"");
        if(Number.isFinite(checked)&&Date.now()-checked<6*60*60*1000)waiting++;
      }
    });
    const panel=document.createElement("section");panel.style.cssText="background:#132238;border:1px solid #354d69;border-radius:12px;padding:14px;margin:8px 0 12px";
    const title=document.createElement("div");title.textContent="🔎 KVALITA DÁT – "+leagueName;title.style.cssText="font-weight:800;font-size:13px;margin-bottom:10px;color:#e7f0fb";panel.appendChild(title);
    const grid=document.createElement("div");grid.style.cssText="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px";
    const periodText=halves?"H1–H2":"Q1–Q4";
    [["Kompletné "+periodText,complete,"#39e6a5"],["Čiastočné údaje",partial,"#f2c66d"],["Bez platných údajov",missing,"#ff9b83"],["Čakajú na opätovnú kontrolu",waiting,"#9fb2c9"]].forEach(([label,value,color])=>{
      const cell=document.createElement("div");cell.style.cssText="background:#0d1929;border-radius:8px;padding:10px;min-width:0";
      const name=document.createElement("div");name.textContent=label;name.style.cssText="font-size:11px;color:#a9bdd4;line-height:1.35";
      const number=document.createElement("div");number.textContent=String(value);number.style.cssText="font-size:20px;font-weight:800;margin-top:5px;color:"+color;
      cell.append(name,number);grid.appendChild(cell);
    });
    panel.appendChild(grid);
    const pct=total?(complete/total*100).toFixed(1):"0.0";
    const note=document.createElement("div");note.textContent="Zápasov v lige: "+total+" · Kompletné "+periodText+": "+pct+"%. Mužské NCAA sa vyhodnocuje ako dva polčasy; neexistujúce Q3/Q4 sa nepovažujú za chýbajúce údaje.";
    note.style.cssText="font-size:11px;color:#9baabe;margin-top:9px;line-height:1.45";panel.appendChild(note);(target||archiveList).appendChild(panel);
  }
  function renderArchiveStats(matches,target=archiveList,titleText="📊 ŠTATISTIKY OBDOBÍ V ARCHÍVE",panelId="basketball-quarter-stats"){
    const existing=panelId?document.getElementById(panelId):null;if(existing)existing.remove();
    const halves=matches.length>0&&matches.every(match=>formatOf(match)==="halves"),nPeriods=halves?2:4;
    const stats=Array.from({length:nPeriods},(_,q)=>{
      const totals=matches.map(match=>{
        if(q>=periodCount(match))return null;
        const home=periodValues(match,"home")[q],away=periodValues(match,"away")[q];
        if(home===undefined||away===undefined||home===null||away===null||home==="–"||away==="–")return null;
        const h=Number(home),a=Number(away),total=h+a;
        return Number.isFinite(h)&&Number.isFinite(a)&&total>0?total:null;
      }).filter(v=>v!==null);
      return {label:halves?"H"+(q+1):"Q"+(q+1),count:totals.length,average:totals.length?totals.reduce((sum,v)=>sum+v,0)/totals.length:null};
    });
    const available=stats.filter(x=>x.count>0);if(!available.length)return;
    const best=available.reduce((top,item)=>item.average>top.average?item:top);
    const panel=document.createElement("section");if(panelId)panel.id=panelId;
    panel.style.cssText="background:#132238;border:1px solid #354d69;border-radius:12px;padding:14px;margin:12px 0 16px";
    const title=document.createElement("div");title.textContent=titleText;title.style.cssText="font-weight:800;font-size:13px;margin-bottom:10px;color:#e7f0fb";panel.appendChild(title);
    const grid=document.createElement("div");grid.style.cssText="display:grid;grid-template-columns:repeat("+nPeriods+",minmax(0,1fr));gap:7px";
    stats.forEach(item=>{
      const cell=document.createElement("div");cell.style.cssText="background:#0d1929;border-radius:8px;padding:9px 5px;text-align:center;min-width:0";
      const q=document.createElement("div");q.textContent=item.label;q.style.cssText="font-size:12px;color:#a9bdd4;font-weight:700";
      const avg=document.createElement("div");avg.textContent=item.average===null?"–":item.average.toFixed(1);avg.style.cssText="font-size:18px;font-weight:800;margin:4px 0;color:#fff";
      const n=document.createElement("div");n.textContent="n="+item.count;n.style.cssText="font-size:10px;color:#9baabe";
      cell.append(q,avg,n);grid.appendChild(cell);
    });
    panel.appendChild(grid);
    const note=document.createElement("div");note.textContent="Priemer celkového počtu bodov oboch tímov v jednom "+(halves?"polčase":"štvrtine")+"; n = počet zápasov s platným skóre. Mužské NCAA používa H1/H2, ženské NCAA zostáva v Q1–Q4.";
    note.style.cssText="font-size:11px;color:#9baabe;margin-top:9px;line-height:1.4";panel.appendChild(note);
    const leader=document.createElement("div");leader.textContent="Najviac bodov v priemere: "+best.label+" ("+best.average.toFixed(1)+" bodu; n="+best.count+").";
    leader.style.cssText="font-size:12px;color:#39e6a5;font-weight:700;margin-top:7px";panel.appendChild(leader);target.appendChild(panel);
  }
  function render(data) {
    if (!data || data.sport !== "basketball") { meta.textContent="Basketbalové dáta zatiaľ nie sú dostupné."; list.textContent="Zatiaľ sa nepodarilo načítať prvý zber."; return; }
    const collected=Date.parse(data.collected_at||"");
    const age=Number.isFinite(collected)?Math.max(0,Math.round((Date.now()-collected)/1000)):null;
    const all=Array.isArray(data.matches)?data.matches:[];
    const live=Array.isArray(data.live_matches)?data.live_matches:all.filter(isLive);
    const ageText=age===null?"neznámy":age<60?age+" s":Math.floor(age/60)+" min";
    meta.textContent="Zdroj: SportScore · Posledný zber: "+(data.collected_at?new Date(data.collected_at).toLocaleString("sk-SK"):"neznámy")+" · Vek dát: "+ageText+" · LIVE: "+live.length+" · Záznamy API: "+Number(data.fixture_count??all.length);
    list.replaceChildren();
    if (!live.length) { const p=document.createElement("p"); p.textContent="Momentálne nie je dostupný žiadny LIVE basketbalový zápas."; list.appendChild(p); return; }
    live.forEach(m=>list.appendChild(makeCard(m,false)));
  }
  async function loadArchive() {
    if (!archiveList || !archiveMeta) return;
    try {
      const r=await fetch(ARCHIVE_URL+"?t="+Date.now(),{cache:"no-store"});
      if (!r.ok) throw new Error("HTTP "+r.status);
      const data=await r.json(); const matches=Array.isArray(data.matches)?data.matches:[];
      archiveMeta.textContent="Uložené ukončené zápasy: "+matches.length+" · Aktualizácia: "+(data.updated_at?new Date(data.updated_at).toLocaleString("sk-SK"):"čaká sa");
      archiveList.replaceChildren();
      if (!matches.length) { archiveList.textContent="Archív sa naplní po načítaní prvých ukončených zápasov."; return; }
      const groups = new Map();
      matches.forEach(match => {
        const league = leagueOf(match).trim() || "Liga neznáma";
        if (!groups.has(league)) groups.set(league, []);
        groups.get(league).push(match);
      });
      const sortedGroups = [...groups.entries()].sort((a,b) => {
        if (a[0] === "Liga neznáma") return 1;
        if (b[0] === "Liga neznáma") return -1;
        return a[0].localeCompare(b[0], "sk");
      });
      sortedGroups.forEach(([league, leagueMatches], index) => {
        const section = document.createElement("details");
        section.open = index === 0;
        section.style.cssText = "background:#132238;border:1px solid #354d69;border-radius:12px;padding:0 12px;margin:12px 0";
        const summary = document.createElement("summary");
        summary.style.cssText = "cursor:pointer;list-style:none;padding:14px 2px;font-weight:800;color:#e7f0fb;display:flex;align-items:center;justify-content:space-between;gap:10px";
        const label = document.createElement("span");
        label.textContent = flagOf(league) + " " + league;
        const count = document.createElement("span");
        count.textContent = leagueMatches.length + (leagueMatches.length === 1 ? " zápas" : leagueMatches.length < 5 ? " zápasy" : " zápasov");
        count.style.cssText = "font-size:11px;font-weight:600;color:#9fb2c9;white-space:nowrap";
        summary.append(label, count);
        section.appendChild(summary);
        const body = document.createElement("div");
        body.style.cssText = "padding:0 0 8px";
        renderArchiveQuality(leagueMatches, body, league);
        renderArchiveStats(leagueMatches, body, "📊 ŠTATISTIKY ŠTVRTÍ – " + league, null);
        leagueMatches.forEach(match => body.appendChild(makeCard(match,true)));
        section.appendChild(body);
        archiveList.appendChild(section);
      });
    } catch(e) { archiveMeta.textContent="Archív zatiaľ čaká na prvý úspešný zber."; archiveList.textContent="Archív sa nepodarilo načítať: "+e.message; }
  }
  function renderModelPerformance(archiveData, rows, settled) {
    if (!performanceContent) return;
    performanceContent.replaceChildren();
    const matches = Array.isArray(archiveData?.matches) ? archiveData.matches : [];
    const completeMatches = matches.filter(m => Array.from({length:periodCount(m)},(_,i)=>i).every(q => {
      const h=m?.period_scores?.home?.[q],a=m?.period_scores?.away?.[q];
      return h!==null&&h!==undefined&&a!==null&&a!==undefined&&Number.isFinite(Number(h))&&Number.isFinite(Number(a))&&Number(h)+Number(a)>0;
    }));
    const leagueCounts = new Map();
    completeMatches.forEach(m => {
      const league = leagueOf(m).trim() || "Liga neznáma";
      leagueCounts.set(league, (leagueCounts.get(league) || 0) + 1);
    });
    const eligibleLeagues = [...leagueCounts.values()].filter(n => n >= 10).length;
    const mae = settled.length ? settled.reduce((sum,p) => sum + Number(p.absolute_error),0) / settled.length : null;
    const covered = settled.filter(p => Number.isFinite(Number(p.actual_total)) &&
      Number.isFinite(Number(p.range_low)) && Number.isFinite(Number(p.range_high)) &&
      Number(p.actual_total) >= Number(p.range_low) && Number(p.actual_total) <= Number(p.range_high)).length;
    const coverage = settled.length ? covered / settled.length * 100 : null;
    const metrics = [
      ["Kompletné zápasy podľa formátu", completeMatches.length],
      ["Ligy s min. 10 zápasmi", eligibleLeagues],
      ["Vyhodnotené predikcie", settled.length],
      ["Priemerná absolútna chyba", mae === null ? "—" : mae.toFixed(1) + " b."]
    ];
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0";
    metrics.forEach(([label,value]) => {
      const cell=document.createElement("div");
      cell.style.cssText="background:#0d1929;border:1px solid #263b55;border-radius:9px;padding:11px";
      const v=document.createElement("div"); v.textContent=String(value);
      v.style.cssText="font-size:20px;font-weight:900;color:#39e6a5";
      const l=document.createElement("div"); l.textContent=label;
      l.style.cssText="font-size:10px;color:#a9bdd4;margin-top:5px;line-height:1.35";
      cell.append(v,l); grid.appendChild(cell);
    });
    performanceContent.appendChild(grid);
    const coverageNote=document.createElement("p");
    coverageNote.textContent="Pokrytie rozpätia ±5 bodov: "+(coverage===null?"zatiaľ bez vzorky":coverage.toFixed(1)+" % ("+covered+"/"+settled.length+")")+".";
    coverageNote.style.cssText="font-size:12px;color:#d7e3f1;margin:8px 0";
    performanceContent.appendChild(coverageNote);
    const qTitle=document.createElement("div");
    qTitle.textContent="PRESNOSŤ PODĽA OBDOBIA";
    qTitle.style.cssText="font-size:11px;font-weight:900;color:#39e6a5;margin:15px 0 7px";
    performanceContent.appendChild(qTitle);
    [1,2,3,4].forEach(q => {
      const group=settled.filter(p=>Number(p.target_quarter)===q && p.model_version===3);
      const qMae=group.length?group.reduce((sum,p)=>sum+Number(p.absolute_error),0)/group.length:null;
      const row=document.createElement("div");
      row.style.cssText="display:flex;justify-content:space-between;gap:10px;padding:8px 2px;border-bottom:1px solid #263b55;font-size:11px";
      const left=document.createElement("span"); left.textContent="Q"+q;
      const right=document.createElement("strong"); right.textContent=group.length?(qMae.toFixed(1)+" b. · n="+group.length):"Čaká sa na výsledky";
      right.style.color=group.length>=10?"#39e6a5":"#a9bdd4";
      row.append(left,right); performanceContent.appendChild(row);
    });
    const halfGroup=settled.filter(p=>p.model_version===4&&Number(p.target_half)===2);
    const halfRow=document.createElement("div");halfRow.style.cssText="display:flex;justify-content:space-between;gap:10px;padding:8px 2px;border-bottom:1px solid #263b55;font-size:11px";
    const halfLabel=document.createElement("span");halfLabel.textContent="H2 · mužské NCAA";
    const halfValue=document.createElement("strong");halfValue.textContent=halfGroup.length?(halfGroup.reduce((sum,p)=>sum+Number(p.absolute_error),0)/halfGroup.length).toFixed(1)+" b. · n="+halfGroup.length:"Čaká sa na výsledky";
    halfValue.style.color=halfGroup.length>=10?"#39e6a5":"#a9bdd4";halfRow.append(halfLabel,halfValue);performanceContent.appendChild(halfRow);
    const leagueTitle=document.createElement("div");
    leagueTitle.textContent="HISTORICKÁ VZORKA PODĽA LÍG";
    leagueTitle.style.cssText="font-size:11px;font-weight:900;color:#39e6a5;margin:15px 0 7px";
    performanceContent.appendChild(leagueTitle);
    [...leagueCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).forEach(([league,count])=>{
      const row=document.createElement("div");
      row.style.cssText="display:flex;justify-content:space-between;gap:10px;padding:7px 2px;border-bottom:1px solid #263b55;font-size:11px";
      const name=document.createElement("span"); name.textContent=league; name.style.cssText="color:#c8d5e5;min-width:0";
      const n=document.createElement("strong"); n.textContent="n="+count+(count>=10?" · vhodná na LIVE tréning":" · malá vzorka");
      n.style.cssText="white-space:nowrap;color:"+(count>=10?"#39e6a5":"#f2c66d");
      row.append(name,n); performanceContent.appendChild(row);
    });
    const note=document.createElement("p");
    note.textContent="Model v3 zostáva nezmenený. MAE a pokrytie rozpätia sa počítajú iba zo skutočne vyhodnotených LIVE predikcií. Historický archív slúži na kontrolu dostupnosti dát; zatiaľ z neho nevyvodzujeme víťaza medzi alternatívnymi modelmi. Pri malej vzorke sú výsledky iba orientačné.";
    note.style.cssText="font-size:10px;color:#8296ad;line-height:1.5;margin-top:12px";
    performanceContent.appendChild(note);
  }
  async function loadPredictions() {
    if (!predictorMeta || !predictorList) return;
    try {
      const [response, archiveResponse] = await Promise.all([
        fetch("./data/basketball-predictions.json?t=" + Date.now(), { cache: "no-store" }),
        fetch(ARCHIVE_URL + "?t=" + Date.now(), { cache: "no-store" })
      ]);
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      const archiveData = archiveResponse.ok ? await archiveResponse.json() : { matches: [] };
      const rows = Array.isArray(data.predictions) ? data.predictions : [];
      const open = rows.filter(p => p.actual_total === null || p.actual_total === undefined)
        .sort((a,b) => String(b.observed_at).localeCompare(String(a.observed_at)));
      const settled = rows.filter(p => p.absolute_error !== null && p.absolute_error !== undefined &&
        Number.isFinite(Number(p.absolute_error)))
        .sort((a,b) => String(b.settled_at).localeCompare(String(a.settled_at)));
      const mae = settled.length ? settled.reduce((sum,p) => sum + Number(p.absolute_error),0) / settled.length : null;
      renderModelPerformance(archiveData, rows, settled);
      predictorMeta.textContent = "Predikcie sú oddelené od ligových štatistík · História iba z rovnakej ligy · Vyhodnotené predikcie: " + settled.length + (mae === null ? "" : " · Priemerná odchýlka: " + mae.toFixed(1) + " bodu");
      predictorList.replaceChildren();
      if (!rows.length) {
        predictorList.textContent = "Zatiaľ čakáme na vhodné LIVE zápasy a dostatočný počet kompletných historických zápasov.";
        return;
      }
      const heading = document.createElement("div");
      heading.textContent = "AKTUÁLNE ODHADY";
      heading.style.cssText = "font-size:12px;font-weight:800;color:#39e6a5;margin:12px 0 7px";
      predictorList.appendChild(heading);
      if (!open.length) {
        const empty = document.createElement("p"); empty.textContent = "Zatiaľ nie je dostupná predikcia. Vytvorí sa až pri LIVE zápase od Q2 do Q4, keď má daná liga aspoň 10 vlastných dokončených historických zápasov. Dáta z iných líg sa nepoužívajú."; predictorList.appendChild(empty);
      }
      open.slice(0,8).forEach(p => {
        const card = document.createElement("div");
        card.style.cssText = "background:#0d1929;border:1px solid #354d69;border-radius:9px;padding:11px;margin:8px 0";
        const name = document.createElement("div");
        name.textContent = (p.league || "Liga neznáma") + " · " + p.home + " – " + p.away + " · " + (p.model_version===4?"H"+p.target_half:"Q"+p.target_quarter);
        name.style.cssText = "font-size:12px;color:#a9bdd4;line-height:1.4";
        const value = document.createElement("div");
        value.textContent = p.predicted_total + " bodov";
        value.style.cssText = "font-size:23px;font-weight:900;color:#fff;margin:5px 0";
        const range = document.createElement("div");
        range.textContent = "Orientačné rozpätie " + p.range_low + "–" + p.range_high + " bodov · vzorka n=" + p.training_sample + " (iba rovnaká liga)";
        range.style.cssText = "font-size:11px;color:#9baabe;line-height:1.4";
        const note = document.createElement("div");
        note.textContent = "Odhad sa počíta iba z ukončených predchádzajúcich štvrtín. Zber môže meškať približne 5 minút.";
        note.style.cssText = "font-size:10px;color:#8296ad;margin-top:5px";
        card.append(name,value,range,note);
        predictorList.appendChild(card);
      });
      if (settled.length) {
        const resultsTitle = document.createElement("div");
        resultsTitle.textContent = "POSLEDNÉ VYHODNOTENIA";
        resultsTitle.style.cssText = "font-size:12px;font-weight:800;color:#39e6a5;margin:15px 0 7px";
        predictorList.appendChild(resultsTitle);
        settled.slice(0,8).forEach(p => {
          const row = document.createElement("div");
          row.style.cssText = "display:flex;justify-content:space-between;gap:10px;padding:8px 2px;border-bottom:1px solid #263b55;font-size:11px";
          const label = document.createElement("span");
          label.textContent = p.home + " – " + p.away + " · " + (p.model_version===4?"H"+p.target_half:"Q"+p.target_quarter);
          const result = document.createElement("strong");
          result.textContent = "Odhad " + p.predicted_total + " / skutočnosť " + p.actual_total + " · ±" + p.absolute_error;
          result.style.color = p.absolute_error <= 5 ? "#39e6a5" : "#f2c66d";
          row.append(label,result); predictorList.appendChild(row);
        });
      }
    } catch (error) {
      predictorMeta.textContent = "Prediktor čaká na prvý úspešný výpočet.";
      predictorList.textContent = "Výsledky prediktora zatiaľ nie sú dostupné: " + error.message;
    }
  }
  async function load() {
    try { const r=await fetch(DATA_URL+"?t="+Date.now(),{cache:"no-store"}); if(!r.ok) throw new Error("HTTP "+r.status); render(await r.json()); }
    catch(e) { meta.textContent="Basketbalové dáta sa nepodarilo načítať."; list.textContent="Chyba načítania: "+e.message; }
  }
  load(); loadArchive(); loadPredictions(); setInterval(load,10000); setInterval(loadArchive,60000); setInterval(loadPredictions,30000);
})();
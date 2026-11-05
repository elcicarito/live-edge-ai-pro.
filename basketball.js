(() => {
  const DATA_URL = "./data/basketball-current.json";
  const ARCHIVE_URL = "./data/basketball-archive.json";
  const root = document.getElementById("basketball-view");
  const list = document.getElementById("basketball-matches");
  const meta = document.getElementById("basketball-meta");
  const archiveList = document.getElementById("basketball-archive");
  const archiveMeta = document.getElementById("basketball-archive-meta");
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
    if (Array.isArray(periods)) return periods.map(v => typeof v === "object" ? (v.score ?? v.points ?? v.value ?? "–") : v);
    const keys = ["period1","period2","period3","period4","overtime1","overtime2","q1","q2","q3","q4","quarter1","quarter2","quarter3","quarter4"];
    const vals = keys.map(k => sideScore[k] ?? score?.[side + "_" + k] ?? match?.[side + "_" + k]);
    const firstFour = vals.slice(0,4);
    if (firstFour.some(v => v !== undefined && v !== null)) {
      const out = firstFour.map(v => v ?? "–");
      vals.slice(4).forEach(v => { if (v !== undefined && v !== null) out.push(v); });
      return out;
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
    const count = Math.max(home.length, away.length, 4);
    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;text-align:center;font-size:12px";
    const head = document.createElement("tr");
    ["Tím", ...Array.from({length:count},(_,i)=>i<4?"Q"+(i+1):"OT"+(i-3)), "Spolu"].forEach(label => {
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
    header.textContent=flagOf(league)+" "+(league||"Liga neznáma")+" · "+(archived?"UKONČENÝ ZÁPAS":textOf(statusOf(match),"LIVE"))+" · "+(archived?dateOf(match):textOf(match?.status_text,match?.period?.name,match?.period,match?.quarter,match?.period_name,match?.clock,match?.time_remaining));
    const row=document.createElement("div");
    row.style.cssText="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;margin:6px 0";
    const names=document.createElement("div"); names.style.cssText="font-weight:700;line-height:1.5;white-space:pre-line"; names.textContent=teamName(match,"home")+"\n"+teamName(match,"away");
    const scores=document.createElement("div"); scores.style.cssText="font-size:20px;font-weight:800;text-align:right;line-height:1.5;font-variant-numeric:tabular-nums;white-space:pre-line"; scores.textContent=scoreOf(match,"home")+"\n"+scoreOf(match,"away");
    row.append(names,scores); card.append(header,row); addQuarterTable(card,match); return card;
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
      matches.forEach(m=>archiveList.appendChild(makeCard(m,true)));
    } catch(e) { archiveMeta.textContent="Archív zatiaľ čaká na prvý úspešný zber."; archiveList.textContent="Archív sa nepodarilo načítať: "+e.message; }
  }
  async function load() {
    try { const r=await fetch(DATA_URL+"?t="+Date.now(),{cache:"no-store"}); if(!r.ok) throw new Error("HTTP "+r.status); render(await r.json()); }
    catch(e) { meta.textContent="Basketbalové dáta sa nepodarilo načítať."; list.textContent="Chyba načítania: "+e.message; }
  }
  load(); loadArchive(); setInterval(load,10000); setInterval(loadArchive,60000);
})();
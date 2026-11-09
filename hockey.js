(() => {
  const CURRENT_URL = "./data/hockey-current.json";
  const ARCHIVE_URL = "./data/hockey-archive.json";
  const root = document.getElementById("hockey-view");
  if (!root) return;
  const liveList = document.getElementById("hockey-matches");
  const liveMeta = document.getElementById("hockey-meta");
  const archiveList = document.getElementById("hockey-archive");
  const archiveMeta = document.getElementById("hockey-archive-meta");
  const leagueFilter = document.getElementById("hockey-archive-league");
  const dateFilter = document.getElementById("hockey-archive-date");
  const applyFilter = document.getElementById("hockey-archive-apply");
  const livePanel = document.getElementById("hockey-live-panel");
  const archivePanel = document.getElementById("hockey-archive-panel");
  const liveTab = document.getElementById("hockey-live-tab");
  const archiveTab = document.getElementById("hockey-archive-tab");
  let archiveMatches = [];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const score = value => value === null || value === undefined ? "–" : value;
  const dateText = value => value ? new Date(value).toLocaleString("sk-SK") : "Dátum neznámy";
  function selectView(view) {
    const isArchive = view === "archive";
    livePanel.style.display = isArchive ? "none" : "block";
    archivePanel.style.display = isArchive ? "block" : "none";
    liveTab.classList.toggle("active", !isArchive);
    archiveTab.classList.toggle("active", isArchive);
    liveTab.setAttribute("aria-pressed", String(!isArchive));
    archiveTab.setAttribute("aria-pressed", String(isArchive));
  }
  liveTab.addEventListener("click", () => selectView("live"));
  archiveTab.addEventListener("click", () => selectView("archive"));
  function card(match, archived) {
    const period = match.period ? ` · ${match.period}. tretina` : "";
    const state = archived ? "UKONČENÉ" : (match.status_text || "LIVE");
    const stats = (side) => {
      const s = match.stats?.[side] || {};
      const pairs = Object.entries(s).filter(([k,v]) => v !== null && v !== undefined).slice(0,8);
      return pairs.length ? pairs.map(([k,v]) => `<span class="hockey-stat"><b>${esc(k)}:</b> ${esc(v)}</span>`).join("") : '<span class="hockey-muted">Štatistiky zatiaľ nie sú dostupné.</span>';
    };
    return `<article class="hockey-match">
      <div class="hockey-match-head"><b>🏒 ${esc(match.league_name || match.league_slug)}</b><span>${esc(state)}${period} ${esc(match.clock || "")}</span></div>
      <div class="hockey-score-row"><div>${esc(match.home?.name)}<br>${esc(match.away?.name)}</div><strong>${esc(score(match.home?.score))}<br>${esc(score(match.away?.score))}</strong></div>
      <div class="hockey-periods"><span>Po tretinách – domáci: ${esc((match.periods?.home || []).join(" · ") || "–")}</span><span>Hostia: ${esc((match.periods?.away || []).join(" · ") || "–")}</span></div>
      <details><summary>Štatistiky zápasu</summary><div class="hockey-stats-grid"><div><b>Domáci</b><br>${stats("home")}</div><div><b>Hostia</b><br>${stats("away")}</div></div></details>
      ${archived ? `<small class="hockey-muted">Dátum: ${esc(dateText(match.date))}</small>` : ""}
    </article>`;
  }
  function renderArchive() {
    const league = leagueFilter.value;
    const date = dateFilter.value;
    const matches = archiveMatches.filter(m => (!league || m.league_slug === league) && (!date || String(m.date || "").slice(0,10) === date));
    archiveMeta.textContent = `Zápasov v archíve: ${matches.length} · Celkovo uložených: ${archiveMatches.length}`;
    archiveList.innerHTML = matches.length ? matches.slice(0,250).map(m => card(m,true)).join("") : '<p>Pre zvolený filter nie sú v archíve žiadne zápasy.</p>';
  }
  applyFilter.addEventListener("click", renderArchive);
  async function load() {
    try {
      const [currentResponse, archiveResponse] = await Promise.all([
        fetch(CURRENT_URL + "?t=" + Date.now(), { cache:"no-store" }),
        fetch(ARCHIVE_URL + "?t=" + Date.now(), { cache:"no-store" })
      ]);
      if (!currentResponse.ok) throw new Error("LIVE dáta ešte nie sú publikované.");
      const current = await currentResponse.json();
      const archive = archiveResponse.ok ? await archiveResponse.json() : { matches:[] };
      archiveMatches = Array.isArray(archive) ? archive : (archive.matches || []);
      const leagues = [...new Map(archiveMatches.map(m => [m.league_slug, m.league_name || m.league_slug])).entries()];
      const currentValue = leagueFilter.value;
      leagueFilter.innerHTML = '<option value="">Všetky ligy</option>' + leagues.map(([slug,name]) => `<option value="${esc(slug)}">${esc(name)}</option>`).join("");
      leagueFilter.value = currentValue;
      const matches = current.matches || [];
      liveMeta.textContent = `ESPN · ${current.feed_state === "LIVE" ? "LIVE prenos aktívny" : "Momentálne bez LIVE zápasov"} · ${matches.length} zápasov · Zber: ${dateText(current.collected_at)}`;
      liveList.innerHTML = matches.length ? matches.map(m => card(m,false)).join("") : '<p>ESPN momentálne nevracia žiadny prebiehajúci hokejový zápas.</p>';
      renderArchive();
    } catch (error) {
      liveMeta.textContent = error.message;
      liveList.innerHTML = '<p>Čakám na prvý úspešný ESPN zber hokejových dát.</p>';
      archiveMeta.textContent = "Archív zatiaľ nie je dostupný.";
    }
  }
  load();
  setInterval(load, 60000);
})();

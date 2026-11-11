
(() => {
  // Načítaj dáta priamo z samostatnej vetvy live-data. GitHub Pages build sa
  // pri častých zberoch môže zrušiť novším commitom; raw súbory sa aktualizujú
  // hneď po commite collectora a nie sú závislé od dokončenia Pages deploya.
  const DATA_BASE_URL = "https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./live-data-v2/data/";
  // Main LIVE display now reads the Flashscore-only canonical candidate. The legacy combined feed remains available for rollback during the migration.
  const CURRENT_URL = DATA_BASE_URL + "flashscore-primary-current.json";
  const OUTCOMES_URL = DATA_BASE_URL + "flashscore-confirmed-outcomes.json";
  const BTTS_ARCHIVE_URL = DATA_BASE_URL + "flashscore-btts-signal-archive.json";
  const SIGNAL_KEY = "live_edge_signals_v6";

  const MIN_GAP_MINUTES = 1.5;
  const MAX_GAP_MINUTES = 15;

  const MAX_DATA_AGE_MS = 7 * 60 * 1000;
  const SCAN_INTERVAL_MS = 60 * 1000;

  const matchesEl = document.getElementById("matches");
  const matchSearchEl = document.getElementById("live-match-search");
  const liveFilterButtons = Array.from(document.querySelectorAll("[data-live-filter]"));
  let matchSearchTerm = "";
  let liveMatchFilter = "all";
  function applyLiveMatchSearch() {
    if (!matchesEl) return;
    const cards = matchesEl.querySelectorAll(".priority-match-card,.compact-match-card,.no-signal-match-card");
    cards.forEach(card => {
      const category = card.classList.contains("priority-match-card") ? "confirmed"
        : card.classList.contains("no-signal-match-card") ? "none" : "pressure";
      const matchesText = !matchSearchTerm || String(card.textContent || "").toLocaleLowerCase("sk").includes(matchSearchTerm);
      const matchesCategory = liveMatchFilter === "all" || liveMatchFilter === category;
      card.hidden = !(matchesText && matchesCategory);
    });
    matchesEl.querySelectorAll(".match-league-other,.match-league-confirmed").forEach(group => {
      group.hidden = !group.querySelector(".priority-match-card:not([hidden]),.compact-match-card:not([hidden]),.no-signal-match-card:not([hidden])");
    });
    liveFilterButtons.forEach(button => {
      const active = button.dataset.liveFilter === liveMatchFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }
  if (matchSearchEl) {
    matchSearchEl.addEventListener("input", () => {
      matchSearchTerm = String(matchSearchEl.value || "").trim().toLocaleLowerCase("sk");
      applyLiveMatchSearch();
    });
  }
  liveFilterButtons.forEach(button => button.addEventListener("click", () => {
    liveMatchFilter = button.dataset.liveFilter || "all";
    applyLiveMatchSearch();
  }));
  const liveDataHealthEl = document.getElementById("live-data-health");
  const signalEl = document.getElementById("signal");
  const systemStatsEl = document.getElementById("system-stats");
  const matchArchiveEl = document.getElementById("match-archive");
  const matchArchiveCountEl = document.getElementById("match-archive-count");
  const matchArchiveLeagueEl = document.getElementById("match-archive-league");
  const matchArchiveDateEl = document.getElementById("match-archive-date");
  const matchArchiveApplyEl = document.getElementById("match-archive-apply");
  const matchArchiveResetEl = document.getElementById("match-archive-reset");
  const greenSignalArchiveEl = document.getElementById("green-signal-archive");
  const greenSignalArchiveCountEl = document.getElementById("green-signal-archive-count");
  const bttsSignalArchiveEl = document.getElementById("btts-signal-archive");
  const bttsSignalArchiveCountEl = document.getElementById("btts-signal-archive-count");
  let matchArchiveData = null;
  let archiveLeagueFilter = "";
  let archiveDateFilter = "";
  let archiveDateDraft = "";

  if (matchArchiveLeagueEl) {
    matchArchiveLeagueEl.addEventListener("change", () => {
      archiveLeagueFilter = matchArchiveLeagueEl.value;
      renderMatchArchive(matchArchiveData);
    });
  }
  if (matchArchiveDateEl) {
    const updateArchiveDateDraft = () => {
      archiveDateDraft = matchArchiveDateEl.value;
      if (matchArchiveApplyEl) matchArchiveApplyEl.disabled = !archiveDateDraft;
    };
    matchArchiveDateEl.addEventListener("input", updateArchiveDateDraft);
    matchArchiveDateEl.addEventListener("change", updateArchiveDateDraft);
  }
  if (matchArchiveApplyEl) {
    matchArchiveApplyEl.addEventListener("click", () => {
      archiveDateFilter = archiveDateDraft || matchArchiveDateEl?.value || "";
      archiveDateDraft = archiveDateFilter;
      renderMatchArchive(matchArchiveData);
    });
  }
  if (matchArchiveResetEl) {
    matchArchiveResetEl.addEventListener("click", () => {
      archiveLeagueFilter = "";
      archiveDateFilter = "";
      archiveDateDraft = "";
      if (matchArchiveLeagueEl) matchArchiveLeagueEl.value = "";
      if (matchArchiveDateEl) matchArchiveDateEl.value = "";
      if (matchArchiveApplyEl) matchArchiveApplyEl.disabled = true;
      renderMatchArchive(matchArchiveData);
    });
  }

  if (!matchesEl || !signalEl) {
    console.error("Chýbajú HTML elementy matches alebo signal.");
    return;
  }

  let engine = document.getElementById("pressure-engine");

  if (!engine) {
    engine = document.createElement("div");
    engine.id = "pressure-engine";
    signalEl.insertAdjacentElement("afterend", engine);
  }

  engine.style.cssText =
    "margin-top:15px;padding:14px;background:#172438;color:white;border-radius:12px;";

  let scanning = false;
  let signalHistory = [];
  let pageLastSuccessAt = null;
  let pageLastAttemptAt = null;
  let pageLastError = "";
  let pageLoadState = "WAITING";
  let latestCollectorAt = null;

  function renderLiveDataHealth() {
    if (!liveDataHealthEl) return;
    const now = Date.now();
    const collectorTime = Date.parse(latestCollectorAt || "");
    const collectorAge = Number.isFinite(collectorTime) ? Math.max(0, now - collectorTime) : null;
    const ageText = collectorAge === null ? "nedostupný"
      : collectorAge < 60000 ? Math.floor(collectorAge / 1000) + " s · ČERSTVÉ"
      : Math.floor(collectorAge / 60000) + " min · " + (collectorAge <= 3 * 60 * 1000 ? "ČERSTVÉ" : collectorAge <= MAX_DATA_AGE_MS ? "ONESKORENÉ" : "ZASTARANÉ");
    const timeText = value => value ? new Date(value).toLocaleTimeString("sk-SK") : "—";
    const state = pageLoadState === "LOADING" ? "Načítavam dáta…"
      : pageLoadState === "ERROR" ? "Chyba načítania"
      : pageLoadState === "SUCCESS" ? "Stránka načítaná"
      : "Čakám na prvé načítanie";
    const stateColor = pageLoadState === "ERROR" ? "#f87171"
      : pageLoadState === "SUCCESS" ? "#39e6a5" : "#fbbf24";
    liveDataHealthEl.innerHTML = "";
    const heading = document.createElement("div");
    heading.textContent = "KONTROLA AKTUALIZÁCIE";
    heading.style.cssText = "font-size:10px;font-weight:900;letter-spacing:.7px;color:#a9bad0;margin-bottom:7px;";
    liveDataHealthEl.appendChild(heading);
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;";
    const add = (label, value, color) => {
      const item = document.createElement("div");
      item.style.cssText = "min-width:0;font-size:10px;line-height:1.45;color:#91a2b8;";
      const name = document.createElement("span");
      name.textContent = label + ": ";
      const val = document.createElement("strong");
      val.textContent = value;
      val.style.cssText = "color:" + (color || "#e2e8f0") + ";font-weight:800;overflow-wrap:anywhere;";
      item.append(name, val);
      grid.appendChild(item);
    };
    add("Stránka", state, stateColor);
    add("Posledné úspešné načítanie", timeText(pageLastSuccessAt));
    add("Posledný pokus", timeText(pageLastAttemptAt));
    add("Vek dát zo zberača", ageText, collectorAge === null || collectorAge > MAX_DATA_AGE_MS ? "#f87171" : collectorAge > 3 * 60 * 1000 ? "#fbbf24" : "#39e6a5");
    liveDataHealthEl.appendChild(grid);
    if (pageLastError) {
      const error = document.createElement("div");
      error.textContent = "Posledná chyba: " + pageLastError;
      error.style.cssText = "margin-top:7px;color:#fca5a5;font-size:10px;line-height:1.4;overflow-wrap:anywhere;";
      liveDataHealthEl.appendChild(error);
    }
  }
  renderLiveDataHealth();

  try {
    signalHistory = JSON.parse(
      localStorage.getItem(SIGNAL_KEY) || "[]"
    );

    if (!Array.isArray(signalHistory)) signalHistory = [];
  } catch {
    signalHistory = [];
  }

  function saveSignals() {
    try {
      localStorage.setItem(
        SIGNAL_KEY,
        JSON.stringify(signalHistory.slice(-500))
      );
    } catch (error) {
      console.warn("Ukladanie signálov zlyhalo:", error);
    }
  }

  function addText(parent, text, size = "14px") {
    const p = document.createElement("p");
    p.textContent = text;
    p.style.cssText = `margin:7px 0;font-size:${size};`;
    parent.appendChild(p);
    return p;
  }

  function addBadge(parent, label, background, border, color = "#ffffff") {
    const badge = document.createElement("span");

    badge.textContent = label;
    badge.style.cssText = `
      display:inline-flex;
      align-items:center;
      justify-content:center;
      padding:7px 11px;
      margin:5px 0;
      border-radius:8px;
      background:${background};
      border:1px solid ${border};
      color:${color};
      font-size:12px;
      font-weight:800;
      letter-spacing:0.4px;
      line-height:1.3;
      box-shadow:0 2px 8px ${background}55;
    `;

    parent.appendChild(badge);
    return badge;
  }

  function addSignalPanel(parent, options) {
    const panel = document.createElement("div");

    panel.style.cssText = `
      margin-top:13px;
      padding:14px;
      border-radius:12px;
      background:${options.background};
      border:2px solid ${options.border};
      color:#ffffff;
      box-shadow:0 0 12px ${options.border}35;
    `;

    const heading = document.createElement("div");
    heading.textContent = options.heading;
    heading.style.cssText = `
      font-size:16px;
      font-weight:900;
      margin-bottom:9px;
      letter-spacing:0.3px;
    `;

    panel.appendChild(heading);

    if (options.title) {
      const title = document.createElement("div");
      title.textContent = options.title;
      title.style.cssText = `
        font-size:19px;
        font-weight:900;
        color:${options.titleColor || "#ffffff"};
        margin:7px 0;
      `;
      panel.appendChild(title);
    }

    if (options.detail) {
      const detail = document.createElement("div");
      detail.textContent = options.detail;
      detail.style.cssText = `
        font-size:14px;
        line-height:1.5;
        margin-top:5px;
      `;
      panel.appendChild(detail);
    }

    parent.appendChild(panel);
    return panel;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function getJSON(url) {
    const fallbackUrl = url.replace(
      "https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./live-data-v2/",
      "https://cdn.jsdelivr.net/gh/elcicarito/live-edge-ai-pro.@live-data-v2/"
    );
    const apiBase = "https://api.github.com/repos/elcicarito/live-edge-ai-pro.";
    const apiPath = url === CURRENT_URL ? "data/flashscore-primary-current.json" : "";
    const apiUrl = apiPath ? apiBase + "/contents/" + apiPath + "?ref=live-data-v2" : "";
    const candidates = [...new Set([url, fallbackUrl, apiUrl].filter(Boolean))];
    const failures = [];

    for (const candidate of candidates) {
      try {
        const response = await fetchWithTimeout(
          candidate + (candidate.includes("?") ? "&" : "?") + "t=" + Date.now(),
          { cache: "no-store" },
          15000
        );
        if (!response.ok) throw new Error("HTTP " + response.status);
        const payload = await response.json();

        if (candidate === apiUrl && payload && payload.encoding === "base64" &&
            typeof payload.content === "string" && payload.content.trim()) {
          const binary = atob(payload.content.replace(/\s/g, ""));
          const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
          return JSON.parse(new TextDecoder().decode(bytes));
        }
        if (candidate !== apiUrl) return payload;

        // GitHub Contents API vynecháva obsah súborov nad 1 MB.
        // SHA z metadata preto použijeme na stiahnutie skutočného Git Blob objektu.
        if (!payload.sha) throw new Error("GitHub Contents API nevrátilo SHA súboru");
        const blobResponse = await fetchWithTimeout(apiBase + "/git/blobs/" + payload.sha, {
          cache: "no-store",
          headers: { Accept: "application/vnd.github+json" }
        }, 25000);
        if (!blobResponse.ok) throw new Error("Git Blobs HTTP " + blobResponse.status);
        const blob = await blobResponse.json();
        if (blob.encoding !== "base64" || typeof blob.content !== "string") {
          throw new Error("GitHub Blob nevrátil base64 obsah");
        }
        const binary = atob(blob.content.replace(/\s/g, ""));
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        return JSON.parse(new TextDecoder().decode(bytes));
      } catch (error) {
        failures.push(candidate + ": " + (error?.message || String(error)));
      }
    }

    throw new Error("Nepodarilo sa načítať LIVE dáta z hlavného, záložného ani GitHub API/Blob zdroja. " + failures.join(" | "));
  }

  // Pomocné archívy sa nemenia tak často ako LIVE snapshot.
  // Držíme ich v pamäti a nesťahujeme veľké súbory pri každom 2-minútovom cykle.
  const refreshCache = new Map();
  async function getCachedJSON(url, ttlMs) {
    const cached = refreshCache.get(url);
    if (cached && Date.now() - cached.loadedAt < ttlMs) return cached.value;
    const value = await getJSON(url);
    refreshCache.set(url, { loadedAt: Date.now(), value });
    return value;
  }

  const flashscoreArchiveDateEl = document.getElementById("flashscore-archive-date");
  const flashscoreArchiveSearchEl = document.getElementById("flashscore-archive-search");
  const flashscoreArchiveLoadEl = document.getElementById("flashscore-archive-load");
  const flashscoreArchiveStatusEl = document.getElementById("flashscore-archive-status");
  const flashscoreArchiveResultsEl = document.getElementById("flashscore-archive-results");
  const flashscoreArchiveCountEl = document.getElementById("flashscore-archive-count");
  let flashscoreArchiveRows = [];
  let flashscoreArchiveIndex = null;
  let flashscoreArchiveLoadedWeek = "";
  let flashscoreRecentHistoryCache = { loadedAt: 0, rows: [] };
  let flashscoreRecentHistoryStatus = { state: "WAITING", count: 0, error: "" };


  function localDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function isoWeekKey(dateString) {
    const date = new Date(dateString + "T12:00:00Z");
    if (!Number.isFinite(date.getTime())) return "";
    const day = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - day + 3);
    const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((date - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
    return date.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
  }

  async function fetchFlashscoreTimeline(file) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("Tento prehliadač nepodporuje čítanie komprimovaného archívu.");
    }
    const rawUrl = DATA_BASE_URL + file;
    const cdnUrl = rawUrl.replace(
      "https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./live-data-v2/",
      "https://cdn.jsdelivr.net/gh/elcicarito/live-edge-ai-pro.@live-data-v2/"
    );
    const apiBase = "https://api.github.com/repos/elcicarito/live-edge-ai-pro.";
    const failures = [];
    const decodeGzip = async compressed => {
      if (!compressed || !compressed.byteLength) throw new Error("Prázdny archívny súbor");
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
      return new TextDecoder().decode(await new Response(stream).arrayBuffer());
    };

    for (const baseUrl of [...new Set([rawUrl, cdnUrl])]) {
      try {
        const url = baseUrl + (baseUrl.includes("?") ? "&" : "?") + "t=" + Date.now();
        const response = await fetchWithTimeout(url, { cache: "no-store" }, 10000);
        if (!response.ok) throw new Error("HTTP " + response.status);
        return await decodeGzip(await response.arrayBuffer());
      } catch (error) {
        failures.push(baseUrl + ": " + (error?.message || String(error)));
      }
    }

    try {
      const metadataUrl = apiBase + "/contents/data/" + encodeURIComponent(file) + "?ref=live-data-v2";
      const metadataResponse = await fetchWithTimeout(metadataUrl, {
        cache: "no-store",
        headers: { Accept: "application/vnd.github+json" }
      }, 12000);
      if (!metadataResponse.ok) throw new Error("GitHub Contents HTTP " + metadataResponse.status);
      const metadata = await metadataResponse.json();
      if (!metadata.sha) throw new Error("GitHub nevrátil SHA archívneho súboru");

      const blobResponse = await fetchWithTimeout(apiBase + "/git/blobs/" + metadata.sha, {
        cache: "no-store",
        headers: { Accept: "application/vnd.github+json" }
      }, 20000);
      if (!blobResponse.ok) throw new Error("Git Blobs HTTP " + blobResponse.status);
      const blob = await blobResponse.json();
      if (blob.encoding !== "base64" || typeof blob.content !== "string") {
        throw new Error("GitHub Blob nevrátil base64 obsah");
      }
      const binary = atob(blob.content.replace(/\\s/g, ""));
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return await decodeGzip(bytes);
    } catch (error) {
      failures.push("GitHub API Blob: " + (error?.message || String(error)));
    }

    throw new Error("Archív sa nepodarilo načítať zo žiadneho zdroja. " + failures.join(" | "));
  }

  async function loadFlashscoreRecentHistory() {
    const now = Date.now();
    if (flashscoreRecentHistoryCache.rows.length && now - flashscoreRecentHistoryCache.loadedAt < 180000) return flashscoreRecentHistoryCache.rows;
    flashscoreRecentHistoryStatus = { state: "LOADING", count: 0, error: "" };
    const index = await getCachedJSON(DATA_BASE_URL + "flashscore-timeline-index.json", 60000);
    if (!index || index.source !== "Flashscore" || !Array.isArray(index.weeks)) {
      throw new Error("Neplatný Flashscore timeline index.");
    }
    const weeks = index.weeks
      .filter(item => item && typeof item.file === "string" &&
        /^flashscore-match-timeline-\d{4}-W\d{2}\.jsonl\.gz$/.test(item.file))
      .sort((a, b) => String(b.week || "").localeCompare(String(a.week || "")))
      .slice(0, 2);
    const cutoff = now - 86400000;
    const seen = new Set();
    const rows = [];
    for (const week of weeks) {
      const decoded = await fetchFlashscoreTimeline(week.file);
      for (const line of decoded.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        const snap = entry.snapshot || {};
        const time = Date.parse(snap.collected_at || "");
        const id = String(entry.match_id || "");
        if (!id || !Number.isFinite(time) || time < cutoff || time > now + 60000) continue;
        const key = id + "|" + time;
        if (seen.has(key)) continue;
        seen.add(key);
        const stats = (Array.isArray(snap.stats) ? snap.stats : []).map(item => ({
          ...item,
          label: item.label || item.name || "",
          home: item.home_numeric ?? item.home,
          away: item.away_numeric ?? item.away
        }));
        rows.push({
          time,
          match: {
            id, source: "Flashscore", status: "live",
            status_text: String(snap.stage || "LIVE"),
            stage: snap.stage || null,
            live_minute: snap.live_minute ?? null,
            live_clock: snap.live_clock || null,
            home_score: snap.home_score ?? null,
            away_score: snap.away_score ?? null,
            stats
          }
        });
      }
    }
    rows.sort((a, b) => a.time - b.time);
    flashscoreRecentHistoryCache = { loadedAt: now, rows };
    flashscoreRecentHistoryStatus = { state: "READY", count: rows.length, error: "" };
    return rows;
  }

  function renderFlashscoreArchive() {
    if (!flashscoreArchiveResultsEl) return;
    const selectedDate = flashscoreArchiveDateEl?.value || localDateKey();
    const query = String(flashscoreArchiveSearchEl?.value || "").trim().toLocaleLowerCase("sk");
    const rows = flashscoreArchiveRows.filter(entry => {
      const snapshot = entry.snapshot || {};
      const snapshotDate = snapshot.collected_at ? localDateKey(new Date(snapshot.collected_at)) : "";
      if (snapshotDate !== selectedDate) return false;
      const haystack = [
        entry.home, entry.away, entry.competition, entry.country, snapshot.live_minute,
        snapshot.live_clock, snapshot.stage, snapshot.home_score, snapshot.away_score
      ].join(" ").toLocaleLowerCase("sk");
      return !query || haystack.includes(query);
    });

    const matchGroups = new Map();
    for (const entry of rows) {
      const key = String(entry.match_id || [
        entry.home || "", entry.away || "", entry.competition || ""
      ].join("|"));
      if (!matchGroups.has(key)) matchGroups.set(key, []);
      matchGroups.get(key).push(entry);
    }
    const matches = [...matchGroups.values()].map(items => items.sort((a, b) =>
      Date.parse(a.snapshot?.collected_at || 0) - Date.parse(b.snapshot?.collected_at || 0)
    ));

    const countryGroups = new Map();
    for (const items of matches) {
      const first = items[0];
      const country = String(first.country || "Ostatné").trim() || "Ostatné";
      const competition = String(first.competition || "Neznáma súťaž").trim() || "Neznáma súťaž";
      if (!countryGroups.has(country)) countryGroups.set(country, new Map());
      const leagueGroups = countryGroups.get(country);
      if (!leagueGroups.has(competition)) leagueGroups.set(competition, []);
      leagueGroups.get(competition).push(items);
    }

    const countryMeta = {
      "Argentina": ["Argentína", "🇦🇷"], "Australia": ["Austrália", "🇦🇺"],
      "Austria": ["Rakúsko", "🇦🇹"], "Belgium": ["Belgicko", "🇧🇪"],
      "Bolivia": ["Bolívia", "🇧🇴"], "Bosnia & Herzegovina": ["Bosna a Hercegovina", "🇧🇦"],
      "Brazil": ["Brazília", "🇧🇷"], "Bulgaria": ["Bulharsko", "🇧🇬"],
      "Canada": ["Kanada", "🇨🇦"], "Chile": ["Čile", "🇨🇱"],
      "China": ["Čína", "🇨🇳"], "Colombia": ["Kolumbia", "🇨🇴"],
      "Costa Rica": ["Kostarika", "🇨🇷"], "Croatia": ["Chorvátsko", "🇭🇷"],
      "Cyprus": ["Cyprus", "🇨🇾"], "Czech Republic": ["Česko", "🇨🇿"],
      "Denmark": ["Dánsko", "🇩🇰"], "Ecuador": ["Ekvádor", "🇪🇨"],
      "England": ["Anglicko", "🏴"], "Estonia": ["Estónsko", "🇪🇪"],
      "Finland": ["Fínsko", "🇫🇮"], "France": ["Francúzsko", "🇫🇷"],
      "Germany": ["Nemecko", "🇩🇪"], "Greece": ["Grécko", "🇬🇷"],
      "Hungary": ["Maďarsko", "🇭🇺"], "Iceland": ["Island", "🇮🇸"],
      "India": ["India", "🇮🇳"], "Indonesia": ["Indonézia", "🇮🇩"],
      "International": ["Medzinárodné", "🌍"], "Ireland": ["Írsko", "🇮🇪"],
      "Israel": ["Izrael", "🇮🇱"], "Italy": ["Taliansko", "🇮🇹"],
      "Jamaica": ["Jamajka", "🇯🇲"], "Japan": ["Japonsko", "🇯🇵"],
      "Mexico": ["Mexiko", "🇲🇽"], "Moldova": ["Moldavsko", "🇲🇩"],
      "Mongolia": ["Mongolsko", "🇲🇳"], "Morocco": ["Maroko", "🇲🇦"],
      "Netherlands": ["Holandsko", "🇳🇱"], "New Zealand": ["Nový Zéland", "🇳🇿"],
      "Northern Ireland": ["Severné Írsko", "🇬🇧"], "Norway": ["Nórsko", "🇳🇴"],
      "Paraguay": ["Paraguaj", "🇵🇾"], "Peru": ["Peru", "🇵🇪"],
      "Poland": ["Poľsko", "🇵🇱"], "Portugal": ["Portugalsko", "🇵🇹"],
      "Romania": ["Rumunsko", "🇷🇴"], "Scotland": ["Škótsko", "🏴"],
      "Serbia": ["Srbsko", "🇷🇸"], "Singapore": ["Singapur", "🇸🇬"],
      "Slovakia": ["Slovensko", "🇸🇰"], "Slovenia": ["Slovinsko", "🇸🇮"],
      "South Africa": ["Južná Afrika", "🇿🇦"], "South Korea": ["Južná Kórea", "🇰🇷"],
      "Spain": ["Španielsko", "🇪🇸"], "Sweden": ["Švédsko", "🇸🇪"],
      "Switzerland": ["Švajčiarsko", "🇨🇭"], "Turkey": ["Turecko", "🇹🇷"],
      "Ukraine": ["Ukrajina", "🇺🇦"], "United Arab Emirates": ["Spojené arabské emiráty", "🇦🇪"],
      "United States": ["USA", "🇺🇸"], "Uruguay": ["Uruguaj", "🇺🇾"],
      "Uzbekistan": ["Uzbekistan", "🇺🇿"], "Wales": ["Wales", "🏴"],
      "World": ["Svetové súťaže", "🌍"]
    };

    const countries = [...countryGroups.entries()].map(([country, leagueGroups]) => {
      const leagueList = [...leagueGroups.entries()].map(([competition, leagueMatches]) => ({
        competition,
        matches: leagueMatches.sort((a, b) =>
          Date.parse(b[b.length - 1]?.snapshot?.collected_at || 0) -
          Date.parse(a[a.length - 1]?.snapshot?.collected_at || 0)
        )
      })).sort((a, b) => a.competition.localeCompare(b.competition, "sk"));
      const meta = countryMeta[country] || [country, "🏳️"];
      return {
        country,
        label: meta[0],
        flag: meta[1],
        leagues: leagueList,
        matchCount: leagueList.reduce((sum, league) => sum + league.matches.length, 0),
        snapshotCount: leagueList.reduce((sum, league) =>
          sum + league.matches.reduce((count, items) => count + items.length, 0), 0)
      };
    }).sort((a, b) => a.label.localeCompare(b.label, "sk"));

    flashscoreArchiveResultsEl.innerHTML = "";
    if (flashscoreArchiveCountEl) flashscoreArchiveCountEl.textContent = String(matches.length);
    if (!matches.length) {
      addText(flashscoreArchiveResultsEl, "Pre tento dátum a vyhľadávanie zatiaľ nie sú uložené žiadne zápasy.");
      return;
    }

    const totalLeagues = countries.reduce((sum, country) => sum + country.leagues.length, 0);
    const overview = document.createElement("div");
    overview.style.cssText = "margin:8px 0 12px;padding:11px 13px;border:1px solid #31445c;border-radius:10px;background:linear-gradient(110deg,#172b43,#122238);color:#d6e1ee;font-size:13px;line-height:1.6;";
    overview.textContent = matches.length + (matches.length === 1 ? " zápas" : " zápasov") +
      " · " + countries.length + (countries.length === 1 ? " krajina" : " krajín") +
      " · " + totalLeagues + (totalLeagues === 1 ? " liga" : " líg") +
      " · " + rows.length + (rows.length === 1 ? " snímka" : " snímok");
    flashscoreArchiveResultsEl.appendChild(overview);

    function createCount(label) {
      const count = document.createElement("span");
      count.textContent = label;
      count.style.cssText = "flex:0 0 auto;min-width:30px;padding:4px 8px;border-radius:20px;background:#203b52;border:1px solid #36536e;color:#bfe4ff;font-size:11px;font-weight:800;text-align:center;";
      return count;
    }

    function createDisclosure(title, countText, level) {
      const details = document.createElement("details");
      details.style.cssText = level === "country"
        ? "margin:9px 0;border:1px solid #36516d;border-radius:12px;background:linear-gradient(110deg,#172b43,#101d2d);overflow:hidden;"
        : level === "league"
          ? "margin:7px 0;border:1px solid #2d435c;border-radius:10px;background:#122238;overflow:hidden;"
          : "margin:7px 0;border:1px solid #2b4058;border-radius:10px;background:#101d2d;color:#fff;overflow:hidden;";
      const summary = document.createElement("summary");
      summary.style.cssText = "display:flex;align-items:center;gap:10px;padding:" +
        (level === "country" ? "14px 13px" : "11px 12px") +
        ";cursor:pointer;list-style:none;color:#f0f5fb;font-weight:800;font-size:" +
        (level === "country" ? "15px" : "13px") + ";";
      const name = document.createElement("span");
      name.textContent = title;
      name.style.cssText = "min-width:0;flex:1;line-height:1.45;";
      summary.appendChild(name);
      summary.appendChild(createCount(countText));
      const toggle = document.createElement("span");
      toggle.textContent = "＋";
      toggle.style.cssText = "color:#67d9d0;font-size:18px;font-weight:700;";
      summary.appendChild(toggle);
      details.addEventListener("toggle", () => {
        toggle.textContent = details.open ? "−" : "＋";
      });
      details.appendChild(summary);
      const content = document.createElement("div");
      content.style.cssText = "padding:0 10px 10px;";
      details.appendChild(content);
      return { details, content };
    }

    for (const country of countries) {
      const countryNode = createDisclosure(
        country.flag + "  " + country.label,
        country.matchCount + " záp. · " + country.leagues.length + " líg",
        "country"
      );
      // Pri vyhľadávaní automaticky otvor zodpovedajúce vetvy, aby výsledky neostali skryté.
      countryNode.details.open = Boolean(query);
      for (const league of country.leagues) {
        const leagueNode = createDisclosure(
          "🏆  " + league.competition,
          String(league.matches.length) + (league.matches.length === 1 ? " zápas" : " zápasov"),
          "league"
        );
        leagueNode.details.open = Boolean(query);

        for (const items of league.matches) {
          const first = items[0];
          const latest = items[items.length - 1];
          const latestSnapshot = latest.snapshot || {};
          const matchNode = createDisclosure(
            (first.home || "Domáci") + "  " +
              (latestSnapshot.home_score ?? "–") + " : " + (latestSnapshot.away_score ?? "–") +
              "  " + (first.away || "Hostia"),
            items.length + (items.length === 1 ? " snímka" : " snímok") +
              " · " + (latestSnapshot.live_clock || latestSnapshot.stage || "čas nezistený"),
            "match"
          );
          matchNode.details.open = Boolean(query);

          for (const entry of items.slice().reverse()) {
            const snapshot = entry.snapshot || {};
            const row = document.createElement("div");
            row.style.cssText = "margin:7px 0;padding:9px 10px;border:1px solid #263b52;border-radius:8px;background:#0c1726;";
            const line = document.createElement("div");
            line.style.cssText = "display:flex;flex-wrap:wrap;justify-content:space-between;gap:5px;font-size:12px;";
            const time = document.createElement("strong");
            time.textContent = new Date(snapshot.collected_at || "").toLocaleTimeString("sk-SK");
            const score = document.createElement("strong");
            const clock = snapshot.live_clock ||
              (snapshot.live_minute === null || snapshot.live_minute === undefined || snapshot.live_minute === ""
                ? (snapshot.stage || "—")
                : String(snapshot.live_minute).replace(/'$/, "") + "'");
            score.textContent = (snapshot.home_score ?? "–") + " : " + (snapshot.away_score ?? "–") + "  ·  " + clock;
            line.appendChild(time);
            line.appendChild(score);
            row.appendChild(line);

            const stats = Array.isArray(snapshot.stats) ? snapshot.stats : [];
            const statDetails = document.createElement("details");
            statDetails.style.cssText = "margin-top:6px;color:#cbd8e6;";
            const statSummary = document.createElement("summary");
            statSummary.style.cssText = "font-size:11px;cursor:pointer;color:#9fb3ca;";
            statSummary.textContent = "Štatistiky (" + stats.length + ")";
            statDetails.appendChild(statSummary);
            if (stats.length) {
              for (const stat of stats) {
                const statLine = document.createElement("div");
                statLine.style.cssText = "padding:4px 0;border-top:1px solid #203248;font-size:11px;";
                statLine.textContent = (stat.name || "Štatistika") + ": " +
                  (stat.home ?? "–") + " : " + (stat.away ?? "–") +
                  (stat.period ? " · " + stat.period : "");
                statDetails.appendChild(statLine);
              }
            } else {
              const noStats = document.createElement("p");
              noStats.style.cssText = "font-size:11px;color:#8295aa;";
              noStats.textContent = "Pre túto snímku neboli dostupné štatistiky.";
              statDetails.appendChild(noStats);
            }
            row.appendChild(statDetails);
            matchNode.content.appendChild(row);
          }
          leagueNode.content.appendChild(matchNode.details);
        }
        countryNode.content.appendChild(leagueNode.details);
      }
      flashscoreArchiveResultsEl.appendChild(countryNode.details);
    }
  }

  async function loadFlashscoreArchive() {
    if (!flashscoreArchiveStatusEl || !flashscoreArchiveResultsEl) return;
    const selectedDate = flashscoreArchiveDateEl?.value || localDateKey();
    const week = isoWeekKey(selectedDate);
    flashscoreArchiveStatusEl.textContent = "Načítavam Flashscore archív...";
    try {
      const [index, archive] = await Promise.all([
        getCachedJSON(DATA_BASE_URL + "flashscore-timeline-index.json", 2 * 60 * 1000),
        getCachedJSON(DATA_BASE_URL + "flashscore-match-archive.json", 2 * 60 * 1000).catch(() => null)
      ]);
      if (!index || index.source !== "Flashscore" || !Array.isArray(index.weeks)) {
        throw new Error("Flashscore archív zatiaľ nemá platný index.");
      }
      flashscoreArchiveIndex = index;
      const uniqueMatches = Object.keys(archive?.matches || {}).length;
      const weekEntry = index.weeks.find(item => item.week === week);
      if (!weekEntry) {
        flashscoreArchiveRows = [];
        flashscoreArchiveLoadedWeek = week;
        renderFlashscoreArchive();
        flashscoreArchiveStatusEl.textContent = "Archív obsahuje " + uniqueMatches +
          " zápasov. Pre týždeň " + week + " zatiaľ nie sú uložené snímky.";
        return;
      }
      let timelineError = "";
      if (flashscoreArchiveLoadedWeek !== week) {
        try {
          const timelineText = await fetchFlashscoreTimeline(weekEntry.file);
          flashscoreArchiveRows = timelineText.split("\n").filter(Boolean).map(line => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter(Boolean);
          flashscoreArchiveLoadedWeek = week;
        } catch (error) {
          timelineError = error.message || String(error);
          flashscoreArchiveRows = [];
        }
      }

      // Záložný zdroj: posledná uložená snímka každého zápasu.
      // Zachová zobrazenie archívu aj vtedy, ak prehliadač nevie načítať gzip timeline.
      const fallbackRows = Object.values(archive?.matches || {}).map(match => ({
        match_id: match.id,
        home: match.home,
        away: match.away,
        competition: match.competition,
        country: match.country,
        snapshot: match.last_snapshot
      })).filter(entry => entry.snapshot && entry.snapshot.collected_at &&
        isoWeekKey(String(entry.snapshot.collected_at).slice(0, 10)) === week);
      const knownRows = new Set(flashscoreArchiveRows.map(entry =>
        String(entry.match_id || "") + "|" + String(entry.snapshot?.collected_at || "")
      ));
      for (const entry of fallbackRows) {
        const key = String(entry.match_id || "") + "|" + String(entry.snapshot.collected_at || "");
        if (!knownRows.has(key)) {
          flashscoreArchiveRows.push(entry);
          knownRows.add(key);
        }
      }

      renderFlashscoreArchive();
      flashscoreArchiveStatusEl.textContent = "Zdroj: Flashscore · " + uniqueMatches +
        " archivovaných zápasov · " + flashscoreArchiveRows.length +
        " dostupných snímok v " + week + ". Zobrazenie je filtrované podľa dátumu." +
        (timelineError ? " Záložné zobrazenie posledných snímok (chyba timeline: " + timelineError + ")." : "");
    } catch (error) {
      flashscoreArchiveStatusEl.textContent = "Flashscore archív sa nepodarilo načítať: " + error.message;
      flashscoreArchiveResultsEl.innerHTML = "";
      if (flashscoreArchiveCountEl) flashscoreArchiveCountEl.textContent = "0";
    }
  }

  if (flashscoreArchiveDateEl) flashscoreArchiveDateEl.value = localDateKey();
  if (flashscoreArchiveLoadEl) flashscoreArchiveLoadEl.addEventListener("click", loadFlashscoreArchive);
  if (flashscoreArchiveDateEl) flashscoreArchiveDateEl.addEventListener("change", loadFlashscoreArchive);
  if (flashscoreArchiveSearchEl) flashscoreArchiveSearchEl.addEventListener("input", renderFlashscoreArchive);
  loadFlashscoreArchive();


  let lastRenderedSignalArchive = null;
  let lastRenderedBttsArchive = null;
  let lastRenderedMatchArchive = null;
  let lastRenderedPerformanceGreen = null;
  let lastRenderedPerformanceBtts = null;

  function getStatus(match) {
    const value = match?.status;

    if (typeof value === "string") {
      return value.toLowerCase().trim();
    }

    if (value && typeof value === "object") {
      return String(
        value.type ||
        value.name ||
        value.short ||
        ""
      ).toLowerCase().trim();
    }

    return "";
  }

  function matchId(match) {
    // Flashscore záznamy obsahujú zároveň kanonické id aj URL.
    // Signálový archív ukladá krátke event id, preto musí mať id prednosť
    // pred URL/slug, inak sa aktívne signály nespárujú s LIVE kartou.
    return String(
      match?.tracker?.id ||
      match?.id ||
      match?.slug ||
      match?.url ||
      ""
    );
  }

  function isLive(match) {
    if (!match) return false;

    const status = getStatus(match);
    const statusText = String(
      match.status_text || ""
    ).toLowerCase();

    if (
      ["live", "inplay", "in_play"].includes(status)
    ) {
      return true;
    }

    return (
      statusText.includes("1st half") ||
      statusText.includes("2nd half") ||
      statusText.includes("half-time") ||
      statusText.includes("extra time") ||
      statusText.includes("penalties")
    );
  }

  // Vizuálne označenie stavu zápasu.
  // Nemení vyhodnocovanie ani generovanie signálov.
  function getStatusBadge(match) {
    const status = getStatus(match);
    const statusText = String(
      match?.status_text || ""
    ).toLowerCase().trim();

    const combined = `${status} ${statusText}`
      .replace(/[_-]/g, " ")
      .toLowerCase();

    const rawMinute = String(
      match?.live_minute ?? ""
    ).toLowerCase().trim();

    if (
      combined.includes("penalt") ||
      combined.includes("shootout")
    ) {
      return {
        label: "● PENALTY",
        background: "#991b1b",
        border: "#ef4444"
      };
    }

    if (
      combined.includes("extra time") ||
      combined.includes("extratime")
    ) {
      return {
        label: "PREDĹŽENIE",
        background: "#6d28d9",
        border: "#a78bfa"
      };
    }

    if (
      combined.includes("half time") ||
      combined.includes("halftime") ||
      combined.includes("break") ||
      statusText === "ht" ||
      status === "ht" ||
      rawMinute === "ht"
    ) {
      return {
        label: "● PRESTÁVKA",
        background: "#92400e",
        border: "#f59e0b"
      };
    }

    if (
      combined.includes("1st half") ||
      combined.includes("first half") ||
      statusText === "1h" ||
      status === "1h"
    ) {
      return {
        label: "● 1. POLČAS",
        background: "#065f46",
        border: "#34d399"
      };
    }

    if (
      combined.includes("2nd half") ||
      combined.includes("second half") ||
      statusText === "2h" ||
      status === "2h"
    ) {
      return {
        label: "● 2. POLČAS",
        background: "#065f46",
        border: "#34d399"
      };
    }

    if (
      combined.includes("suspend") ||
      combined.includes("interrupt")
    ) {
      return {
        label: "● PRERUŠENÉ",
        background: "#991b1b",
        border: "#ef4444"
      };
    }

    if (
      combined.includes("postpon") ||
      combined.includes("delay")
    ) {
      return {
        label: "● ODLOŽENÉ",
        background: "#92400e",
        border: "#f59e0b"
      };
    }

    if (
      combined.includes("cancel")
    ) {
      return {
        label: "● ZRUŠENÉ",
        background: "#991b1b",
        border: "#ef4444"
      };
    }

    if (
      combined.includes("finished") ||
      combined.includes("ended") ||
      combined.includes("full time") ||
      statusText === "ft" ||
      status === "ft"
    ) {
      return {
        label: "FT · UKONČENÉ",
        background: "#374151",
        border: "#9ca3af"
      };
    }

    return {
      label: "● LIVE",
      background: "#047857",
      border: "#34d399"
    };
  }

  function getDisplayedMinute(match, collectedAt) {
    const raw = String(match.live_minute ?? "").trim();
    const statusText = String(match.status_text || "").toLowerCase();

    if (
      statusText.includes("half-time") ||
      statusText.includes("half time") ||
      statusText === "ht" ||
      raw.toLowerCase().includes("ht")
    ) {
      return "HT";
    }

    if (match.source === "Flashscore") {
      const flashscoreClock = String(match.live_clock || "").trim();
      return flashscoreClock || raw || "?";
    }

    if (!raw) return "?";
    // Flashscore supplies its own stage clock; its minute is never advanced a second time.
    if (raw.startsWith("~")) return raw;

    const base = parseInt(raw, 10);

    if (!Number.isFinite(base)) return raw;

    const timestamp = Date.parse(collectedAt || "");

    if (!Number.isFinite(timestamp)) return raw;

    const elapsed = Math.max(
      0,
      Math.floor((Date.now() - timestamp) / 60000)
    );

    const minute = base + elapsed;

    if (raw.includes("+")) {
      return `${base}+${elapsed}`;
    }

    if (minute > 90) {
      return `90+${minute - 90}`;
    }

    return String(minute);
  }

  function statLabel(stat) {
    return String(stat?.label || stat?.name || stat?.type || stat?.category || "").trim();
  }

  function statValue(stats, keyword) {
    const candidates = (Array.isArray(stats) ? stats : []).filter(stat =>
      statLabel(stat).toLowerCase().includes(keyword)
    );
    if (!candidates.length) return null;
    const hasPeriod = candidates.some(stat => String(stat?.period || "").trim());
    const item = hasPeriod
      ? candidates.find(stat => String(stat?.period || "").trim().toLowerCase() === "match")
      : candidates[0];
    if (!item) return null;
    const toNumber = value => {
      if (value === null || value === undefined || String(value).trim() === "") return null;
      const number = Number(String(value).replace("%", "").replace(",", "."));
      return Number.isFinite(number) ? number : null;
    };
    const home = toNumber(item.home_numeric ?? item.home);
    const away = toNumber(item.away_numeric ?? item.away);
    return home === null || away === null ? null : { home, away };
  }

  function calculatePressure(stats) {
    const measures = [
      { key: "possession", weight: 0.10 },
      { key: "shots on target", weight: 0.40 },
      { key: "shots off target", weight: 0.50 }
    ];

    let home = 0;
    let away = 0;
    let totalWeight = 0;

    for (const measure of measures) {
      const value = statValue(stats, measure.key);
      if (!value) continue;

      const total = value.home + value.away;
      const ratio = total > 0 ? value.home / total : 0.5;

      home += ratio * measure.weight;
      away += (1 - ratio) * measure.weight;
      totalWeight += measure.weight;
    }

    if (!totalWeight) return null;

    return {
      home: Math.round(home / totalWeight * 100),
      away: Math.round(away / totalWeight * 100)
    };
  }

  // Porovnanie polčasov používa iba samostatné period hodnoty z Flashscore.
  function renderHalfPeriodComparison(target, stats, match) {
    if (!Array.isArray(stats)) return;
    const periods = [
      { key: "1st half", label: "1. POLČAS" },
      { key: "2nd half", label: "2. POLČAS" }
    ];
    const normalize = value => String(value || "").trim().toLowerCase();
    const rows = [
      { label: "Držanie lopty", test: /possession|dr[zž]anie lopty/ },
      { label: "Celkové strely", test: /total shots|shots total|celkové strely|celkove strely/ },
      { label: "Strely na bránu", test: /shots on target|strely na bránu|strely na branu/ },
      { label: "Rohy", test: /corner kicks|corners|rohov/ },
      { label: "Fauly", test: /fouls|fauly/ }
    ];
    const data = periods.map(period => {
      const periodStats = stats.filter(item => normalize(item?.period) === period.key);
      const unique = rows.map(row => {
        const item = periodStats.find(stat => row.test.test(statLabel(stat)));
        return item ? { label: row.label, home: item.home, away: item.away, suffix: /possession/i.test(statLabel(item)) ? "%" : "" } : null;
      }).filter(Boolean);
      return { ...period, stats: unique };
    }).filter(period => period.stats.length);
    if (!data.length) {
      addText(target, "Samostatné štatistiky 1. a 2. polčasu Flashscore pre tento zápas neposkytol.", "10px");
      return;
    }
    const heading = document.createElement("div");
    heading.textContent = "POROVNANIE POLČASOV";
    heading.style.cssText = "font-size:12px;font-weight:900;color:#dbeafe;margin:14px 0 8px;";
    target.appendChild(heading);
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(" + (data.length === 2 ? "2" : "1") + ",minmax(0,1fr));gap:8px;";
    data.forEach(period => {
      const panel = document.createElement("div");
      panel.style.cssText = "min-width:0;padding:9px;background:#101b2b;border:1px solid #293d55;border-radius:10px;";
      const title = document.createElement("div");
      title.textContent = period.label;
      title.style.cssText = "font-size:11px;font-weight:900;color:#39e6a5;margin-bottom:7px;";
      panel.appendChild(title);
      period.stats.forEach(item => {
        const row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:5px;align-items:center;padding:5px 0;border-top:1px solid #26384d;";
        const home = document.createElement("strong");
        home.textContent = String(item.home) + item.suffix;
        home.style.cssText = "font-size:11px;color:#baf7df;text-align:left;font-variant-numeric:tabular-nums;";
        const label = document.createElement("span");
        label.textContent = item.label;
        label.style.cssText = "font-size:9px;color:#9fb5cb;text-align:center;";
        const away = document.createElement("strong");
        away.textContent = String(item.away) + item.suffix;
        away.style.cssText = "font-size:11px;color:#c5e7ff;text-align:right;font-variant-numeric:tabular-nums;";
        row.append(home, label, away);
        panel.appendChild(row);
      });
      grid.appendChild(panel);
    });
    target.appendChild(grid);

    const firstHalf = data.find(period => period.key === "1st half");
    const secondHalf = data.find(period => period.key === "2nd half");
    if (firstHalf && secondHalf) {
      const intensityStats = ["Celkové strely", "Strely na bránu", "Rohy"];
      const comparisons = intensityStats.map(label => {
        const first = firstHalf.stats.find(item => item.label === label);
        const second = secondHalf.stats.find(item => item.label === label);
        if (!first || !second) return null;
        const number = value => {
          const parsed = Number(String(value).replace(",", ".").replace(/[^0-9.-]/g, ""));
          return Number.isFinite(parsed) ? parsed : null;
        };
        const values = [number(first.home), number(first.away), number(second.home), number(second.away)];
        if (values.some(value => value === null)) return null;
        return { label, home: values[2] - values[0], away: values[3] - values[1] };
      }).filter(Boolean);
      if (comparisons.length) {
        const subheading = document.createElement("div");
        subheading.textContent = "ZÁMENA INTENZITY · 2. POLČAS VOČI 1.";
        subheading.style.cssText = "font-size:10px;font-weight:900;letter-spacing:.35px;color:#cbd5e1;margin:12px 0 5px;";
        target.appendChild(subheading);
        comparisons.forEach(item => {
          const row = document.createElement("div");
          row.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:6px;align-items:center;padding:6px 8px;margin:4px 0;background:#101b2b;border-radius:7px;";
          const format = value => value > 0 ? "+" + value : String(value);
          const home = document.createElement("strong");
          home.textContent = format(item.home);
          home.style.cssText = "font-size:11px;color:" + (item.home > 0 ? "#39e6a5" : item.home < 0 ? "#fbbf24" : "#94a3b8") + ";";
          const label = document.createElement("span");
          label.textContent = item.label;
          label.style.cssText = "font-size:9px;color:#9fb5cb;text-align:center;";
          const away = document.createElement("strong");
          away.textContent = format(item.away);
          away.style.cssText = "font-size:11px;color:" + (item.away > 0 ? "#7dd3fc" : item.away < 0 ? "#fbbf24" : "#94a3b8") + ";text-align:right;";
          row.append(home, label, away);
          target.appendChild(row);
        });
        addText(target, "Kladná hodnota znamená viac danej štatistiky v 2. polčase; nejde o skóre ani predikciu gólu.", "10px");
      }
    }
    addText(target, "Hodnoty sú samostatné štatistiky daného polčasu, nie odpočítané od celkových hodnôt.", "10px");
  }

  function renderCurrentStats(card, stats, match = null, historyData = null, collectedAt = null) {
    const available = Array.isArray(stats)
      ? stats.map(item => ({
          ...item,
          label: statLabel(item),
          home: item?.home_numeric ?? item?.home ?? item?.home_value ?? null,
          away: item?.away_numeric ?? item?.away ?? item?.away_value ?? null
        })).filter(item =>
          item &&
          String(item.label || "").trim() &&
          (!item.period || String(item.period).trim().toLowerCase() === "match") &&
          item.home !== null &&
          item.home !== undefined &&
          item.away !== null &&
          item.away !== undefined
        )
      : [];

    if (!available.length) {
      addText(card, "Štatistiky zatiaľ nie sú dostupné.");
      return;
    }

    // Celkové strely počítame iba ako SOT + strely mimo brány.
    // Ak API už poskytuje vlastnú položku Total Shots, nep pridávame druhý súčet.
    const findStat = pattern => available.find(item =>
      pattern.test(String(item.label || "").toLowerCase())
    );
    const sot = findStat(/shots? on target|strely na bránu|strely na branu/);
    const offTarget = findStat(/shots? off target|strely mimo bránu|strely mimo branu/);
    const hasTotalShots = available.some(item =>
      /total shots|shots total|celkové strely|celkove strely/i.test(String(item.label || ""))
    );
    const toNumber = value => {
      if (value === null || value === undefined || String(value).trim() === "") return null;
      const parsed = Number(String(value).replace(",", ".").replace(/[^0-9.-]/g, ""));
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    };

    const displayStats = available.slice();
    if (!hasTotalShots && sot && offTarget) {
      const homeSot = toNumber(sot.home);
      const awaySot = toNumber(sot.away);
      const homeOff = toNumber(offTarget.home);
      const awayOff = toNumber(offTarget.away);
      if ([homeSot, awaySot, homeOff, awayOff].every(value => value !== null)) {
        displayStats.unshift({
          label: "Celkové strely (SOT + mimo)",
          home: homeSot + homeOff,
          away: awaySot + awayOff,
          suffix: "",
          derived: true
        });
      }
    }

    // Porovnanie iba s najbližšou predchádzajúcou snímkou toho istého zápasu.
    // Pri medzere nad 15 minút alebo pri poklese kumulatívnych počítadiel zmenu nezobrazujeme.
    let previousStats = null;
    let comparisonMinutes = null;
    const currentTime = Date.parse(collectedAt || "");
    const id = matchId(match);
    if (id && Number.isFinite(currentTime)) {
      const previous = historyRecords(historyData, id)
        .filter(record => record.time < currentTime - 1000)
        .slice(-1)[0];
      if (previous) {
        const gap = (currentTime - previous.time) / 60000;
        const oldStats = previous.match?.stats || previous.match?.flashscore_stats || [];
        if (gap > 0 && gap <= 15 && Array.isArray(oldStats) && oldStats.length) {
          previousStats = oldStats;
          comparisonMinutes = gap;
        }
      }
    }
    const normalizeLabel = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
    const parseStatNumber = value => {
      if (value === null || value === undefined || String(value).trim() === "") return null;
      const parsed = Number(String(value).replace("%", "").replace(",", ".").replace(/[^0-9.-]/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    };

    const heading = document.createElement("div");
    heading.className = "live-stat-heading";
    heading.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) minmax(82px,1.45fr) minmax(0,1fr);gap:7px;padding:4px 5px 8px;font-size:9px;font-weight:900;letter-spacing:.45px;text-align:center;";
    const homeHeading = document.createElement("span");
    const centerHeading = document.createElement("span");
    const awayHeading = document.createElement("span");
    homeHeading.textContent = String(match?.home || "DOMÁCI");
    centerHeading.textContent = "ŠTATISTIKA";
    awayHeading.textContent = String(match?.away || "HOSTIA");
    homeHeading.title = homeHeading.textContent;
    awayHeading.title = awayHeading.textContent;
    homeHeading.style.cssText = "color:#39e6a5;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    centerHeading.style.cssText = "color:#94a3b8;";
    awayHeading.style.cssText = "color:#7dd3fc;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    heading.append(homeHeading, centerHeading, awayHeading);
    card.appendChild(heading);

    displayStats.forEach(item => {
      const row = document.createElement("div");
      row.className = "live-stat-row";
      const isKeyShotStat = /shots? on target|strely na bránu|strely na branu|celkové strely|celkove strely/i.test(String(item.label || ""));
      row.style.cssText = "padding:9px;margin:6px 0;background:" + (isKeyShotStat ? "#14283a" : "#101b2b") + ";border:1px solid " + (isKeyShotStat ? "#32617a" : "#26384f") + ";border-radius:9px;";
      const values = document.createElement("div");
      values.className = "live-stat-values";
      values.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) minmax(82px,1.45fr) minmax(0,1fr);align-items:center;gap:7px;font-size:12px;";
      const home = document.createElement("strong");
      const away = document.createElement("strong");
      const label = document.createElement("span");
      const suffix = item.suffix === null || item.suffix === undefined ? "" : String(item.suffix);
      home.textContent = String(item.home) + suffix;
      away.textContent = String(item.away) + suffix;
      label.textContent = String(item.label);
      home.title = home.textContent;
      away.title = away.textContent;
      home.style.cssText = "display:block;min-width:0;padding:6px 5px;border-radius:7px;background:#103329;border:1px solid #245b49;color:#baf7df;text-align:left;font-size:12px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;";
      away.style.cssText = "display:block;min-width:0;padding:6px 5px;border-radius:7px;background:#122b42;border:1px solid #285477;color:#c5e7ff;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;";
      label.style.cssText = "color:" + (isKeyShotStat ? "#e2f0fb" : "#a8b8cc") + ";text-align:center;font-size:10px;font-weight:" + (isKeyShotStat ? "900" : "700") + ";line-height:1.3;overflow-wrap:anywhere;";
      values.append(home, label, away);
      row.appendChild(values);

      if (previousStats && !item.derived) {
        const oldItem = previousStats.find(candidate =>
          normalizeLabel(candidate?.label || candidate?.name) === normalizeLabel(item.label)
        );
        if (oldItem) {
          const oldHome = parseStatNumber(oldItem.home_numeric ?? oldItem.home);
          const oldAway = parseStatNumber(oldItem.away_numeric ?? oldItem.away);
          const currentHome = parseStatNumber(item.home_numeric ?? item.home);
          const currentAway = parseStatNumber(item.away_numeric ?? item.away);
          const isPossession = /possession|dr[zž]anie lopty/i.test(String(item.label || ""));
          const validHome = oldHome !== null && currentHome !== null && (isPossession || currentHome >= oldHome);
          const validAway = oldAway !== null && currentAway !== null && (isPossession || currentAway >= oldAway);
          if (validHome || validAway) {
            const formatDelta = (current, old, valid) => {
              if (!valid) return "—";
              const delta = Number((current - old).toFixed(1));
              if (delta === 0) return "0";
              return (delta > 0 ? "+" : "") + delta;
            };
            const deltaLine = document.createElement("div");
            const suffix = isPossession ? " p. b." : "";
            deltaLine.textContent =
              "Zmena za " + comparisonMinutes.toFixed(1) + " min: " +
              "domáci " + formatDelta(currentHome, oldHome, validHome) + suffix +
              " · hostia " + formatDelta(currentAway, oldAway, validAway) + suffix;
            deltaLine.style.cssText = "margin-top:6px;padding-top:5px;border-top:1px solid #26384f;font-size:10px;color:#8fb6d9;font-variant-numeric:tabular-nums;";
            row.appendChild(deltaLine);
          }
        }
      }

      const homeText = String(item.home).trim();
      const awayText = String(item.away).trim();
      const numericValue = value => /^\d+(?:[.,]\d+)?\s*%?$/.test(value);
      const h = Number(homeText.replace("%", "").replace(",", "."));
      const a = Number(awayText.replace("%", "").replace(",", "."));
      if (numericValue(homeText) && numericValue(awayText) && Number.isFinite(h) && Number.isFinite(a) && h >= 0 && a >= 0 && h + a > 0) {
        const bar = document.createElement("div");
        bar.style.cssText = "display:flex;gap:3px;height:5px;margin-top:8px;overflow:hidden;border-radius:8px;background:#26384f;";
        const homeBar = document.createElement("div");
        const awayBar = document.createElement("div");
        homeBar.style.cssText = "width:" + (h / (h + a) * 100) + "%;background:#39e6a5;border-radius:8px;";
        awayBar.style.cssText = "width:" + (a / (h + a) * 100) + "%;background:#64748b;border-radius:8px;";
        bar.append(homeBar, awayBar);
        row.appendChild(bar);
      }
      card.appendChild(row);
    });

    if (displayStats.some(item => item.derived)) {
      addText(card, "Celkové strely sú vypočítané zo SOT + striel mimo brány; nejde o samostatnú hodnotu API.", "10px");
    }
  }

  // Kontrola kvality dát je iba informačná; nemení výpočet tlaku ani signálov.
  function getDataQuality(match, collectedAt) {
    const timestamp = Date.parse(collectedAt || "");
    const age = Date.now() - timestamp;

    if (
      !Number.isFinite(timestamp) ||
      age < 0 ||
      age > MAX_DATA_AGE_MS
    ) {
      return {
        status: "STALE",
        label: "ZASTARANÉ DÁTA",
        background: "#7f1d1d",
        border: "#ef4444",
        detail: "Meranie je staršie ako povolený limit alebo nemá platný čas."
      };
    }

    const stats = match?.stats || [];
    const missing = [];
    const sot = statValue(stats, "shots on target");
    const offTarget = statValue(stats, "shots off target");
    const possession = statValue(stats, "possession");
    if (!sot) missing.push("strely na bránu");
    if (!offTarget) missing.push("strely mimo bránu");
    if (!possession) missing.push("držanie lopty");

    if (!sot && !offTarget) {
      return {
        status: "INCOMPLETE",
        label: "CHÝBAJÚ STRELECKÉ DÁTA",
        background: "#78350f",
        border: "#f59e0b",
        detail: "Na výpočet nového momenta zatiaľ chýbajú strely na bránu aj mimo bránu."
      };
    }

    if (missing.length) {
      return {
        status: "PARTIAL",
        label: "ČIASTOČNÉ DÁTA",
        background: "#713f12",
        border: "#eab308",
        detail: "Momentum používa dostupné strelecké údaje. Doplnkové údaje chýbajú: " + missing.join(", ") + "."
      };
    }

    return {
      status: "OK",
      label: "DÁTA KOMPLETNÉ",
      background: "#14532d",
      border: "#39e6a5",
      detail: "Kľúčové štatistiky sú dostupné a meranie je aktuálne."
    };
  }

  function getCollectorHealth(historyData, now = Date.now()) {
    if (!Array.isArray(historyData)) return null;
    const cutoff = now - 86400000;
    const recent = historyData.filter(row => Number.isFinite(Number(row.time)) && Number(row.time) >= cutoff && Number(row.time) <= now);
    const times = [...new Set(recent.map(row => Number(row.time)))].sort((x, y) => x - y);
    if (!times.length) return null;
    const gaps = times.slice(1).map((time, i) => (time - times[i]) / 60000).filter(gap => gap > 0);
    const withStats = recent.filter(row => Array.isArray(row.match?.stats) && row.match.stats.length > 0).length;
    return { total: times.length, complete: withStats, partial: Math.max(0, recent.length - withStats), successRate: Math.round(withStats / Math.max(1, recent.length) * 100), errors: 0, averageGap: gaps.length ? gaps.reduce((x, y) => x + y, 0) / gaps.length : null, maxGap: gaps.length ? Math.max(...gaps) : null };
  }

  // Súhrnná diagnostika pravidelnosti zberača; nemení signály.
  function historyRecords(historyData, id) {
    if (!Array.isArray(historyData) || !id) return [];
    return historyData.filter(row => row?.match && matchId(row.match) === id && Number.isFinite(Number(row.time)) && isLive(row.match)).map(row => ({ time: Number(row.time), match: row.match })).sort((x, y) => x.time - y.time);
  }

  // Časová os priebehu zobrazuje iba skutočne uložené Flashscore LIVE snímky.
  // Neodhaduje udalosti ani nedopĺňa chýbajúce skóre/minúty.
  function renderMatchTimeline(target, match, historyData, collectedAt) {
    const id = matchId(match);
    if (!id) {
      addText(target, "Časová os čaká na identifikátor zápasu.");
      return;
    }
    const records = historyRecords(historyData, id).slice();
    const currentTime = Date.parse(collectedAt || "");
    if (Number.isFinite(currentTime) && !records.some(row => Math.abs(row.time - currentTime) < 1000)) {
      records.push({ time: currentTime, match });
    }
    records.sort((a, b) => a.time - b.time);
    const valid = records.filter(row =>
      row.match &&
      row.match.home_score !== null && row.match.home_score !== undefined &&
      row.match.away_score !== null && row.match.away_score !== undefined
    );
    if (!valid.length) {
      addText(target, "Zatiaľ nie sú dostupné uložené LIVE snímky so skóre.");
      return;
    }
    const limit = 8;
    const selected = valid.length <= limit
      ? valid
      : Array.from({ length: limit }, (_, index) => valid[Math.round(index * (valid.length - 1) / (limit - 1))]);
    const rail = document.createElement("div");
    rail.className = "match-timeline-rail";
    rail.style.cssText = "display:grid;grid-template-columns:repeat(" + selected.length + ",minmax(0,1fr));gap:6px;align-items:stretch;";
    selected.forEach((record, index) => {
      const snapshot = record.match;
      const point = document.createElement("div");
      point.className = "match-timeline-point";
      point.style.cssText = "min-width:0;padding:8px 5px;text-align:center;background:#101f31;border:1px solid #29435f;border-radius:9px;position:relative;";
      const minuteValue = snapshot.live_minute ?? snapshot.minute ?? snapshot.status_text ?? snapshot.stage ?? "";
      const minute = String(minuteValue).trim();
      const clock = document.createElement("div");
      clock.textContent = minute ? (/HT|FT|PEN|AET/i.test(minute) ? minute : minute.replace(/[^0-9+]/g, "") + "′") : "—";
      clock.style.cssText = "font-size:10px;color:#9fb5cb;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      const score = document.createElement("div");
      score.textContent = String(snapshot.home_score) + ":" + String(snapshot.away_score);
      score.style.cssText = "font-size:14px;font-weight:900;color:#e2f0fb;font-variant-numeric:tabular-nums;margin:5px 0;";
      const stamp = document.createElement("div");
      stamp.textContent = new Date(record.time).toLocaleTimeString("sk-SK", { hour:"2-digit", minute:"2-digit" });
      stamp.style.cssText = "font-size:9px;color:#7892ac;font-variant-numeric:tabular-nums;";
      point.append(clock, score, stamp);
      if (index === selected.length - 1) {
        point.style.borderColor = "#2c8b6b";
        point.style.background = "#102b29";
      }
      rail.appendChild(point);
    });
    target.appendChild(rail);
    addText(target, "Zobrazených " + selected.length + " z " + valid.length + " uložených meraní · posledné meranie je zvýraznené.", "10px");
    if (flashscoreRecentHistoryStatus.state === "ERROR") {
      addText(target, "⚠ Archívna časová os sa nenačítala: " + flashscoreRecentHistoryStatus.error, "10px");
    } else if (flashscoreRecentHistoryStatus.state === "READY") {
      addText(target, "Archív načítaný: " + flashscoreRecentHistoryStatus.count + " snímok zo všetkých zápasov · spárované snímky tohto zápasu: " + records.length + ".", "10px");
    }

    // Aktivita v intervaloch sa odvodzuje iba z rozdielov dvoch susedných
    // kumulatívnych Flashscore snímok; dlhé medzery a resetované počítadlá vynecháme.
    const intervalDefinitions = [
      { start: 1, end: 15, label: "01–15′" },
      { start: 16, end: 30, label: "16–30′" },
      { start: 31, end: 45, label: "31–45′" },
      { start: 46, end: 60, label: "46–60′" },
      { start: 61, end: 75, label: "61–75′" },
      { start: 76, end: 90, label: "76–90′" },
      { start: 91, end: 120, label: "90+′" }
    ];
    const statDefinitions = [
      { key: "shots", label: "Strely" , test: /total shots|shots total|celkové strely|celkove strely/i },
      { key: "sot", label: "Na bránu", test: /shots on target|strely na bránu|strely na branu/i },
      { key: "corners", label: "Rohy", test: /corner kicks|corners|rohov/i }
    ];
    const intervalTotals = new Map();
    let validIntervals = 0;
    const activityDiagnostics = {
      adjacentPairs: Math.max(0, records.length - 1),
      momentumWindowPairs: 0,
      activityWindowPairs: 0,
      gapOver7: 0,
      gapOver15: 0,
      invalidGap: 0,
      missingMinute: 0,
      halfTimePairs: 0,
      finishedOrPenaltiesPairs: 0,
      crossedBucketPairs: 0,
      unknownStartMinutePairs: 0,
      missingInterval: 0,
      noUsableStats: 0,
      partialStats: 0,
      missingMetricValues: 0,
      resetMetricValues: 0
    };
    const minuteOf = snapshot => {
      const raw = snapshot?.live_minute ?? snapshot?.minute ?? snapshot?.live_clock;
      if (raw === null || raw === undefined || String(raw).trim() === "") return null;
      if (typeof raw === "number") {
        return Number.isInteger(raw) && raw >= 0 && raw <= 120 ? raw : null;
      }
      const text = String(raw).trim().toUpperCase();
      // Prestávka/koniec zápasu nie sú číselná minúta. Neodvodzujeme ju zo skóre ani fázy.
      if (/^(?:HT|HALF.?TIME|BREAK|FT|FULL.?TIME|AET|PEN(?:ALTIES)?)$/.test(text)) return null;
      let parsed = null;
      const stoppage = text.match(/^(\d{1,3})\s*\+\s*(\d{1,2})\s*(?:['′]|MIN(?:UTE)?|MINÚTA)?$/);
      if (stoppage) {
        parsed = Number(stoppage[1]) + Number(stoppage[2]);
      } else {
        const regular = text.match(/^(\d{1,3})(?::\d{2})?\s*(?:['′]|MIN(?:UTE)?|MINÚTA)?$/);
        if (regular) parsed = Number(regular[1]);
      }
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 120 ? parsed : null;
    };
    const activityIntervalForPair = (previousMinute, currentMinute, definitions) => {
      if (previousMinute === null || previousMinute === undefined) {
        return { interval: null, reason: "unknown-start-minute" };
      }
      if (currentMinute === null || currentMinute === undefined) {
        return { interval: null, reason: "unknown-current-minute" };
      }
      // Nulová minúta je platný začiatok zápasu: krátky prvý interval možno zaradiť do 01–15.
      const previousInterval = previousMinute === 0
        ? definitions.find(item => item.start === 1 && item.end === 15)
        : definitions.find(item => previousMinute >= item.start && previousMinute <= item.end);
      const currentInterval = definitions.find(item => currentMinute >= item.start && currentMinute <= item.end);
      if (!previousInterval || !currentInterval) {
        return { interval: null, reason: "outside-defined-intervals" };
      }
      if (previousInterval.label !== currentInterval.label) {
        return { interval: null, reason: "crosses-interval-boundary" };
      }
      return { interval: currentInterval, reason: null };
    };
    const statNumber = value => {
      const parsed = Number(String(value ?? "").replace(",", ".").replace(/[^0-9.-]/g, ""));
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    };
    const getCumulativeStat = (snapshot, definition) => {
      const stats = Array.isArray(snapshot?.stats) ? snapshot.stats : [];
      const item = stats.find(stat =>
        (!stat.period || String(stat.period).trim().toLowerCase() === "match") &&
        definition.test.test(statLabel(stat))
      );
      if (!item) return null;
      const home = statNumber(item.home_numeric ?? item.home);
      const away = statNumber(item.away_numeric ?? item.away);
      return home === null || away === null ? null : { home, away };
    };
    for (let index = 1; index < records.length; index++) {
      const previous = records[index - 1];
      const current = records[index];
      const gap = (current.time - previous.time) / 60000;
      if (!Number.isFinite(gap) || gap <= 0) {
        activityDiagnostics.invalidGap++;
        continue;
      }
      if (gap >= 1.5 && gap <= 15) activityDiagnostics.momentumWindowPairs++;
      if (gap > 7) activityDiagnostics.gapOver7++;
      if (gap > 15) activityDiagnostics.gapOver15++;
      if (gap > 0 && gap <= 7) activityDiagnostics.activityWindowPairs++;
      const minute = minuteOf(current.match);
      if (gap > 7 || minute === null) {
        if (minute === null && gap <= 7) {
          const match = current.match || {};
          const clockText = String(match.live_minute ?? match.minute ?? match.live_clock ?? "").trim().toUpperCase();
          const stageText = String(match.stage || match.status_text || "").trim().toUpperCase();
          const isHalfTime = /^(?:HT|HALF.?TIME|BREAK)$/.test(clockText) || /HALF.?TIME|HALF TIME|PRESTÁVKA|PRESTAVKA/.test(stageText);
          const isFinished = /^(?:FT|FULL.?TIME|AET|PEN(?:ALTIES)?)$/.test(clockText) || /FINISHED|FULL.?TIME|AFTER.?EXTRA|PENALT/.test(stageText);
          if (isHalfTime) {
            activityDiagnostics.halfTimePairs++;
          } else if (isFinished) {
            activityDiagnostics.finishedOrPenaltiesPairs++;
          } else {
            activityDiagnostics.missingMinute++;
            const rawClock = value => value === null || value === undefined || String(value).trim() === "" ? "—" : String(value).trim();
            if (!activityDiagnostics.missingMinuteSamples) activityDiagnostics.missingMinuteSamples = [];
            if (activityDiagnostics.missingMinuteSamples.length < 5) {
              activityDiagnostics.missingMinuteSamples.push({
                at: new Date(current.time).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" }),
                liveMinute: rawClock(match.live_minute),
                minute: rawClock(match.minute),
                liveClock: rawClock(match.live_clock),
                stage: rawClock(match.stage || match.status_text),
                diagnostic: rawClock(match.clock_diagnostic),
                coreMinute: rawClock(match.core_minute_raw)
              });
            }
          }
        }
        continue;
      }
      const previousMinute = minuteOf(previous.match);
      const attribution = activityIntervalForPair(previousMinute, minute, intervalDefinitions);
      if (!attribution.interval) {
        if (attribution.reason === "crosses-interval-boundary") {
          activityDiagnostics.crossedBucketPairs++;
        } else if (attribution.reason === "unknown-start-minute") {
          activityDiagnostics.unknownStartMinutePairs++;
        } else {
          activityDiagnostics.missingInterval++;
        }
        continue;
      }
      const interval = attribution.interval;
      const deltas = {};
      let hasDelta = false;
      let missingMetricValues = 0;
      let resetMetricValues = 0;
      statDefinitions.forEach(definition => {
        const oldValue = getCumulativeStat(previous.match, definition);
        const newValue = getCumulativeStat(current.match, definition);
        if (!oldValue || !newValue) {
          missingMetricValues++;
          return;
        }
        if (newValue.home < oldValue.home || newValue.away < oldValue.away) {
          resetMetricValues++;
          return;
        }
        deltas[definition.key] = {
          home: newValue.home - oldValue.home,
          away: newValue.away - oldValue.away
        };
        hasDelta = true;
      });
      activityDiagnostics.missingMetricValues += missingMetricValues;
      activityDiagnostics.resetMetricValues += resetMetricValues;
      if (hasDelta && (missingMetricValues || resetMetricValues)) activityDiagnostics.partialStats++;
      if (!hasDelta) {
        activityDiagnostics.noUsableStats++;
        continue;
      }
      if (!intervalTotals.has(interval.label)) {
        intervalTotals.set(interval.label, { ...interval, count: 0, values: {} });
      }
      const total = intervalTotals.get(interval.label);
      total.count++;
      Object.entries(deltas).forEach(([key, value]) => {
        if (!total.values[key]) total.values[key] = { home: 0, away: 0 };
        total.values[key].home += value.home;
        total.values[key].away += value.away;
      });
      validIntervals++;
    }
    activityDiagnostics.validIntervals = validIntervals;
    const intervalHeading = document.createElement("div");
    intervalHeading.textContent = "AKTIVITA V ČASOVÝCH ÚSEKOCH";
    intervalHeading.style.cssText = "font-size:11px;font-weight:900;color:#dbeafe;margin:14px 0 7px;";
    target.appendChild(intervalHeading);
    const intervalRows = [...intervalTotals.values()].sort((a, b) => a.start - b.start);
    const diagnosticPanel = document.createElement("div");
    diagnosticPanel.style.cssText = "padding:8px 9px;margin:7px 0 10px;background:#0d1a2a;border:1px solid #30445d;border-radius:8px;";
    const diagnosticTitle = document.createElement("div");
    diagnosticTitle.textContent = "KONTROLA PÁROVANIA MERANÍ";
    diagnosticTitle.style.cssText = "font-size:10px;font-weight:900;color:#cbd5e1;margin-bottom:5px;";
    diagnosticPanel.appendChild(diagnosticTitle);
    addText(diagnosticPanel,
      "Susedné dvojice: " + activityDiagnostics.adjacentPairs +
      " | okno Momentum 1,5–15 min: " + activityDiagnostics.momentumWindowPairs +
      " | okno aktivity do 7 min: " + activityDiagnostics.activityWindowPairs,
      "10px");
    addText(diagnosticPanel,
      "Vynechané: medzera nad 7 min " + activityDiagnostics.gapOver7 +
      " (z toho nad 15 min " + activityDiagnostics.gapOver15 + ")" +
      " | prestávka HT " + activityDiagnostics.halfTimePairs +
      " | koniec/penalty " + activityDiagnostics.finishedOrPenaltiesPairs +
      " | skutočne bez minúty " + activityDiagnostics.missingMinute +
      " | prechod cez hranicu úseku " + activityDiagnostics.crossedBucketPairs +
      " | neznáma začiatočná minúta " + activityDiagnostics.unknownStartMinutePairs +
      " | bez použiteľnej štatistiky " + activityDiagnostics.noUsableStats,
      "10px");
    addText(diagnosticPanel,
      "Čiastočne neúplné dvojice " + activityDiagnostics.partialStats +
      " | chýbajúce hodnoty metrík " + activityDiagnostics.missingMetricValues +
      " | resetované hodnoty metrík " + activityDiagnostics.resetMetricValues +
      " | zarátané intervaly aktivity " + activityDiagnostics.validIntervals + ".",
      "10px");
    addText(diagnosticPanel,
      "Okno Momentum je iba časové porovnanie párov; jeho platnosť navyše vyžaduje úplné strelecké štatistiky. Aktivita používa prísnejšiu hranicu najviac 7 minút.",
      "9px");
    if (activityDiagnostics.missingMinuteSamples?.length) {
      addText(diagnosticPanel, "UKÁŽKA SNÍMOK BEZ ROZPOZNANEJ MINÚTY (max. 5):", "9px");
      activityDiagnostics.missingMinuteSamples.forEach(sample => {
        addText(diagnosticPanel,
          sample.at + " · live_minute=" + sample.liveMinute +
          " · minute=" + sample.minute +
          " · live_clock=" + sample.liveClock +
          " · stage=" + sample.stage +
          " · clock=" + sample.diagnostic +
          " · core=" + sample.coreMinute,
          "9px");
      });
    }
    target.appendChild(diagnosticPanel);
    if (!intervalRows.length) {
      addText(target, "Pre časové úseky zatiaľ nie je dosť susedných snímok s platnými kumulatívnymi štatistikami.", "10px");
    } else {
      intervalRows.forEach(interval => {
        const panel = document.createElement("div");
        panel.style.cssText = "padding:8px 9px;margin:5px 0;background:#101f31;border:1px solid #293d55;border-radius:8px;";
        const title = document.createElement("div");
        title.textContent = interval.label + " · " + interval.count + (interval.count === 1 ? " platný interval merania" : " platné intervaly merania");
        title.style.cssText = "font-size:10px;font-weight:900;color:#9fb5cb;margin-bottom:5px;";
        panel.appendChild(title);
        statDefinitions.forEach(definition => {
          const value = interval.values[definition.key];
          if (!value) return;
          const row = document.createElement("div");
          row.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:6px;padding:3px 0;";
          const home = document.createElement("strong");
          home.textContent = "+" + value.home;
          home.style.cssText = "font-size:11px;color:#baf7df;";
          const label = document.createElement("span");
          label.textContent = definition.label;
          label.style.cssText = "font-size:9px;color:#9fb5cb;text-align:center;";
          const away = document.createElement("strong");
          away.textContent = "+" + value.away;
          away.style.cssText = "font-size:11px;color:#c5e7ff;text-align:right;";
          row.append(home, label, away);
          panel.appendChild(row);

          const maximum = Math.max(value.home, value.away, 1);
          const bars = document.createElement("div");
          bars.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:3px;margin:2px 0 7px;align-items:center;";
          const homeTrack = document.createElement("div");
          homeTrack.style.cssText = "height:6px;background:#26384d;border-radius:5px;overflow:hidden;display:flex;justify-content:flex-end;";
          const homeFill = document.createElement("div");
          homeFill.style.cssText = "height:100%;width:" + (value.home / maximum * 100) + "%;background:#39e6a5;border-radius:5px 0 0 5px;";
          homeTrack.appendChild(homeFill);
          const awayTrack = document.createElement("div");
          awayTrack.style.cssText = "height:6px;background:#26384d;border-radius:5px;overflow:hidden;";
          const awayFill = document.createElement("div");
          awayFill.style.cssText = "height:100%;width:" + (value.away / maximum * 100) + "%;background:#7dd3fc;border-radius:0 5px 5px 0;";
          awayTrack.appendChild(awayFill);
          bars.append(homeTrack, awayTrack);
          panel.appendChild(bars); 
        });
        target.appendChild(panel);
      });
      const trendHeading = document.createElement("div");
      trendHeading.textContent = "VÝVOJ AKTIVITY POČAS ZÁPASU";
      trendHeading.style.cssText = "font-size:11px;font-weight:900;color:#dbeafe;margin:14px 0 7px;";
      target.appendChild(trendHeading);
      const trendLegend = document.createElement("div");
      trendLegend.textContent = "🟢 Domáci   🔵 Hostia";
      trendLegend.style.cssText = "font-size:9px;color:#9fb5cb;margin-bottom:7px;";
      target.appendChild(trendLegend);
      statDefinitions.forEach(definition => {
        const points = intervalRows.filter(interval => interval.values[definition.key]);
        if (!points.length) return;
        const maximum = Math.max(1, ...points.map(interval => Math.max(interval.values[definition.key].home, interval.values[definition.key].away)));
        const metricPanel = document.createElement("div");
        metricPanel.style.cssText = "padding:8px 9px;margin:6px 0;background:#101f31;border:1px solid #293d55;border-radius:8px;";
        const metricTitle = document.createElement("div");
        metricTitle.textContent = definition.label.toUpperCase();
        metricTitle.style.cssText = "font-size:10px;font-weight:900;color:#dbeafe;margin-bottom:7px;";
        metricPanel.appendChild(metricTitle);
        points.forEach(interval => {
          const value = interval.values[definition.key];
          const point = document.createElement("div");
          point.style.cssText = "display:grid;grid-template-columns:42px minmax(0,1fr) 38px;gap:6px;align-items:center;margin:5px 0;";
          const time = document.createElement("span");
          time.textContent = interval.label;
          time.style.cssText = "font-size:9px;color:#9fb5cb;";
          const tracks = document.createElement("div");
          tracks.style.cssText = "display:grid;gap:3px;";
          const homeTrack = document.createElement("div");
          homeTrack.style.cssText = "height:5px;background:#26384d;border-radius:5px;overflow:hidden;display:flex;justify-content:flex-end;";
          const homeFill = document.createElement("div");
          homeFill.style.cssText = "height:100%;width:" + (value.home / maximum * 100) + "%;background:#39e6a5;border-radius:5px;";
          homeTrack.appendChild(homeFill);
          const awayTrack = document.createElement("div");
          awayTrack.style.cssText = "height:5px;background:#26384d;border-radius:5px;overflow:hidden;";
          const awayFill = document.createElement("div");
          awayFill.style.cssText = "height:100%;width:" + (value.away / maximum * 100) + "%;background:#7dd3fc;border-radius:5px;";
          awayTrack.appendChild(awayFill);
          tracks.append(homeTrack, awayTrack);
          const numbers = document.createElement("span");
          numbers.textContent = value.home + ":" + value.away;
          numbers.style.cssText = "font-size:9px;color:#e2e8f0;text-align:right;font-variant-numeric:tabular-nums;";
          point.append(time, tracks, numbers);
          metricPanel.appendChild(point);
        });
        target.appendChild(metricPanel);
      });
      const summary = document.createElement("div");
      summary.style.cssText = "padding:9px 10px;margin:9px 0;background:#13283a;border:1px solid #36516b;border-radius:9px;";
      const summaryTitle = document.createElement("div");
      summaryTitle.textContent = "SÚHRN POZOROVANEJ AKTIVITY";
      summaryTitle.style.cssText = "font-size:10px;font-weight:900;color:#e2e8f0;margin-bottom:6px;";
      summary.appendChild(summaryTitle);
      let summaryMetrics = 0;
      statDefinitions.forEach(definition => {
        const totals = intervalRows.reduce((acc, interval) => {
          const value = interval.values[definition.key];
          if (value) {
            acc.home += value.home;
            acc.away += value.away;
            acc.bins++;
          }
          return acc;
        }, { home: 0, away: 0, bins: 0 });
        if (!totals.bins) return;
        summaryMetrics++;
        const line = document.createElement("div");
        line.style.cssText = "display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-top:1px solid #294257;font-size:10px;";
        const metric = document.createElement("strong");
        metric.textContent = definition.label + " · " + totals.home + ":" + totals.away;
        metric.style.cssText = "color:#e2e8f0;";
        const leader = document.createElement("span");
        leader.textContent = totals.home === totals.away ? "Vyrovnané" : (totals.home > totals.away ? "Viac domáci" : "Viac hostia");
        leader.style.cssText = "font-weight:800;color:" + (totals.home === totals.away ? "#cbd5e1" : (totals.home > totals.away ? "#39e6a5" : "#7dd3fc")) + ";text-align:right;";
        line.append(metric, leader);
        summary.appendChild(line);
      });
      if (summaryMetrics) {
        target.appendChild(summary);
        addText(target, "Súčet zahŕňa iba platné pozorované prírastky v zobrazených úsekoch. Každá štatistika sa hodnotí samostatne; nejde o predikciu gólu ani stávkový signál.", "10px");
      }
      addText(target, "Prírastky sa započítajú iba pri susedných snímkach s odstupom najviac 7 minút, ak obe časové značky patria do rovnakého 15-minútového úseku. Prechody cez hranicu úseku a neznámy začiatok sa vynechávajú; aktivita medzi meraniami sa nedá presne rozdeliť.", "10px");
    }

    // Odvodené góly vznikajú iba pri preukázateľnom zvýšení skóre medzi dvoma uloženými snímkami.
    // Ich čas je interval meraní, nikdy nie vymyslená presná minúta.
    const deriveScoreChanges = (rows, officialEvents = []) => {
      const parseMinute = value => {
        const match = String(value ?? "").match(/(\\d+)(?:\\s*\\+\\s*(\\d+))?/);
        if (!match) return null;
        const minute = Number(match[1]) + Number(match[2] || 0);
        return Number.isFinite(minute) ? minute : null;
      };
      const formatMinute = value => String(value) + "′";
      const derived = [];
      for (let index = 1; index < rows.length; index++) {
        const previous = rows[index - 1];
        const current = rows[index];
        if (!previous?.match || !current?.match || !(Number(current.time) > Number(previous.time))) continue;
        const previousHome = Number(previous.match.home_score);
        const previousAway = Number(previous.match.away_score);
        const currentHome = Number(current.match.home_score);
        const currentAway = Number(current.match.away_score);
        if (![previousHome, previousAway, currentHome, currentAway].every(Number.isInteger)) continue;
        const homeDelta = currentHome - previousHome;
        const awayDelta = currentAway - previousAway;
        if (homeDelta < 0 || awayDelta < 0 || homeDelta + awayDelta === 0) continue;
        const previousMinute = parseMinute(previous.match.live_minute ?? previous.match.minute);
        const currentMinute = parseMinute(current.match.live_minute ?? current.match.minute);
        if (previousMinute !== null && currentMinute !== null && currentMinute < previousMinute) continue;
        const hasOfficialGoalInRange = officialEvents.some(event => {
          if (event.kind !== "⚽ Gól" && event.kind !== "⚽ Penalta") return false;
          const eventMinute = parseMinute(event.minute);
          return eventMinute !== null && previousMinute !== null && currentMinute !== null && eventMinute >= previousMinute && eventMinute <= currentMinute;
        });
        if (hasOfficialGoalInRange) continue;
        const clock = value => new Date(Number(value)).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" });
        const range = previousMinute !== null && currentMinute !== null
          ? "medzi " + formatMinute(previousMinute) + "–" + formatMinute(currentMinute)
          : "medzi " + clock(previous.time) + "–" + clock(current.time);
        const score = previousHome + ":" + previousAway + " → " + currentHome + ":" + currentAway;
        const homeName = String(current.match.home || current.match.home_name || "Domáci");
        const awayName = String(current.match.away || current.match.away_name || "Hostia");
        if (homeDelta > 0) derived.push({ kind: "⚽ Gól (odvodený zo skóre)", minute: range, detail: homeName + " · +" + homeDelta + " · skóre " + score, time: currentMinute ?? Number(current.time) / 60000, derived: true });
        if (awayDelta > 0) derived.push({ kind: "⚽ Gól (odvodený zo skóre)", minute: range, detail: awayName + " · +" + awayDelta + " · skóre " + score, time: currentMinute ?? Number(current.time) / 60000, derived: true });
      }
      return derived;
    };

    // Incidenty sa čítajú iba z polí, ktoré sú skutočne uložené vo Flashscore snímkach.
    const sources = [...records.map(row => row.match), match];
    const found = new Map();
    const walk = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 7) return;
      if (Array.isArray(value)) {
        value.forEach(item => walk(item, depth + 1));
        return;
      }
      if (Array.isArray(value.incidents)) value.incidents.forEach(event => {
        if (!event || typeof event !== "object") return;
        const rawType = String(event.type || event.type_name || event.incident_type || event.type_id || "").trim();
        const rawText = String(event.text || event.description || event.name || "").trim();
        const combined = (rawType + " " + rawText).toLowerCase();
        let kind = "";
        if (/goal|gól|score/.test(combined)) kind = "⚽ Gól";
        else if (/red.?card|červená|red card/.test(combined)) kind = "🟥 Červená karta";
        else if (/yellow.?card|žltá|yellow card/.test(combined)) kind = "🟨 Žltá karta";
        else if (/substitution|stried|substitut/.test(combined)) kind = "🔄 Striedanie";
        else if (/penalty|penalta/.test(combined)) kind = "⚽ Penalta";
        else if (/var/.test(combined)) kind = "📺 VAR";
        else kind = rawType || rawText;
        if (!kind) return;
        const minuteRaw = event.time ?? event.minute ?? event.elapsed ?? event.match_time ?? "";
        const minute = String(minuteRaw).trim();
        const player = String(event.player || event.player_name || event.scorer || event.name || "").trim();
        const assist = String(event.assist || event.assist_player || "").trim();
        const team = String(event.team || event.team_name || event.participant_name || "").trim();
        const detail = [player, assist && "asistencia: " + assist, team].filter(Boolean).join(" · ");
        const key = [kind, minute, player, team, rawText].join("|").toLowerCase();
        if (!found.has(key)) found.set(key, { kind, minute, detail, time: Number(minuteRaw) || 0 });
      });
      Object.values(value).forEach(child => {
        if (child && typeof child === "object") walk(child, depth + 1);
      });
    };
    sources.forEach(source => walk(source));
    const officialEvents = [...found.values()];
    const derivedEvents = deriveScoreChanges(valid, officialEvents);
    const events = [...officialEvents, ...derivedEvents].sort((a, b) => a.time - b.time).slice(0, 12);
    const eventHeading = document.createElement("div");
    eventHeading.textContent = "ZACHYTENÉ A ODVODENÉ UDALOSTI ZÁPASU";
    eventHeading.style.cssText = "font-size:11px;font-weight:900;color:#dbeafe;margin:14px 0 7px;";
    target.appendChild(eventHeading);
    if (!events.length) {
      addText(target, "Flashscore zatiaľ neposkytol uložené udalosti a v uložených snímkach sa nezistila zmena skóre.", "10px");
    } else {
      events.forEach(event => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:flex-start;gap:9px;padding:8px 9px;margin:5px 0;background:#101f31;border:1px solid #293d55;border-radius:8px;";
        const minute = document.createElement("strong");
        minute.textContent = event.minute ? event.minute + (/[0-9]/.test(event.minute) && !/[′']/.test(event.minute) ? "′" : "") : "—";
        minute.style.cssText = "min-width:32px;color:#9fb5cb;font-size:11px;";
        const description = document.createElement("div");
        description.style.cssText = "min-width:0;font-size:11px;color:#e2e8f0;font-weight:800;";
        const label = document.createElement("div");
        label.textContent = event.kind;
        description.appendChild(label);
        if (event.detail) {
          const extra = document.createElement("div");
          extra.textContent = event.detail;
          extra.style.cssText = "font-size:10px;color:#94a3b8;font-weight:500;margin-top:3px;overflow-wrap:anywhere;";
          description.appendChild(extra);
        }
        row.append(minute, description);
        target.appendChild(row);
      });
    }

    const goalEvents = events.filter(event => event.kind === "⚽ Gól" || event.kind === "⚽ Penalta");
    if (goalEvents.length) {
      const goalHeading = document.createElement("div");
      goalHeading.textContent = "GÓLY A OKOLITÁ AKTIVITA";
      goalHeading.style.cssText = "font-size:11px;font-weight:900;color:#dbeafe;margin:14px 0 7px;";
      target.appendChild(goalHeading);
      const snapshotMinute = snapshot => {
        const raw = snapshot?.live_minute ?? snapshot?.minute;
        const match = String(raw ?? "").match(/\d+/);
        return match ? Number(match[0]) : null;
      };
      const readMetric = (snapshot, pattern) => {
        const stats = Array.isArray(snapshot?.stats) ? snapshot.stats : [];
        const item = stats.find(stat =>
          (!stat.period || String(stat.period).trim().toLowerCase() === "match") &&
          pattern.test(statLabel(stat))
        );
        if (!item) return null;
        const home = Number(String(item.home_numeric ?? item.home ?? "").replace(/[^0-9.-]/g, ""));
        const away = Number(String(item.away_numeric ?? item.away ?? "").replace(/[^0-9.-]/g, ""));
        return Number.isFinite(home) && Number.isFinite(away) ? { home, away } : null;
      };
      goalEvents.forEach(goal => {
        const goalMinuteMatch = String(goal.minute || "").match(/\d+/);
        const goalMinute = goalMinuteMatch ? Number(goalMinuteMatch[0]) : goal.time;
        const card = document.createElement("div");
        card.style.cssText = "padding:8px 9px;margin:5px 0;background:#101f31;border:1px solid #36516b;border-radius:8px;";
        const heading = document.createElement("div");
        heading.textContent = (goal.minute || "Čas neznámy") + " · " + (goal.detail || "Gól");
        heading.style.cssText = "font-size:10px;font-weight:900;color:#e2e8f0;margin-bottom:5px;";
        card.appendChild(heading);
        const before = [...valid].filter(row => {
          const minute = snapshotMinute(row.match);
          // Snimka v rovnakej minúte nemusí byť jednoznačne pred gólom.
          return minute !== null && goalMinute !== null && minute < goalMinute && goalMinute - minute <= 8;
        }).sort((a, b) => snapshotMinute(b.match) - snapshotMinute(a.match))[0];
        const after = [...valid].filter(row => {
          const minute = snapshotMinute(row.match);
          // Za "po góle" považujeme až snímku z nasledujúcej minúty.
          return minute !== null && goalMinute !== null && minute > goalMinute && minute - goalMinute <= 8;
        }).sort((a, b) => snapshotMinute(a.match) - snapshotMinute(b.match))[0];
        if (before && after && before !== after) {
          const definitions = [
            { label: "Strely", pattern: /total shots|shots total|celkové strely|celkove strely/i },
            { label: "Na bránu", pattern: /shots on target|strely na bránu|strely na branu/i },
            { label: "Rohy", pattern: /corners|rohov[eé] kopy|rohy/i }
          ];
          const comparison = document.createElement("div");
          comparison.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:7px;";
          const teamPanels = [
            { key: "home", label: "DOMÁCI", color: "#39e6a5" },
            { key: "away", label: "HOSTIA", color: "#7dd3fc" }
          ];
          const teamRows = teamPanels.map(team => {
            const panel = document.createElement("div");
            panel.style.cssText = "min-width:0;padding:7px;background:#0b1726;border:1px solid #293d55;border-radius:7px;";
            const title = document.createElement("div");
            title.textContent = team.label;
            title.style.cssText = "font-size:9px;font-weight:900;color:" + team.color + ";margin-bottom:4px;";
            panel.appendChild(title);
            return { ...team, panel };
          });
          let availableMetrics = 0;
          definitions.forEach(definition => {
            const oldValue = readMetric(before.match, definition.pattern);
            const newValue = readMetric(after.match, definition.pattern);
            if (!oldValue || !newValue || newValue.home < oldValue.home || newValue.away < oldValue.away) return;
            availableMetrics++;
            const homeDelta = newValue.home - oldValue.home;
            const awayDelta = newValue.away - oldValue.away;
            const row = document.createElement("div");
            row.textContent = definition.label + " · pred " + oldValue.home + ":" + oldValue.away + " → po " + newValue.home + ":" + newValue.away;
            row.style.cssText = "font-size:9px;color:#b7c8d9;padding:3px 0;border-bottom:1px solid #293d55;";
            card.appendChild(row);
            teamRows.forEach(team => {
              const value = team.key === "home" ? homeDelta : awayDelta;
              const detail = document.createElement("div");
              detail.textContent = definition.label + "  +" + value;
              detail.style.cssText = "font-size:9px;color:#cbd5e1;padding:2px 0;";
              team.panel.appendChild(detail);
            });
          });
          if (availableMetrics) {
            teamRows.forEach(team => comparison.appendChild(team.panel));
            card.appendChild(comparison);
          } else {
            const unavailable = document.createElement("div");
            unavailable.textContent = "Porovnateľné štatistiky sa v oboch snímkach nenašli alebo sa počítadlá resetovali.";
            unavailable.style.cssText = "font-size:9px;color:#fbbf24;padding:4px 0;";
            card.appendChild(unavailable);
          }
          const range = document.createElement("div");
          range.textContent = "Porovnanie snímok " + (snapshotMinute(before.match) || "—") + "′ až " + (snapshotMinute(after.match) || "—") + "′";
          range.style.cssText = "font-size:9px;color:#7892ac;margin-top:3px;";
          card.appendChild(range);
        } else {
          const missing = document.createElement("div");
          missing.textContent = "Nie sú dostupné vhodné snímky do 8 minút pred aj po udalosti.";
          missing.style.cssText = "font-size:9px;color:#9fb5cb;";
          card.appendChild(missing);
        }
        target.appendChild(card);
      });
      addText(target, "Ide o zmenu kumulatívnych štatistík medzi najbližšími dostupnými snímkami pred a po góle. Časová súvislosť neznamená, že gól zmenu aktivity spôsobil.", "10px");
    }
  }

  // Historická kontinuita dát pre konkrétny zápas.
  // Ide iba o diagnostiku; nemení tlak, Momentum ani generovanie signálov.
  function getMatchReliability(match, historyData, collectedAt) {
    const id = matchId(match);
    if (!id) return null;

    const snapshots = historyRecords(historyData, id);
    const currentTime = Date.parse(collectedAt || "");

    if (
      Number.isFinite(currentTime) &&
      !snapshots.some(item => Math.abs(item.time - currentTime) < 1000)
    ) {
      snapshots.push({ time: currentTime, match });
    }

    snapshots.sort((a, b) => a.time - b.time);

    const unique = snapshots.filter((item, index) =>
      index === 0 || item.time !== snapshots[index - 1].time
    );

    if (!unique.length) return null;

    let momentumReady = 0;
    let allStatsReady = 0;

    unique.forEach(item => {
      const stats = item.match?.stats || [];
      const hasShots = !!statValue(stats, "shots on target");
      const hasAttacks = !!statValue(stats, "shots off target");
      const hasPossession = !!statValue(stats, "possession");

      if (hasShots && hasAttacks) momentumReady++;
      if (hasShots && hasAttacks && hasPossession) allStatsReady++;
    });

    const gaps = [];
    for (let i = 1; i < unique.length; i++) {
      const minutes = (unique[i].time - unique[i - 1].time) / 60000;
      if (Number.isFinite(minutes) && minutes > 0) gaps.push(minutes);
    }

    const averageGap = gaps.length
      ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length
      : null;
    const maxGap = gaps.length ? Math.max(...gaps) : null;
    const longGaps = gaps.filter(value => value > 7).length;
    const momentumCoverage = Math.round(momentumReady / unique.length * 100);
    const fullCoverage = Math.round(allStatsReady / unique.length * 100);

    let label = "ZBIERAM VZORKU";
    let background = "#374151";
    let border = "#9ca3af";

    if (unique.length >= 3) {
      if (momentumCoverage >= 90 && maxGap <= 7) {
        label = "DOBRÁ KONTINUITA";
        background = "#14532d";
        border = "#39e6a5";
      } else if (momentumCoverage >= 70 && maxGap <= 10) {
        label = "STREDNÁ KONTINUITA";
        background = "#713f12";
        border = "#eab308";
      } else {
        label = "SLABÁ KONTINUITA";
        background = "#7f1d1d";
        border = "#ef4444";
      }
    }

    return {
      count: unique.length,
      momentumCoverage,
      fullCoverage,
      averageGap,
      maxGap,
      longGaps,
      label,
      background,
      border
    };
  }

  function getSnapshot(match, historyData, collectedAt) {
    const id = matchId(match);
    const currentStats = match.stats || [];

    const currentShots = statValue(currentStats, "shots on target");
    const currentAttacks = statValue(currentStats, "shots off target");

    if (!currentShots || !currentAttacks) {
      return {
        ready: false,
        text: "Čakám na kompletné štatistiky zápasu."
      };
    }

    if (!id) {
      return {
        ready: false,
        text: "Chýba identifikátor zápasu."
      };
    }

    const currentTime = Date.parse(collectedAt || "");

    if (!Number.isFinite(currentTime)) {
      return {
        ready: false,
        text: "Chýba čas aktuálneho merania."
      };
    }

    const records = historyRecords(historyData, id);

    if (!records.length) {
      return {
        ready: false,
        text: "Zbieram prvé historické meranie."
      };
    }

    const previousRecords = records.filter(
      record => record.time < currentTime - 1000
    );

    if (!previousRecords.length) {
      return {
        ready: false,
        text: "Čakám na druhé meranie tohto zápasu."
      };
    }

    const old = previousRecords[previousRecords.length - 1];
    const minutes = (currentTime - old.time) / 60000;

    if (!Number.isFinite(minutes) || minutes <= 0) {
      return {
        ready: false,
        text: "Neplatný čas historického merania."
      };
    }

    if (minutes < MIN_GAP_MINUTES) {
      return {
        ready: false,
        text: `Meranie je príliš čerstvé (${minutes.toFixed(1)} min).`
      };
    }

    if (minutes > MAX_GAP_MINUTES) {
      return {
        ready: false,
        text: `STARÉ MERANIE: ${Math.round(minutes)} minút. Signál zablokovaný.`
      };
    }

    const oldStats = old.match.stats || [];
    const oldShots = statValue(oldStats, "shots on target");
    const oldAttacks = statValue(oldStats, "shots off target");

    if (!oldShots || !oldAttacks) {
      return {
        ready: false,
        text: "Staršie meranie nemá kompletné štatistiky."
      };
    }

    if (
      currentShots.home < oldShots.home ||
      currentShots.away < oldShots.away ||
      currentAttacks.home < oldAttacks.home ||
      currentAttacks.away < oldAttacks.away
    ) {
      return {
        ready: false,
        text: "Zmena alebo reset štatistík. LIVE signál zablokovaný."
      };
    }

    const homeShots = currentShots.home - oldShots.home;
    const awayShots = currentShots.away - oldShots.away;
    const homeAttacks = currentAttacks.home - oldAttacks.home;
    const awayAttacks = currentAttacks.away - oldAttacks.away;

    const homeActivity = homeShots * 3 + homeAttacks;
    const awayActivity = awayShots * 3 + awayAttacks;

    return {
      ready: true,
      homeShots,
      awayShots,
      homeAttacks,
      awayAttacks,
      homeActivity,
      awayActivity,
      homeActivityRate: homeActivity / minutes * 10,
      awayActivityRate: awayActivity / minutes * 10,
      minutes: Number(minutes.toFixed(1)),
      oldTime: new Date(old.time).toLocaleTimeString("sk-SK")
    };
  }

  function calculateThreat(pressure, snapshot) {
    if (!pressure || !snapshot.ready) return null;

    return {
      home: Math.min(100, Math.round(
        pressure.home * 0.45 +
        Math.min(snapshot.homeActivityRate * 3, 40) * 0.55
      )),
      away: Math.min(100, Math.round(
        pressure.away * 0.45 +
        Math.min(snapshot.awayActivityRate * 3, 40) * 0.55
      ))
    };
  }

  // Zrýchlenie tlaku porovnáva dve po sebe idúce platné intervalové merania.
  // Je to diagnostika UI; nemení skóre GOAL THREAT ani pravidlá signálov.
  function calculatePressureAcceleration(match, historyData, collectedAt) {
    const id = matchId(match);
    const now = Date.parse(collectedAt || "");
    if (!id || !Number.isFinite(now)) {
      return { ready: false, reason: "Chýba identifikátor zápasu alebo čas merania." };
    }

    const records = historyRecords(historyData, id)
      .filter(item => Number.isFinite(item.time) && item.match?.stats)
      .sort((a, b) => a.time - b.time);

    if (!records.some(item => Math.abs(item.time - now) < 1000)) {
      records.push({ time: now, match });
      records.sort((a, b) => a.time - b.time);
    }

    const unique = records.filter((item, index) =>
      index === 0 || item.time !== records[index - 1].time
    );
    if (unique.length < 3) {
      return { ready: false, reason: "Potrebujeme aspoň tri merania na porovnanie dvoch intervalov." };
    }

    const intervals = [];
    const consecutiveIntervals = [];
    let previousValidIntervalEnd = null;
    let rejectedGap = 0, missingShots = 0, resetStats = 0;
    for (let i = 1; i < unique.length; i++) {
      const previous = unique[i - 1];
      const current = unique[i];
      const minutes = (current.time - previous.time) / 60000;
      if (!Number.isFinite(minutes) || minutes < MIN_GAP_MINUTES || minutes > MAX_GAP_MINUTES) {
        rejectedGap++;
        previousValidIntervalEnd = null;
        consecutiveIntervals.length = 0;
        continue;
      }

      const oldShots = statValue(previous.match.stats || [], "shots on target");
      const shots = statValue(current.match.stats || [], "shots on target");
      const oldAttacks = statValue(previous.match.stats || [], "shots off target");
      const attacks = statValue(current.match.stats || [], "shots off target");
      if (!oldShots || !shots || !oldAttacks || !attacks) {
        missingShots++;
        previousValidIntervalEnd = null;
        consecutiveIntervals.length = 0;
        continue;
      }

      if (shots.home < oldShots.home || shots.away < oldShots.away ||
          attacks.home < oldAttacks.home || attacks.away < oldAttacks.away) {
        resetStats++;
        previousValidIntervalEnd = null;
        consecutiveIntervals.length = 0;
        continue;
      }

      const interval = {
        time: current.time,
        minutes,
        homeRate: ((shots.home - oldShots.home) * 3 + attacks.home - oldAttacks.home) / minutes * 10,
        awayRate: ((shots.away - oldShots.away) * 3 + attacks.away - oldAttacks.away) / minutes * 10
      };
      intervals.push(interval);
      if (previousValidIntervalEnd === previous.time) consecutiveIntervals.push(interval);
      else {
        consecutiveIntervals.length = 0;
        consecutiveIntervals.push(interval);
      }
      previousValidIntervalEnd = current.time;
    }

    const diagnostics = { snapshots: unique.length, intervals: intervals.length, rejectedGap, missingShots, resetStats };
    if (consecutiveIntervals.length < 2) {
      return { ready: false, ...diagnostics, reason: "Nedostatok dvoch po sebe idúcich platných intervalov." };
    }

    const previous = consecutiveIntervals[consecutiveIntervals.length - 2];
    const latest = consecutiveIntervals[consecutiveIntervals.length - 1];
    const homeDelta = Number((latest.homeRate - previous.homeRate).toFixed(1));
    const awayDelta = Number((latest.awayRate - previous.awayRate).toFixed(1));
    const classify = delta => delta >= 2 ? "ZRÝCHĽUJE"
      : delta <= -2 ? "SPOMAĽUJE" : "STABILNÉ";

    return {
      ready: true,
      ...diagnostics,
      homePreviousRate: Number(previous.homeRate.toFixed(1)),
      awayPreviousRate: Number(previous.awayRate.toFixed(1)),
      homeLatestRate: Number(latest.homeRate.toFixed(1)),
      awayLatestRate: Number(latest.awayRate.toFixed(1)),
      homeDelta,
      awayDelta,
      homeState: classify(homeDelta),
      awayState: classify(awayDelta),
      previousMinutes: Number(previous.minutes.toFixed(1)),
      latestMinutes: Number(latest.minutes.toFixed(1))
    };
  }

  // Graf je iba vizualizácia historických meraní; nemení pravidlá ani spúšťanie signálov.
  function renderMomentumTrend(target, match, historyData, collectedAt, currentThreat) {
    const id = matchId(match);
    if (!id) {
      addText(target, "Graf momenta čaká na identifikátor zápasu.");
      return { count: 0, span: 0, label: "bez vzorky" };
    }

    const now = Date.parse(collectedAt || "");
    const records = historyRecords(historyData, id)
      .filter(item => Number.isFinite(item.time) && item.match?.stats)
      .sort((a, b) => a.time - b.time);

    if (Number.isFinite(now) && !records.some(item => Math.abs(item.time - now) < 1000)) {
      records.push({ time: now, match });
      records.sort((a, b) => a.time - b.time);
    }

    const unique = records.filter((item, index) =>
      index === 0 || item.time !== records[index - 1].time
    );
    const points = [];

    for (let i = 1; i < unique.length; i++) {
      const previous = unique[i - 1];
      const current = unique[i];
      const minutes = (current.time - previous.time) / 60000;
      if (minutes <= 0 || minutes > MAX_GAP_MINUTES) continue;

      const oldStats = previous.match.stats || [];
      const stats = current.match.stats || [];
      const oldShots = statValue(oldStats, "shots on target");
      const shots = statValue(stats, "shots on target");
      const oldAttacks = statValue(oldStats, "shots off target");
      const attacks = statValue(stats, "shots off target");
      if (!oldShots || !shots || !oldAttacks || !attacks) continue;

      if (shots.home < oldShots.home || shots.away < oldShots.away ||
          attacks.home < oldAttacks.home || attacks.away < oldAttacks.away) continue;

      const pressure = calculatePressure(stats);
      if (!pressure) continue;
      const homeRate = ((shots.home - oldShots.home) * 3 + attacks.home - oldAttacks.home) / minutes * 10;
      const awayRate = ((shots.away - oldShots.away) * 3 + attacks.away - oldAttacks.away) / minutes * 10;
      const score = {
        home: Math.min(100, Math.round(pressure.home * 0.45 + Math.min(homeRate * 3, 40) * 0.55)),
        away: Math.min(100, Math.round(pressure.away * 0.45 + Math.min(awayRate * 3, 40) * 0.55))
      };
      points.push({ time: current.time, ...score });
    }

    if (currentThreat && Number.isFinite(now) &&
        (!points.length || points[points.length - 1].time !== now)) {
      points.push({ time: now, home: currentThreat.home, away: currentThreat.away });
    }

    const cutoff = Number.isFinite(now) ? now - 45 * 60000 : -Infinity;
    const visible = points.filter(point => point.time >= cutoff).slice(-10);
    addText(target, "VÝVOJ MOMENTA · POSLEDNÝCH 45 MINÚT", "12px");

    if (visible.length < 2) {
      addText(target, "Na graf potrebujeme aspoň dve platné historické merania. Zber pokračuje približne každé 2 minúty.", "11px");
      return { count: visible.length, span: 0, label: "nedostatok meraní" };
    }

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 320 142");
    svg.setAttribute("width", "100%");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Vývoj momenta domácich a hostí");
    svg.style.cssText = "display:block;max-width:100%;margin:4px 0;";
    [25, 70, 115].forEach((y, index) => {
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", "34"); line.setAttribute("x2", "310");
      line.setAttribute("y1", String(y)); line.setAttribute("y2", String(y));
      line.setAttribute("stroke", "#64748b"); line.setAttribute("opacity", ".25");
      line.setAttribute("stroke-dasharray", "3 4"); svg.appendChild(line);
      const axisLabel = document.createElementNS(svgNS, "text");
      axisLabel.setAttribute("x", "27"); axisLabel.setAttribute("y", String(y + 3));
      axisLabel.setAttribute("text-anchor", "end");
      axisLabel.setAttribute("fill", "#94a3b8");
      axisLabel.setAttribute("font-size", "8");
      axisLabel.textContent = index === 0 ? "100" : index === 1 ? "50" : "0";
      svg.appendChild(axisLabel);
    });

    const minTime = visible[0].time;
    const maxTime = visible[visible.length - 1].time;
    const x = time => maxTime === minTime ? 34 : 34 + (time - minTime) / (maxTime - minTime) * 276;
    const y = value => 115 - Math.max(0, Math.min(100, value)) * 0.9;
    const drawLine = (key, color) => {
      const polyline = document.createElementNS(svgNS, "polyline");
      polyline.setAttribute("points", visible.map(point => x(point.time).toFixed(1) + "," + y(point[key]).toFixed(1)).join(" "));
      polyline.setAttribute("fill", "none"); polyline.setAttribute("stroke", color);
      polyline.setAttribute("stroke-width", "3"); polyline.setAttribute("stroke-linecap", "round");
      polyline.setAttribute("stroke-linejoin", "round"); svg.appendChild(polyline);
      visible.forEach(point => {
        const dot = document.createElementNS(svgNS, "circle");
        dot.setAttribute("cx", x(point.time).toFixed(1)); dot.setAttribute("cy", y(point[key]).toFixed(1));
        dot.setAttribute("r", "2.5"); dot.setAttribute("fill", color); svg.appendChild(dot);
      });
    };
    drawLine("home", "#22c55e");
    drawLine("away", "#94a3b8");
    const firstLabel = document.createElementNS(svgNS, "text");
    firstLabel.setAttribute("x", "26"); firstLabel.setAttribute("y", "136");
    firstLabel.setAttribute("fill", "#94a3b8"); firstLabel.setAttribute("font-size", "9");
    firstLabel.textContent = new Date(minTime).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" });
    svg.appendChild(firstLabel);
    const lastLabel = document.createElementNS(svgNS, "text");
    lastLabel.setAttribute("x", "310"); lastLabel.setAttribute("y", "136");
    lastLabel.setAttribute("text-anchor", "end"); lastLabel.setAttribute("fill", "#94a3b8");
    lastLabel.setAttribute("font-size", "9");
    lastLabel.textContent = new Date(maxTime).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" });
    svg.appendChild(lastLabel);
    target.appendChild(svg);

    const legend = document.createElement("div");
    legend.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:7px;margin:5px 0 7px;";
    const makeLegendItem = (name, value, color) => {
      const item = document.createElement("div");
      item.style.cssText = "min-width:0;padding:7px 8px;border:1px solid " + color + "55;border-radius:8px;background:#142338;";
      const label = document.createElement("div");
      label.textContent = name;
      label.style.cssText = "font-size:9px;font-weight:800;color:" + color + ";overflow-wrap:anywhere;";
      const score = document.createElement("div");
      score.textContent = value + "/100";
      score.style.cssText = "font-size:15px;font-weight:950;color:#f1f5f9;font-variant-numeric:tabular-nums;margin-top:2px;";
      item.append(label, score);
      return item;
    };
    const latest = visible[visible.length - 1];
    legend.append(
      makeLegendItem("🟢 " + (match.home || "Domáci"), latest.home, "#4ade80"),
      makeLegendItem("⚪ " + (match.away || "Hostia"), latest.away, "#cbd5e1")
    );
    target.appendChild(legend);
    const sampleSpan = Math.round((visible[visible.length - 1].time - visible[0].time) / 60000);
    const coverage = document.createElement("div");
    coverage.textContent = "Vzorka: " + visible.length + " meraní · časový rozsah: " +
      sampleSpan + " min";
    coverage.style.cssText = "font-size:9px;color:#8296ad;margin:0 0 3px;";
    target.appendChild(coverage);

    const quality = document.createElement("div");
    const sampleIsShort = visible.length < 4 || sampleSpan < 10;
    quality.textContent = sampleIsShort
      ? "Krátka vzorka – trend ber iba orientačne."
      : "Viac meraní v čase – trend je čitateľnejší, nie však štatisticky potvrdený.";
    quality.style.cssText = "font-size:9px;font-weight:700;color:" +
      (sampleIsShort ? "#fbbf24" : "#7dd3c7") + ";margin:0 0 7px;";
    target.appendChild(quality);


    const first = visible[0];
    const previous = visible[visible.length - 2];
    const delta = (latest.home - latest.away) - (previous.home - previous.away);
    const homeDelta = latest.home - first.home;
    const awayDelta = latest.away - first.away;
    const label = delta >= 5 ? "rozdiel sa posúva k domácim."
      : delta <= -5 ? "rozdiel sa posúva k hosťom."
      : "približne stabilný oproti predchádzajúcemu meraniu.";
    addText(target, "Zmena oproti predchádzajúcemu meraniu: " +
      (delta > 0 ? "+" : "") + delta + " bodov v rozdiele momenta. " +
      "Celková zmena za zobrazené obdobie: domáci " +
      (homeDelta > 0 ? "+" : "") + homeDelta + ", hostia " +
      (awayDelta > 0 ? "+" : "") + awayDelta + " bodov. " +
      "Tento trend sám osebe nevytvára signál.", "11px");
    return {
      count: visible.length,
      span: Math.max(0, (maxTime - minTime) / 60000),
      label
    };
  }

  // LIVE TEAM POWER je relatívny index aktuálnej prevahy, nie dlhodobá sila klubu ani pravdepodobnosť gólu.
  // Chýbajúce komponenty sa vynechajú a váhy sa normalizujú.
  function calculateTeamPower(pressure, snapshot, acceleration) {
    if (!pressure) return { ready: false, reason: "Čakám na použiteľné štatistiky tlaku." };
    const sides = {};
    ["home", "away"].forEach(side => {
      const components = [{ value: pressure[side], weight: 50 }];
      if (snapshot?.ready && Number.isFinite(snapshot[side + "ActivityRate"])) {
        components.push({ value: Math.max(0, Math.min(100, snapshot[side + "ActivityRate"] * 10)), weight: 35 });
      }
      if (acceleration?.ready && Number.isFinite(acceleration[side + "Delta"])) {
        components.push({ value: Math.max(0, Math.min(100, 50 + acceleration[side + "Delta"] * 5)), weight: 15 });
      }
      const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
      const score = Math.round(components.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight);
      sides[side] = {
        score,
        label: score >= 70 ? "SILNÁ PREVAHA" : score >= 55 ? "MIERNA PREVAHA" : score >= 45 ? "VYROVNANÉ" : "SLABŠIA PREVAHA"
      };
    });
    return { ready: true, sides };
  }

  // Stabilita LIVE prevahy z najviac 8 poslednych platnych merani.
  function calculateTeamConsistency(match, historyData, collectedAt) {
    const id = matchId(match);
    const now = Date.parse(collectedAt || "");
    if (!id || !Number.isFinite(now)) return { ready: false, reason: "Chýba identifikátor zápasu alebo čas merania." };

    const records = historyRecords(historyData, id)
      .filter(item => Number.isFinite(item.time) && item.match?.stats)
      .sort((a, b) => a.time - b.time);
    if (!records.some(item => Math.abs(item.time - now) < 1000)) {
      records.push({ time: now, match });
      records.sort((a, b) => a.time - b.time);
    }
    const unique = records.filter((item, index) => index === 0 || item.time !== records[index - 1].time);
    const measured = unique.map(item => ({
      time: item.time,
      pressure: calculatePressure(item.match.stats || [])
    })).filter(item => item.pressure &&
      Number.isFinite(item.pressure.home) && Number.isFinite(item.pressure.away)
    ).slice(-8);

    if (measured.length < 4) {
      return { ready: false, count: measured.length, reason: "Potrebné sú aspoň 4 platné merania; aktuálne " + measured.length + "." };
    }

    const states = measured.map(item => {
      const diff = item.pressure.home - item.pressure.away;
      return diff >= 10 ? "home" : diff <= -10 ? "away" : "balanced";
    });
    const count = states.length;
    const balanced = states.filter(state => state === "balanced").length;
    const homeLeads = states.filter(state => state === "home").length;
    const awayLeads = states.filter(state => state === "away").length;
    const score = side => Math.round(
      (states.filter(state => state === side).length + balanced * 0.5) / count * 100
    );
    const latestState = states[count - 1];
    let latestStreak = 0;
    for (let i = count - 1; i >= 0 && states[i] === latestState; i--) latestStreak++;

    return {
      ready: true,
      count,
      spanMinutes: Number(((measured[count - 1].time - measured[0].time) / 60000).toFixed(1)),
      home: { score: score("home"), leadSamples: homeLeads },
      away: { score: score("away"), leadSamples: awayLeads },
      balancedSamples: balanced,
      latestState,
      latestStreak
    };
  }

  // Odhad oslabovania odporu súpera z trendu relatívneho tlaku; nie je to priamo meraná obranná kvalita.
  function calculateOpponentWeakness(match, historyData, collectedAt) {
    const id = matchId(match);
    const now = Date.parse(collectedAt || "");
    if (!id || !Number.isFinite(now)) return { ready: false, reason: "Chýba identifikátor zápasu alebo čas merania." };

    const records = historyRecords(historyData, id)
      .filter(item => Number.isFinite(item.time) && item.match?.stats)
      .sort((a, b) => a.time - b.time);
    if (!records.some(item => Math.abs(item.time - now) < 1000)) {
      records.push({ time: now, match });
      records.sort((a, b) => a.time - b.time);
    }
    const unique = records.filter((item, index) => index === 0 || item.time !== records[index - 1].time);
    const measured = unique.map(item => ({
      time: item.time,
      pressure: calculatePressure(item.match.stats || [])
    })).filter(item => item.pressure &&
      Number.isFinite(item.pressure.home) && Number.isFinite(item.pressure.away)
    ).slice(-5);

    if (measured.length < 4) {
      return { ready: false, count: measured.length, reason: "Na odhad oslabovania odporu treba aspoň 4 platné merania; aktuálne " + measured.length + "." };
    }

    const first = measured[0].pressure;
    const latest = measured[measured.length - 1].pressure;
    const sides = {};
    ["home", "away"].forEach(side => {
      const opponent = side === "home" ? "away" : "home";
      const diffs = measured.map(item => item.pressure[side] - item.pressure[opponent]);
      const improvement = diffs[diffs.length - 1] - diffs[0];
      const positiveSteps = diffs.slice(1).filter((value, index) => value - diffs[index] >= 2).length;
      const leadSamples = diffs.filter(value => value >= 10).length;
      const trendScore = Math.max(0, Math.min(100, 50 + improvement * 2));
      const persistenceScore = leadSamples / diffs.length * 100;
      const stepScore = positiveSteps / (diffs.length - 1) * 100;
      const score = Math.round(trendScore * 0.5 + persistenceScore * 0.3 + stepScore * 0.2);
      const currentDiff = diffs[diffs.length - 1];
      sides[side] = {
        score,
        improvement: Math.round(improvement),
        leadSamples,
        positiveSteps,
        status: currentDiff < 10 ? "PREVAHA NIE JE POTVRDENÁ"
          : improvement >= 8 ? "ODPOR SÚPERA SLABNE"
          : improvement <= -8 ? "SÚPER SA ZOTAVUJE"
          : "TLAK BEZ JASNÉHO POSUNU"
      };
    });

    return {
      ready: true,
      count: measured.length,
      spanMinutes: Number(((measured[measured.length - 1].time - measured[0].time) / 60000).toFixed(1)),
      sides,
      currentPressure: { home: latest.home, away: latest.away }
    };
  }

  // Súhrnný index prevahy v aktuálnom zápase; skladá tri odlišné časové pohľady.
  function calculateMatchDominance(pressure, consistency, opponentWeakness) {
    if (!pressure || !consistency?.ready || !opponentWeakness?.ready) {
      return { ready: false, reason: "Čakám na aktuálny tlak a aspoň 4 platné historické merania." };
    }
    const sides = {};
    ["home", "away"].forEach(side => {
      const components = [
        { key: "aktuálny tlak", value: pressure[side], weight: 40 },
        { key: "stabilita prevahy", value: consistency[side]?.score, weight: 35 },
        { key: "trend oslabovania odporu", value: opponentWeakness.sides[side]?.score, weight: 25 }
      ].filter(item => Number.isFinite(item.value));
      const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
      if (!totalWeight) return;
      const score = Math.round(components.reduce((sum, item) =>
        sum + Math.max(0, Math.min(100, item.value)) * item.weight, 0) / totalWeight);
      sides[side] = {
        score,
        components: components.map(item => ({ label: item.key, value: Math.round(item.value), weight: item.weight })),
        label: score >= 70 ? "VÝRAZNÁ PREVAHA"
          : score >= 60 ? "RASTÚCA PREVAHA"
          : score >= 45 ? "VYROVNANÝ ZÁPAS" : "BEZ POTVRDENEJ PREVAHY"
      };
    });
    if (!sides.home || !sides.away) return { ready: false, reason: "Nie sú dostupné všetky porovnateľné zložky." };
    return { ready: true, sides, sampleCount: consistency.count, spanMinutes: consistency.spanMinutes };
  }

  // Diagnostické skóre kvality príležitosti; nie je to pravdepodobnosť gólu.
  // Chýbajúce komponenty sa vynechajú a váhy sa prepočítajú iba z dostupných dát.
  function calculateSignalQuality(threat, snapshot, reliability, acceleration, collectedAt) {
    if (!threat || !snapshot?.ready || !reliability || reliability.count < 3) {
      return { ready: false, reason: "Zbieram aspoň tri úplné merania na spoľahlivejšie hodnotenie." };
    }

    const age = Date.now() - Date.parse(collectedAt || "");
    if (!Number.isFinite(age) || age < 0 || age > MAX_DATA_AGE_MS) {
      return { ready: false, reason: "Aktuálne meranie je neplatné alebo zastarané." };
    }

    const freshness = age <= 2 * 60000 ? 100
      : age <= 4 * 60000 ? 80
      : age <= 7 * 60000 ? 50 : 0;
    const sampleDepth = Math.min(100, reliability.count / 5 * 100);
    const dataQuality = Math.round(reliability.momentumCoverage * 0.7 + sampleDepth * 0.3);
    const sides = {};

    ["home", "away"].forEach(side => {
      const activityRate = snapshot[side + "ActivityRate"];
      const activityScore = Math.max(0, Math.min(100, activityRate * 10));
      const components = [
        { value: dataQuality, weight: 25 },
        { value: freshness, weight: 20 },
        { value: threat[side], weight: 20 },
        { value: activityScore, weight: 20 }
      ];

      if (acceleration?.ready) {
        const delta = acceleration[side + "Delta"];
        const accelerationScore = Math.max(0, Math.min(100, 50 + delta * 5));
        components.push({ value: accelerationScore, weight: 15 });
      }

      const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
      const score = Math.round(
        components.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight
      );
      sides[side] = {
        score,
        label: score >= 80 ? "VYSOKÁ KVALITA"
          : score >= 65 ? "STREDNÁ KVALITA" : "NÍZKA KVALITA",
        dataQuality,
        freshness,
        activityScore,
        accelerationIncluded: Boolean(acceleration?.ready)
      };
    });

    return { ready: true, sides };
  }

  // New descriptive momentum display. It is intentionally separate from the legacy green signal.
  function renderMomentumEnginePanel(target, match, historyData, collectedAt) {
    const panel = document.createElement("div");
    panel.style.cssText = "margin:12px 0;padding:12px;background:#0c1929;border:1px solid #344b65;border-radius:10px;";
    const heading = document.createElement("div");
    heading.textContent = "LIVE MOMENTUM · FLASHSCORE";
    heading.style.cssText = "font-size:12px;font-weight:900;letter-spacing:.5px;color:#e2e8f0;margin-bottom:8px;";
    panel.appendChild(heading);
    const engine = window.LiveMomentumEngine;
    const id = matchId(match);
    const records = historyRecords(historyData, id);
    const result = engine?.analyse(match, records, collectedAt);
    if (!result?.ready) {
      addText(panel, result?.reason || "Momentum engine sa ešte načítava.", "11px");
      target.appendChild(panel);
      return;
    }
    const status = document.createElement("div");
    status.textContent = result.status;
    status.style.cssText = "font-size:11px;font-weight:900;color:#7dd3fc;margin-bottom:8px;";
    panel.appendChild(status);
    if (result.pressure) {
      addText(panel, "Kumulatívna prevaha: Domáci " + result.pressure.home + "/100 | Hostia " + result.pressure.away + "/100", "12px");
      addText(panel, "Základ: strely na bránu, strely mimo bránu a držanie lopty podľa dostupnosti.", "10px");
    } else {
      addText(panel, "Kumulatívny tlak zatiaľ nemožno určiť – chýbajú použiteľné štatistiky.", "11px");
    }
    if (result.recent) {
      addText(panel, "Tlak v poslednom intervale (" + result.recent.minutes + " min): Domáci " + result.recent.home + "/100 | Hostia " + result.recent.away + "/100", "13px");
      addText(panel, "Aktivita za 10 min: Domáci " + result.recent.homeRate.toFixed(1) + " | Hostia " + result.recent.awayRate.toFixed(1));
      const used = result.recent.used.map(x => {
        const label = x.key === "sot" ? "SOT" : x.key === "off" ? "strely mimo" : "rohy";
        return label + " " + x.home + ":" + x.away;
      }).join(" · ");
      addText(panel, "Nové udalosti: " + used, "10px");
    } else {
      addText(panel, "Čakám na platné porovnanie dvoch meraní v intervale 1,5–15 minút. Bez nových striel/rohov sa tlak nevymýšľa.", "11px");
    }
    if (result.acceleration) {
      addText(panel, "Zrýchlenie: domáci " + result.acceleration.homeState + " (" + result.acceleration.homePreviousRate + " → " + result.acceleration.homeLatestRate + "), hostia " + result.acceleration.awayState + " (" + result.acceleration.awayPreviousRate + " → " + result.acceleration.awayLatestRate + ")", "11px");
    } else {
      addText(panel, "Zrýchlenie/spomalenie: čakám na ďalší platný interval.", "10px");
    }
    if (result.trend.length >= 2) {
      if (!result.recent) {
        addText(panel, "HISTORICKÝ PRIEBEH · Graf zobrazuje posledné platné intervalové meranie, nie aktuálny tlak. Aktuálne intervalové meranie čaká na nové platné porovnanie.", "10px");
      }
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("viewBox", "0 0 320 130");
      svg.setAttribute("width", "100%");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Vývoj relatívneho momenta domácich a hostí");
      svg.style.cssText = "display:block;max-width:100%;margin:7px 0;";
      [18,57,96].forEach((y,j)=>{
        const line=document.createElementNS(svgNS,"line");
        line.setAttribute("x1","24");line.setAttribute("x2","310");
        line.setAttribute("y1",String(y));line.setAttribute("y2",String(y));
        line.setAttribute("stroke","#64748b");line.setAttribute("opacity",".25");
        line.setAttribute("stroke-dasharray","3 4");svg.appendChild(line);
        const t=document.createElementNS(svgNS,"text");
        t.setAttribute("x","18");t.setAttribute("y",String(y+3));
        t.setAttribute("text-anchor","end");t.setAttribute("fill","#94a3b8");
        t.setAttribute("font-size","8");t.textContent=j===0?"100":j===1?"50":"0";svg.appendChild(t);
      });
      const points=result.trend,first=points[0].time,last=points[points.length-1].time;
      const px=t=>last===first?24:24+(t-first)/(last-first)*286;
      const py=v=>96-Math.max(0,Math.min(100,v))*.78;
      for(const [key,color] of [["home","#22c55e"],["away","#94a3b8"]]){
        const line=document.createElementNS(svgNS,"polyline");
        line.setAttribute("points",points.map(p=>px(p.time).toFixed(1)+","+py(p[key]).toFixed(1)).join(" "));
        line.setAttribute("fill","none");line.setAttribute("stroke",color);
        line.setAttribute("stroke-width","2.5");line.setAttribute("stroke-linecap","round");
        line.setAttribute("stroke-linejoin","round");svg.appendChild(line);
        const latestPoint=points[points.length-1];
        const dot=document.createElementNS(svgNS,"circle");
        dot.setAttribute("cx",px(latestPoint.time).toFixed(1));
        dot.setAttribute("cy",py(latestPoint[key]).toFixed(1));
        dot.setAttribute("r","3.5");dot.setAttribute("fill",color);
        dot.setAttribute("stroke","#0c1929");dot.setAttribute("stroke-width","1.5");
        svg.appendChild(dot);
      }
      const timeLabel=(time)=>new Date(time).toLocaleTimeString("sk-SK",{hour:"2-digit",minute:"2-digit"});
      const firstLabel=document.createElementNS(svgNS,"text");
      firstLabel.setAttribute("x","24");firstLabel.setAttribute("y","119");
      firstLabel.setAttribute("fill","#94a3b8");firstLabel.setAttribute("font-size","8");
      firstLabel.textContent=timeLabel(first);
      svg.appendChild(firstLabel);
      const lastLabel=document.createElementNS(svgNS,"text");
      lastLabel.setAttribute("x","310");lastLabel.setAttribute("y","119");
      lastLabel.setAttribute("text-anchor","end");lastLabel.setAttribute("fill","#94a3b8");
      lastLabel.setAttribute("font-size","8");lastLabel.textContent=timeLabel(last);
      svg.appendChild(lastLabel);
      panel.appendChild(svg);
      const legend=document.createElement("div");
      legend.className="momentum-chart-legend";
      const addLegend=(label,color,value)=>{
        const item=document.createElement("span");
        item.className="momentum-legend-item";
        const swatch=document.createElement("i");
        swatch.style.background=color;
        const textNode=document.createElement("b");
        textNode.textContent=label+" "+Math.round(value)+"/100";
        item.append(swatch,textNode);legend.appendChild(item);
      };
      const latest=points[points.length-1];
      const latestValidLabel=document.createElement("div");
      latestValidLabel.textContent="POSLEDNÝ PLATNÝ INTERVAL · "+timeLabel(latest.time);
      latestValidLabel.style.cssText="font-size:9px;font-weight:800;letter-spacing:.35px;color:"+(result.recent?"#94a3b8":"#fbbf24")+";margin:2px 0 5px;";
      panel.appendChild(latestValidLabel);
      addLegend("DOMÁCI","#22c55e",latest.home);
      addLegend("HOSTIA","#94a3b8",latest.away);
      panel.appendChild(legend);
      const timeRange=document.createElement("div");
      timeRange.className="momentum-chart-range";
      timeRange.textContent="Zobrazené platné intervaly · "+timeLabel(first)+" – "+timeLabel(last);
      panel.appendChild(timeRange);
    }
    const q=result.reliability;
    addText(panel, "Pokrytie archívnych meraní: základné strelecké dáta " + q.coreCoverage + "% | SOT aj strely mimo " + q.shotCoverage + "% | držanie lopty " + q.possessionCoverage + "% | platné intervaly " + q.intervalCount + ".", "10px");
    addText(panel, "Index momenta opisuje relatívnu aktivitu, nie pravdepodobnosť gólu. Rohy sú iba doplnkový údaj, ak ich Flashscore poskytne. Dangerous Attacks sa nepoužívajú.", "10px");
    target.appendChild(panel);
  }

  function renderMomentumOverview(target, pressure, snapshot, threat, trend, reliability, acceleration, collectedAt, match, historyData) {
    const panel = document.createElement("div");
    panel.style.cssText = "margin:12px 0;padding:12px;background:#0c1929;border:1px solid #344b65;border-radius:10px;";
    const heading = document.createElement("div");
    heading.textContent = "PREHĽAD TLAKU A MOMENTA";
    heading.style.cssText = "font-size:12px;font-weight:900;letter-spacing:.5px;color:#e2e8f0;margin-bottom:10px;";
    panel.appendChild(heading);

    if (threat) {
      const diff = threat.home - threat.away;
      const leader = Math.abs(diff) < 5 ? "MOMENTUM JE VYROVNANÉ"
        : diff > 0 ? "MOMENTUM: DOMÁCI" : "MOMENTUM: HOSTIA";
      const color = Math.abs(diff) < 5 ? "#cbd5e1" : diff > 0 ? "#86efac" : "#cbd5e1";
      const summary = document.createElement("div");
      summary.style.cssText = "padding:10px;margin:0 0 12px;background:#142338;border:1px solid #38516e;border-radius:9px;";
      const summaryTitle = document.createElement("div");
      summaryTitle.textContent = leader;
      summaryTitle.style.cssText = "font-size:11px;font-weight:900;letter-spacing:.4px;color:" + color + ";";
      const summaryScore = document.createElement("div");
      summaryScore.textContent = "Domáci " + threat.home + "  :  " + threat.away + " Hostia";
      summaryScore.style.cssText = "font-size:18px;font-weight:900;color:#fff;font-variant-numeric:tabular-nums;margin-top:4px;";
      const summaryNote = document.createElement("div");
      summaryNote.textContent = "Rozdiel " + Math.abs(diff) + " bodov v ukazovateli GOAL THREAT – nejde o percentuálnu pravdepodobnosť gólu.";
      summaryNote.style.cssText = "font-size:10px;line-height:1.4;color:#a8b8cc;margin-top:4px;";
      summary.append(summaryTitle, summaryScore, summaryNote);
      panel.appendChild(summary);
    }

    const addMetric = (label, homeValue, awayValue, suffix, maxValue, homeColor, awayColor) => {
      const row = document.createElement("div");
      row.style.cssText = "margin:11px 0;";
      const title = document.createElement("div");
      title.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px;color:#cbd5e1;margin-bottom:5px;";
      const left = document.createElement("strong");
      left.textContent = "Domáci " + homeValue + suffix;
      left.style.color = homeColor;
      const middle = document.createElement("span");
      middle.textContent = label;
      middle.style.cssText = "text-align:center;font-weight:800;";
      const right = document.createElement("strong");
      right.textContent = "Hostia " + awayValue + suffix;
      right.style.color = awayColor;
      title.append(left, middle, right);
      row.appendChild(title);
      const track = document.createElement("div");
      track.style.cssText = "display:flex;width:100%;height:9px;overflow:hidden;background:#26384d;border-radius:8px;";
      const total = Math.max(0, Number(homeValue)) + Math.max(0, Number(awayValue));
      const homeWidth = total > 0 ? Math.max(0, Math.min(100, Number(homeValue) / total * 100)) : 50;
      const homeBar = document.createElement("div");
      homeBar.style.cssText = "height:100%;width:" + homeWidth + "%;background:" + homeColor + ";";
      const awayBar = document.createElement("div");
      awayBar.style.cssText = "height:100%;flex:1;background:" + awayColor + ";";
      track.append(homeBar, awayBar);
      row.appendChild(track);
      panel.appendChild(row);
    };

    if (threat) {
      addMetric("GOAL THREAT", threat.home, threat.away, "/100", 100, "#22c55e", "#94a3b8");
    } else {
      addText(panel, "GOAL THREAT: čaká sa na platné merania.");
    }

    if (pressure) {
      addMetric("AKTUÁLNY TLAK", pressure.home, pressure.away, "/100", 100, "#22c55e", "#94a3b8");
      const diff = pressure.home - pressure.away;
      const note = document.createElement("div");
      note.textContent = (diff === 0 ? "Tlak je vyrovnaný. " :
        "Rozdiel " + Math.abs(diff) + " bodov v prospech " + (diff > 0 ? "domácich. " : "hostí. ")) +
        "Ide o relatívny podiel dostupných štatistík, nie pravdepodobnosť gólu.";
      note.style.cssText = "font-size:10px;line-height:1.45;color:#94a3b8;margin-top:-5px;";
      panel.appendChild(note);
    } else {
      addText(panel, "Aktuálny tlak nemožno vypočítať – chýbajú štatistiky.");
    }

    if (snapshot?.ready) {
      addMetric("AKTIVITA / 10 MIN", snapshot.homeActivityRate.toFixed(1), snapshot.awayActivityRate.toFixed(1), "", 100, "#22c55e", "#94a3b8");
      const note = document.createElement("div");
      note.textContent = "Vážený index nových striel na bránu a nebezpečných útokov za 10 minút – nie samotný počet striel.";
      note.style.cssText = "font-size:10px;line-height:1.45;color:#94a3b8;margin-top:-5px;";
      panel.appendChild(note);
    } else {
      addText(panel, "Aktivita za 10 min: čaká sa na dve platné merania.");
    }

    const trendText = document.createElement("div");
    trendText.style.cssText = "margin-top:12px;padding:10px;background:#142338;border:1px solid #293d55;border-radius:9px;font-size:11px;line-height:1.5;color:#e2e8f0;";
    if (trend && trend.count >= 2) {
      trendText.textContent = "VÝVOJ: " + trend.label + " Vzorka: " + trend.count + " meraní za " + trend.span.toFixed(0) + " min.";
    } else {
      trendText.textContent = "VÝVOJ: zatiaľ bez dostatočnej historickej vzorky.";
    }
    panel.appendChild(trendText);

    const quality = document.createElement("div");
    quality.style.cssText = "font-size:10px;color:#94a3b8;margin-top:8px;line-height:1.45;";
    quality.textContent = reliability
      ? "Kvalita zberu: " + reliability.label + " · " + reliability.count + " meraní · úplnosť momentum dát " + reliability.momentumCoverage + "%."
      : "Kvalita zberu: čaká sa na historické merania.";
    panel.appendChild(quality);

    const accelerationPanel = document.createElement("div");
    accelerationPanel.style.cssText = "margin-top:10px;padding:10px;background:#142338;border:1px solid #293d55;border-radius:9px;";
    const accelerationHeading = document.createElement("div");
    accelerationHeading.textContent = "ZRÝCHLENIE / SPOMALENIE TLAKU";
    accelerationHeading.style.cssText = "font-size:11px;font-weight:900;color:#e2e8f0;margin-bottom:6px;";
    accelerationPanel.appendChild(accelerationHeading);

    if (acceleration?.ready) {
      const stateColor = state => state === "ZRÝCHĽUJE" ? "#39e6a5"
        : state === "SPOMAĽUJE" ? "#fbbf24" : "#cbd5e1";
      const accelerationText = document.createElement("div");
      accelerationText.style.cssText = "font-size:11px;line-height:1.6;color:#cbd5e1;";
      const homeLine = document.createElement("div");
      homeLine.textContent = "Domáci: " + acceleration.homeState + " (" +
        (acceleration.homeDelta > 0 ? "+" : "") + acceleration.homeDelta +
        " · " + acceleration.homePreviousRate + " → " + acceleration.homeLatestRate + " / 10 min)";
      homeLine.style.color = stateColor(acceleration.homeState);
      const awayLine = document.createElement("div");
      awayLine.textContent = "Hostia: " + acceleration.awayState + " (" +
        (acceleration.awayDelta > 0 ? "+" : "") + acceleration.awayDelta +
        " · " + acceleration.awayPreviousRate + " → " + acceleration.awayLatestRate + " / 10 min)";
      awayLine.style.color = stateColor(acceleration.awayState);
      accelerationText.append(homeLine, awayLine);
      accelerationPanel.appendChild(accelerationText);
      const intervalNote = document.createElement("div");
      intervalNote.textContent = "Porovnanie dvoch posledných platných intervalov: " +
        acceleration.previousMinutes + " a " + acceleration.latestMinutes +
        " min. Zmena váženej aktivity, nie pravdepodobnosť gólu.";
      intervalNote.style.cssText = "font-size:10px;color:#94a3b8;margin-top:5px;line-height:1.4;";
      accelerationPanel.appendChild(intervalNote);
    } else {
      const waiting = document.createElement("div");
      waiting.textContent = acceleration?.reason || "Zrýchlenie zatiaľ nemožno vypočítať.";
      waiting.style.cssText = "font-size:10px;color:#94a3b8;line-height:1.45;";
      accelerationPanel.appendChild(waiting);
    }
    panel.appendChild(accelerationPanel);

    const teamPower = calculateTeamPower(pressure, snapshot, acceleration);
    const powerPanel = document.createElement("div");
    powerPanel.style.cssText = "margin-top:10px;padding:11px;background:#142338;border:1px solid #38516e;border-radius:9px;";
    const powerHeading = document.createElement("div");
    powerHeading.textContent = "AI TEAM POWER INDEX · 0–100";
    powerHeading.style.cssText = "font-size:11px;font-weight:900;color:#e2e8f0;margin-bottom:8px;";
    powerPanel.appendChild(powerHeading);
    if (teamPower.ready) {
      ["home", "away"].forEach(side => {
        const item = teamPower.sides[side];
        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:space-between;gap:8px;margin:7px 0;font-size:11px;";
        const name = document.createElement("strong");
        name.textContent = side === "home" ? "DOMÁCI" : "HOSTIA";
        name.style.color = "#cbd5e1";
        const value = document.createElement("strong");
        value.textContent = item.score + "/100 · " + item.label;
        value.style.color = item.score >= 70 ? "#39e6a5" : item.score >= 55 ? "#fbbf24" : "#cbd5e1";
        row.append(name, value);
        powerPanel.appendChild(row);
        const track = document.createElement("div");
        track.style.cssText = "height:7px;background:#26384d;border-radius:8px;overflow:hidden;margin-bottom:7px;";
        const fill = document.createElement("div");
        fill.style.cssText = "height:100%;width:" + item.score + "%;background:" + (side === "home" ? "#39e6a5" : "#94a3b8") + ";border-radius:8px;";
        track.appendChild(fill);
        powerPanel.appendChild(track);
      });
      const powerMethod = document.createElement("div");
      powerMethod.textContent = "Váhy: aktuálny tlak 50 %, aktivita 35 %, zrýchlenie 15 % (ak je dostupné). Chýbajúce zložky sa vynechajú a váhy sa prepočítajú.";
      powerMethod.style.cssText = "font-size:10px;color:#94a3b8;line-height:1.45;margin-top:5px;";
      powerPanel.appendChild(powerMethod);
    } else {
      const waiting = document.createElement("div");
      waiting.textContent = teamPower.reason;
      waiting.style.cssText = "font-size:10px;color:#94a3b8;";
      powerPanel.appendChild(waiting);
    }
    const powerWarning = document.createElement("div");
    powerWarning.textContent = "Meria iba aktuálnu LIVE prevahu v tomto zápase. Nie je to dlhodobá kvalita tímu, pravdepodobnosť gólu ani stávkový signál.";
    powerWarning.style.cssText = "font-size:10px;color:#94a3b8;line-height:1.4;margin-top:7px;";
    powerPanel.appendChild(powerWarning);
    panel.appendChild(powerPanel);

    const consistency = calculateTeamConsistency(match, historyData, collectedAt);
    const consistencyPanel = document.createElement("div");
    consistencyPanel.style.cssText = "margin-top:10px;padding:11px;background:#142338;border:1px solid #38516e;border-radius:9px;";
    const consistencyHeading = document.createElement("div");
    consistencyHeading.textContent = "AI TEAM CONSISTENCY · STABILITA PREVAHY";
    consistencyHeading.style.cssText = "font-size:11px;font-weight:900;color:#e2e8f0;margin-bottom:8px;";
    consistencyPanel.appendChild(consistencyHeading);
    if (consistency.ready) {
      ["home", "away"].forEach(side => {
        const item = consistency[side];
        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:space-between;gap:8px;margin:7px 0;font-size:11px;";
        const name = document.createElement("strong");
        name.textContent = side === "home" ? "DOMÁCI" : "HOSTIA";
        name.style.color = "#cbd5e1";
        const value = document.createElement("strong");
        value.textContent = item.score + "/100 · prevaha v " + item.leadSamples + "/" + consistency.count + " meraniach";
        value.style.color = item.score >= 65 ? "#39e6a5" : item.score >= 50 ? "#fbbf24" : "#cbd5e1";
        row.append(name, value);
        consistencyPanel.appendChild(row);
      });
      const stateLabel = consistency.latestState === "home" ? "Domáci majú aktuálnu prevahu"
        : consistency.latestState === "away" ? "Hostia majú aktuálnu prevahu"
        : "Aktuálne je prevaha vyrovnaná";
      const detail = document.createElement("div");
      detail.textContent = stateLabel + " · aktuálny stav trvá " + consistency.latestStreak +
        " meraní · vzorka " + consistency.count + " meraní za " + consistency.spanMinutes + " min.";
      detail.style.cssText = "font-size:10px;color:#cbd5e1;line-height:1.45;margin-top:6px;";
      consistencyPanel.appendChild(detail);
    } else {
      const waiting = document.createElement("div");
      waiting.textContent = consistency.reason;
      waiting.style.cssText = "font-size:10px;color:#94a3b8;";
      consistencyPanel.appendChild(waiting);
    }
    const consistencyWarning = document.createElement("div");
    consistencyWarning.textContent = "Skóre vyjadruje podiel meraní s prevahou; vyrovnané merania sa počítajú polovicou. Nie je to pravdepodobnosť gólu ani dlhodobá sila tímu.";
    consistencyWarning.style.cssText = "font-size:10px;color:#94a3b8;line-height:1.4;margin-top:7px;";
    consistencyPanel.appendChild(consistencyWarning);
    panel.appendChild(consistencyPanel);

    const opponentWeakness = calculateOpponentWeakness(match, historyData, collectedAt);
    const weaknessPanel = document.createElement("div");
    weaknessPanel.style.cssText = "margin-top:10px;padding:11px;background:#142338;border:1px solid #38516e;border-radius:9px;";
    const weaknessHeading = document.createElement("div");
    weaknessHeading.textContent = "AI OPPONENT WEAKNESS · OSLABOVANIE ODPORU SÚPERA";
    weaknessHeading.style.cssText = "font-size:11px;font-weight:900;color:#e2e8f0;margin-bottom:8px;";
    weaknessPanel.appendChild(weaknessHeading);
    if (opponentWeakness.ready) {
      ["home", "away"].forEach(side => {
        const item = opponentWeakness.sides[side];
        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:space-between;gap:8px;margin:7px 0;font-size:11px;";
        const name = document.createElement("strong");
        name.textContent = side === "home" ? "DOMÁCI" : "HOSTIA";
        name.style.color = "#cbd5e1";
        const value = document.createElement("strong");
        value.textContent = item.score + "/100 · " + item.status;
        value.style.color = item.status === "ODPOR SÚPERA SLABNE" ? "#39e6a5"
          : item.status === "SÚPER SA ZOTAVUJE" ? "#fbbf24" : "#cbd5e1";
        row.append(name, value);
        weaknessPanel.appendChild(row);
        const detail = document.createElement("div");
        detail.textContent = "Zmena rozdielu tlaku " + (item.improvement > 0 ? "+" : "") +
          item.improvement + " bodov · prevaha ≥10 bodov v " + item.leadSamples +
          "/" + opponentWeakness.count + " meraniach";
        detail.style.cssText = "font-size:10px;color:#94a3b8;margin:0 0 5px;line-height:1.4;";
        weaknessPanel.appendChild(detail);
      });
      const range = document.createElement("div");
      range.textContent = "Vzorka " + opponentWeakness.count + " meraní za " +
        opponentWeakness.spanMinutes + " minút. Skóre kombinuje trend rozdielu tlaku (50 %), opakovanú prevahu (30 %) a rastúce kroky tlaku (20 %).";
      range.style.cssText = "font-size:10px;color:#94a3b8;line-height:1.45;margin-top:6px;";
      weaknessPanel.appendChild(range);
    } else {
      const waiting = document.createElement("div");
      waiting.textContent = opponentWeakness.reason;
      waiting.style.cssText = "font-size:10px;color:#94a3b8;";
      weaknessPanel.appendChild(waiting);
    }
    const weaknessWarning = document.createElement("div");
    weaknessWarning.textContent = "Ide iba o odhad zmeny relatívneho LIVE tlaku. API neposkytuje priame meranie kvality obrany súpera; skóre nie je pravdepodobnosť gólu ani stávkový signál.";
    weaknessWarning.style.cssText = "font-size:10px;color:#94a3b8;line-height:1.4;margin-top:7px;";
    weaknessPanel.appendChild(weaknessWarning);
    panel.appendChild(weaknessPanel);

    const matchDominance = calculateMatchDominance(pressure, consistency, opponentWeakness);
    const dominancePanel = document.createElement("div");
    dominancePanel.style.cssText = "margin-top:10px;padding:11px;background:#101f32;border:1px solid #4b6685;border-radius:9px;";
    const dominanceHeading = document.createElement("div");
    dominanceHeading.textContent = "AI MATCH DOMINANCE · CELKOVÁ PREVAHA";
    dominanceHeading.style.cssText = "font-size:11px;font-weight:900;color:#e2e8f0;margin-bottom:8px;";
    dominancePanel.appendChild(dominanceHeading);
    if (matchDominance.ready) {
      ["home", "away"].forEach(side => {
        const item = matchDominance.sides[side];
        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:space-between;gap:8px;margin:7px 0;font-size:11px;";
        const name = document.createElement("strong");
        name.textContent = side === "home" ? "DOMÁCI" : "HOSTIA";
        name.style.color = "#cbd5e1";
        const value = document.createElement("strong");
        value.textContent = item.score + "/100 · " + item.label;
        value.style.color = item.score >= 70 ? "#39e6a5" : item.score >= 60 ? "#fbbf24" : "#cbd5e1";
        row.append(name, value);
        dominancePanel.appendChild(row);
        const breakdown = document.createElement("div");
        breakdown.textContent = item.components.map(part =>
          part.label + ": " + part.value + "/100 (" + part.weight + "%)"
        ).join(" · ");
        breakdown.style.cssText = "font-size:10px;color:#94a3b8;line-height:1.45;margin:0 0 6px;";
        dominancePanel.appendChild(breakdown);
      });
      const sample = document.createElement("div");
      sample.textContent = "Podklad: " + matchDominance.sampleCount + " meraní za " +
        matchDominance.spanMinutes + " minút. Zložky: aktuálny tlak 40 %, stabilita prevahy 35 %, trend oslabovania odporu 25 %.";
      sample.style.cssText = "font-size:10px;color:#94a3b8;line-height:1.45;margin-top:5px;";
      dominancePanel.appendChild(sample);
    } else {
      const waiting = document.createElement("div");
      waiting.textContent = matchDominance.reason;
      waiting.style.cssText = "font-size:10px;color:#94a3b8;";
      dominancePanel.appendChild(waiting);
    }
    const dominanceWarning = document.createElement("div");
    dominanceWarning.textContent = "Súhrnný index troch LIVE ukazovateľov. Nie je to pravdepodobnosť gólu, dlhodobé hodnotenie tímu ani automatický stávkový signál.";
    dominanceWarning.style.cssText = "font-size:10px;color:#94a3b8;line-height:1.4;margin-top:7px;";
    dominancePanel.appendChild(dominanceWarning);
    panel.appendChild(dominancePanel);

    const qualityScores = calculateSignalQuality(threat, snapshot, reliability, acceleration, collectedAt);
    const qualityPanel = document.createElement("div");
    qualityPanel.style.cssText = "margin-top:10px;padding:11px;background:#142338;border:1px solid #38516e;border-radius:9px;";
    const qualityHeading = document.createElement("div");
    qualityHeading.textContent = "AI QUALITY SCORE · 0–100";
    qualityHeading.style.cssText = "font-size:11px;font-weight:900;color:#e2e8f0;margin-bottom:7px;";
    qualityPanel.appendChild(qualityHeading);

    if (qualityScores.ready) {
      ["home", "away"].forEach(side => {
        const item = qualityScores.sides[side];
        const label = side === "home" ? "DOMÁCI" : "HOSTIA";
        const color = item.score >= 80 ? "#39e6a5" : item.score >= 65 ? "#fbbf24" : "#cbd5e1";
        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;margin:7px 0;font-size:11px;";
        const name = document.createElement("strong");
        name.textContent = label;
        name.style.color = "#cbd5e1";
        const value = document.createElement("strong");
        value.textContent = item.score + "/100 · " + item.label;
        value.style.color = color;
        row.append(name, value);
        qualityPanel.appendChild(row);
        const track = document.createElement("div");
        track.style.cssText = "height:7px;background:#26384d;border-radius:8px;overflow:hidden;";
        const fill = document.createElement("div");
        fill.style.cssText = "height:100%;width:" + item.score + "%;background:" + color + ";border-radius:8px;";
        track.appendChild(fill);
        qualityPanel.appendChild(track);
      });
      const method = document.createElement("div");
      method.textContent = "Váhy: kvalita dát 25 %, čerstvosť 20 %, GOAL THREAT 20 %, aktivita 20 %" +
        (qualityScores.sides.home.accelerationIncluded ? ", zrýchlenie 15 %." : ". Zrýchlenie zatiaľ chýba; jeho váha sa rozdelila medzi dostupné zložky.");
      method.style.cssText = "font-size:10px;color:#94a3b8;margin-top:7px;line-height:1.45;";
      qualityPanel.appendChild(method);
    } else {
      const waiting = document.createElement("div");
      waiting.textContent = qualityScores.reason;
      waiting.style.cssText = "font-size:10px;color:#94a3b8;line-height:1.45;";
      qualityPanel.appendChild(waiting);
    }
    const qualityWarning = document.createElement("div");
    qualityWarning.textContent = "Interné hodnotenie kvality dát a hernej aktivity – nie percentuálna šanca na gól ani potvrdený zisk.";
    qualityWarning.style.cssText = "font-size:10px;color:#94a3b8;margin-top:7px;line-height:1.4;";
    qualityPanel.appendChild(qualityWarning);
    panel.appendChild(qualityPanel);

    const disclaimer = document.createElement("div");
    disclaimer.textContent = "Informačný prehľad, nie samostatný predikčný ani stávkový signál.";
    disclaimer.style.cssText = "font-size:10px;color:#94a3b8;margin-top:7px;";
    panel.appendChild(disclaimer);
    target.appendChild(panel);
  }


  function makeSignal(match, threat, snapshot, collectedAt, qualityScores = null) {
    const minute = Number(match.live_minute);

    if (!threat || !snapshot.ready) return null;
    if (!Number.isFinite(minute) || minute < 10 || minute > 90) return null;

    const age = Date.now() - Date.parse(collectedAt || "");

    if (
      !Number.isFinite(age) ||
      age < 0 ||
      age > MAX_DATA_AGE_MS
    ) {
      return null;
    }

    const candidates = [
      {
        side: "home",
        team: match.home,
        score: threat.home,
        activity: snapshot.homeActivityRate,
        difference: threat.home - threat.away,
        qualityScore: qualityScores?.ready ? qualityScores.sides.home.score : null
      },
      {
        side: "away",
        team: match.away,
        score: threat.away,
        activity: snapshot.awayActivityRate,
        difference: threat.away - threat.home,
        qualityScore: qualityScores?.ready ? qualityScores.sides.away.score : null
      }
    ];

    return candidates.find(item =>
      item.score >= 65 &&
      item.activity >= 4 &&
      item.difference >= 3
    ) || null;
  }

  function recordSignal(match, signal) {
    const id = matchId(match);
    const minute = Number(match.live_minute);

    const existing = signalHistory.find(item =>
      item.matchId === id &&
      item.side === signal.side &&
      item.status === "OPEN"
    );

    if (existing) return;

    signalHistory.push({
      matchId: id,
      home: match.home,
      away: match.away,
      side: signal.side,
      team: signal.team,
      startGoals: signal.side === "home"
        ? Number(match.home_score || 0)
        : Number(match.away_score || 0),
      startScore: String(Number(match.home_score || 0)) + ":" + String(Number(match.away_score || 0)),
      startMinute: minute,
      deadlineMinute: Math.min(90, minute + 15),
      createdAt: new Date().toISOString(),
      status: "OPEN",
      ...(Number.isFinite(signal.qualityScore) ? {
        qualityScore: signal.qualityScore,
        qualityScoreVersion: "ai-quality-v1"
      } : {})
    });

    saveSignals();
  }

  // Signál vyhodnocuj iba z aktuálne dostupného zápasu.
  // Ak zápas zmizne z LIVE feedu, ponechaj ho OPEN: samotné zmiznutie
  // nie je dôkazom výhry ani prehry. Na uzavretie treba potvrdený výsledok.
  function settleSignals(matches) {
    let changed = false;

    signalHistory.forEach(signal => {
      if (signal.status !== "OPEN") return;

      const match = matches.find(item =>
        matchId(item) === signal.matchId
      );

      if (!match) return;

      const rawGoals = signal.side === "home"
        ? match.home_score
        : match.away_score;
      const goals = Number(rawGoals);
      const startGoals = Number(signal.startGoals);
      const minute = Number(match.live_minute);
      const homeScore = Number(match.home_score);
      const awayScore = Number(match.away_score);
      const status = (
        getStatus(match) + " " + String(match.status_text || "")
      ).toLowerCase();

      if (
        rawGoals === null ||
        rawGoals === undefined ||
        !Number.isFinite(goals) ||
        !Number.isFinite(startGoals) ||
        !Number.isFinite(homeScore) ||
        !Number.isFinite(awayScore)
      ) {
        return;
      }

      if (goals > startGoals) {
        signal.status = Number.isFinite(minute) && minute <= Number(signal.deadlineMinute)
          ? "WIN"
          : "UNRESOLVED";
        signal.settledAt = new Date().toISOString();
        signal.settledMinute = Number.isFinite(minute) ? minute : null;
        signal.settledScore = String(homeScore) + ":" + String(awayScore);
        if (signal.status === "UNRESOLVED") {
          signal.settlementNote = "Gól bol prvýkrát zaznamenaný po limite; presný čas gólu nie je potvrdený.";
        }
        changed = true;
      } else if (
        (Number.isFinite(minute) && minute >= Number(signal.deadlineMinute)) ||
        status.includes("finished")
      ) {
        signal.status = "LOSS";
        signal.settledAt = new Date().toISOString();
        signal.settledMinute = Number.isFinite(minute) ? minute : null;
        signal.settledScore = String(homeScore) + ":" + String(awayScore);
        changed = true;
      }
    });

    if (changed) saveSignals();
  }

  function renderServerSignalArchive(data, target = greenSignalArchiveEl) {
    if (!target) return;
    target.innerHTML = "";
    const serverSignals = Array.isArray(data?.signals) ? data.signals : [];
    const localSignals = Array.isArray(signalHistory) ? signalHistory : [];

    // Spoj trvalý archív zo servera s históriou tohto prehliadača bez duplicít.
    const merged = new Map();
    const signalKey = item => [
      String(item.matchId || ""),
      String(item.side || ""),
      String(item.startMinute ?? ""),
      String(item.startGoals ?? "")
    ].join("|");

    localSignals.forEach(item => {
      if (!item || !item.matchId) return;
      merged.set(signalKey(item), { ...item, archiveSource: "browser" });
    });

    serverSignals.forEach(item => {
      if (!item || !item.matchId) return;
      const key = signalKey(item);
      const previous = merged.get(key);
      const previousSettled = previous && ["WIN", "LOSS", "UNRESOLVED"].includes(previous.status);
      const serverSettled = ["WIN", "LOSS", "UNRESOLVED"].includes(item.status);
      const combined = { ...(previous || {}), ...item, archiveSource: previous ? "both" : "server" };
      if (previousSettled && !serverSettled) {
        combined.status = previous.status;
        combined.settledAt = previous.settledAt;
        combined.settledScore = previous.settledScore || combined.settledScore;
        combined.settledMinute = previous.settledMinute ?? combined.settledMinute;
      }
      merged.set(key, combined);
    });

    const signals = [...merged.values()];
    if (greenSignalArchiveCountEl) greenSignalArchiveCountEl.textContent = String(signals.length);
    const wins = signals.filter(item => item.status === "WIN").length;
    const losses = signals.filter(item => item.status === "LOSS").length;
    const unresolved = signals.filter(item => item.status === "UNRESOLVED").length;
    const open = signals.filter(item => item.status === "OPEN").length;
    const evaluated = wins + losses;
    const rate = evaluated ? Math.round(wins / evaluated * 100) : 0;
    const settledSignals = signals.filter(item => item.status === "WIN" || item.status === "LOSS");

    const heading = document.createElement("div");
    heading.textContent = "ZELENÝ SIGNÁL · ARCHÍV A VÝSLEDKY";
    heading.style.cssText = "font-size:15px;font-weight:900;letter-spacing:.3px;color:#e2e8f0;margin:2px 0 10px;";
    target.appendChild(heading);

    const summary = document.createElement("div");
    summary.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:8px 0 10px;";
    const metric = (label, value, color) => {
      const tile = document.createElement("div");
      tile.style.cssText = "min-width:0;padding:10px;background:#102033;border:1px solid #2c4058;border-radius:9px;";
      const number = document.createElement("div");
      number.textContent = String(value);
      number.style.cssText = "font-size:21px;font-weight:900;color:" + color + ";font-variant-numeric:tabular-nums;";
      const caption = document.createElement("div");
      caption.textContent = label;
      caption.style.cssText = "font-size:10px;font-weight:800;color:#aebed0;margin-top:2px;";
      tile.append(number, caption);
      summary.appendChild(tile);
    };
    metric("SPOLU SIGNÁLOV", signals.length, "#f1f5f9");
    metric("ÚSPEŠNOSŤ · WIN / LOSS", rate + "%", evaluated ? "#4ade80" : "#cbd5e1");
    metric("VÝHRY", wins, "#4ade80");
    metric("PREHRY", losses, "#f87171");
    metric("OTVORENÉ", open, "#93c5fd");
    metric("NEOVERENÉ", unresolved, "#d6d3d1");
    target.appendChild(summary);

    const note = document.createElement("div");
    note.textContent = "Úspešnosť sa počíta iba z potvrdených výhier a prehier. Neoverené zápasy sa nezapočítavajú ako prehry.";
    note.style.cssText = "font-size:10px;line-height:1.45;color:#aebed0;margin:5px 0 12px;";
    target.appendChild(note);

    function createDetails(title, open = false) {
      const details = document.createElement("details");
      details.open = open;
      details.style.cssText = "margin:9px 0;padding:10px;background:#0c1929;border:1px solid #2c4058;border-radius:9px;";
      const summaryEl = document.createElement("summary");
      summaryEl.textContent = title;
      summaryEl.style.cssText = "cursor:pointer;font-size:12px;font-weight:900;color:#e2e8f0;outline:none;";
      details.appendChild(summaryEl);
      target.appendChild(details);
      return details;
    }

    const breakdownDetails = createDetails("📊 ANALÝZA ÚSPEŠNOSTI PODĽA PODMIENOK", false);
    const breakdown = document.createElement("div");
    breakdown.style.cssText = "padding-top:8px;";
    breakdownDetails.appendChild(breakdown);

    function renderBreakdown(title, keyFn) {
      const groups = new Map();
      settledSignals.forEach(item => {
        const key = keyFn(item);
        if (!key) return;
        if (!groups.has(key)) groups.set(key, { wins: 0, losses: 0 });
        const group = groups.get(key);
        if (item.status === "WIN") group.wins++;
        else group.losses++;
      });

      const section = document.createElement("div");
      section.style.cssText = "margin:10px 0;padding-top:8px;border-top:1px solid #263a52;";
      const label = document.createElement("div");
      label.textContent = title;
      label.style.cssText = "font-size:11px;font-weight:900;color:#cbd5e1;margin-bottom:6px;";
      section.appendChild(label);
      if (!groups.size) {
        const empty = document.createElement("div");
        empty.textContent = "Zatiaľ nedostatok vyhodnotených dát.";
        empty.style.cssText = "font-size:11px;color:#94a3b8;";
        section.appendChild(empty);
      } else {
        [...groups.entries()]
          .sort((a, b) => {
            const na = a[1].wins + a[1].losses;
            const nb = b[1].wins + b[1].losses;
            return nb - na || String(a[0]).localeCompare(String(b[0]), "sk");
          })
          .forEach(([key, value]) => {
            const count = value.wins + value.losses;
            const percent = Math.round(value.wins / count * 100);
            const row = document.createElement("div");
            row.style.cssText = "display:flex;justify-content:space-between;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #1e3045;font-size:11px;";
            const name = document.createElement("span");
            name.textContent = key + (count < 10 ? " · malá vzorka" : "");
            name.style.cssText = "color:#cbd5e1;min-width:0;";
            const result = document.createElement("strong");
            result.textContent = percent + "%  ·  " + value.wins + "V / " + value.losses + "P  ·  N=" + count;
            result.style.cssText = "color:" + (percent >= 60 ? "#4ade80" : percent >= 50 ? "#fbbf24" : "#f87171") + ";white-space:nowrap;font-variant-numeric:tabular-nums;";
            row.append(name, result);
            section.appendChild(row);
          });
      }
      breakdown.appendChild(section);
    }

    renderBreakdown("PODĽA MINÚTY", item => {
      const minute = Number(item.startMinute);
      if (!Number.isFinite(minute)) return null;
      const from = Math.floor(minute / 10) * 10;
      return from + "–" + (from + 9) + ". min";
    });
    renderBreakdown("PODĽA POČIATOČNÉHO SKÓRE", item => {
      const score = String(item.startScore || "").trim();
      return /^\d+[:\\-]\d+$/.test(score) ? score.replace("-", ":") : null;
    });
    renderBreakdown("PODĽA STRANY", item =>
      item.side === "home" ? "Domáci" : item.side === "away" ? "Hostia" : null
    );
    renderBreakdown("PODĽA PREVAHY MOMENTA", item =>
      item.momentumSide === "home" ? "Prevaha domácich" :
      item.momentumSide === "away" ? "Prevaha hostí" : null
    );
    renderBreakdown("PODĽA SILY MOMENTA", item =>
      item.momentumStrength === "slight" ? "Mierne (3–9)" :
      item.momentumStrength === "medium" ? "Stredné (10–19)" :
      item.momentumStrength === "strong" ? "Silné (20+)" : null
    );
    renderBreakdown("PODĽA AKTIVITY PREDIKOVANÉHO TÍMU", item => {
      const activity = Number(item.activityRate);
      if (!Number.isFinite(activity)) return null;
      return activity < 6 ? "Nižšia (<6)" : activity < 10 ? "Stredná (6–9,9)" : "Vysoká (10+)";
    });

    const recent = [...signals].sort((a, b) =>
      Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)
    ).slice(0, 100);
    const historyDetails = createDetails("🗂 HISTÓRIA SIGNÁLOV · POSLEDNÝCH 100", true);
    const history = document.createElement("div");
    history.style.cssText = "padding-top:8px;";
    historyDetails.appendChild(history);

    recent.forEach(item => {
      const statusLabels = { WIN: "VÝHRA", LOSS: "PREHRA", OPEN: "OTVORENÝ", UNRESOLVED: "NEOVERENÝ" };
      const styles = {
        WIN: { background: "#052e1b", border: "#22c55e", color: "#4ade80" },
        LOSS: { background: "#3b0a0a", border: "#ef4444", color: "#f87171" },
        OPEN: { background: "#172554", border: "#3b82f6", color: "#93c5fd" },
        UNRESOLVED: { background: "#292524", border: "#a8a29e", color: "#d6d3d1" }
      };
      const style = styles[item.status] || { background: "#0d1929", border: "#31445c", color: "#cbd5e1" };
      const card = document.createElement("div");
      card.style.cssText = "margin:8px 0;padding:10px;border-radius:9px;background:" + style.background + ";border:1px solid " + style.border + ";";
      const top = document.createElement("div");
      top.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;gap:8px;";
      const teams = document.createElement("strong");
      teams.textContent = (item.home || "?") + " – " + (item.away || "?");
      teams.style.cssText = "font-size:12px;line-height:1.35;color:#f1f5f9;min-width:0;";
      const badge = document.createElement("span");
      badge.textContent = statusLabels[item.status] || String(item.status || "NEZNÁMY");
      badge.style.cssText = "flex:none;font-size:9px;font-weight:900;padding:4px 6px;border-radius:6px;background:#0b1220;color:" + style.color + ";border:1px solid " + style.border + ";";
      top.append(teams, badge);

      const scoreline = document.createElement("div");
      scoreline.textContent = "Pri signále " + (item.startScore || "?") + "  ·  " + (item.startMinute ?? "?") + ". min  ·  " + (item.team || (item.side === "home" ? "Domáci" : "Hostia"));
      scoreline.style.cssText = "font-size:11px;color:#cbd5e1;margin-top:6px;";
      const quality = document.createElement("div");
      const hasQuality = item.qualityScoreVersion === "ai-quality-v1" &&
        Number.isFinite(Number(item.qualityScore));
      quality.textContent = hasQuality
        ? "AI QUALITY SCORE: " + Number(item.qualityScore) + "/100"
        : "AI QUALITY SCORE: pri vzniku nebolo uložené";
      quality.style.cssText = "font-size:10px;font-weight:800;color:" +
        (hasQuality ? (Number(item.qualityScore) >= 80 ? "#4ade80" : Number(item.qualityScore) >= 65 ? "#fbbf24" : "#cbd5e1") : "#94a3b8") +
        ";margin-top:5px;";
      const outcome = document.createElement("div");
      outcome.textContent = item.settledScore
        ? "Konečné vyhodnotenie: " + item.settledScore + (item.settledMinute != null ? " · " + item.settledMinute + ". min" : "")
        : item.status === "OPEN" ? "Čaká sa na potvrdenie výsledku."
        : item.status === "UNRESOLVED" ? "Výsledok sa nepodarilo spoľahlivo overiť."
        : "Výsledok zatiaľ nie je doplnený.";
      outcome.style.cssText = "font-size:10px;color:" + style.color + ";margin-top:4px;";
      const momentumDetail = Number.isFinite(Number(item.pressureHome)) &&
        Number.isFinite(Number(item.pressureAway)) &&
        Number.isFinite(Number(item.activityHome)) &&
        Number.isFinite(Number(item.activityAway))
        ? "Tlak D/H " + item.pressureHome + "/" + item.pressureAway +
          "  ·  Aktivita D/H " + item.activityHome + "/" + item.activityAway +
          "  ·  Momentum " + (item.momentumStrength || "—") + " (" + (item.momentumDiff ?? "—") + ")"
        : "Momentum: historický snapshot nie je dostupný.";
      const extra = document.createElement("div");
      extra.textContent = momentumDetail;
      extra.style.cssText = "font-size:10px;color:#94a3b8;margin-top:6px;line-height:1.4;";
      const analysis = item.momentumAnalysis;
      if (analysis && analysis.version === "momentum-archive-v1") {
        const details = document.createElement("details");
        details.style.cssText = "margin-top:8px;padding:8px;background:#0c1929;border:1px solid #344b65;border-radius:8px;";
        const summary = document.createElement("summary");
        summary.textContent = "Zobraziť uloženú AI analýzu momenta";
        summary.style.cssText = "cursor:pointer;font-size:10px;font-weight:800;color:#93c5fd;";
        details.appendChild(summary);
        const body = document.createElement("div");
        body.style.cssText = "font-size:10px;color:#cbd5e1;line-height:1.6;margin-top:7px;";
        const line = (label, value) => {
          const div = document.createElement("div");
          div.textContent = label + ": " + value;
          body.appendChild(div);
        };
        line("Tlak D/H", analysis.pressure?.home + "/" + analysis.pressure?.away);
        line("Aktivita D/H", analysis.activityRate?.home + "/" + analysis.activityRate?.away);
        line("GOAL THREAT D/H", analysis.goalThreat?.home + "/" + analysis.goalThreat?.away);
        line("TEAM POWER D/H", analysis.teamPower?.home + "/100 · " + analysis.teamPower?.away + "/100");
        line("TEAM CONSISTENCY", analysis.consistency
          ? analysis.consistency.home.score + "/100 · " + analysis.consistency.away.score + "/100 (" + analysis.consistency.count + " meraní)"
          : "nedostatok historických meraní");
        line("OPPONENT WEAKNESS", analysis.opponentWeakness
          ? analysis.opponentWeakness.sides.home.score + "/100 · " + analysis.opponentWeakness.sides.away.score + "/100"
          : "nedostatok historických meraní");
        line("MATCH DOMINANCE", analysis.matchDominance
          ? analysis.matchDominance.home + "/100 · " + analysis.matchDominance.away + "/100"
          : "nedostupné");
        line("ZRÝCHLENIE", analysis.acceleration
          ? "domáci " + analysis.acceleration.homeDelta + " · hostia " + analysis.acceleration.awayDelta
          : "nedostatok intervalov");
        line("QUALITY SCORE", analysis.qualityScore == null ? "nedostupné" : analysis.qualityScore + "/100");
        const note = document.createElement("div");
        note.textContent = "Snapshot uložený pri vzniku signálu. Staršie signály bez tohto poľa spätne nedopočítavame.";
        note.style.cssText = "font-size:9px;color:#94a3b8;margin-top:6px;";
        body.appendChild(note);
        details.appendChild(body);
        card.appendChild(details);
      } else {
        const legacy = document.createElement("div");
        legacy.textContent = "Rozšírená AI analýza momenta nebola pri tomto historickom signále uložená.";
        legacy.style.cssText = "font-size:9px;color:#94a3b8;margin-top:6px;";
        card.appendChild(legacy);
      }
      card.append(top, scoreline, quality, outcome, extra);
      history.appendChild(card);
    });

    if (!recent.length) {
      const empty = document.createElement("div");
      empty.textContent = "Zatiaľ nie sú uložené žiadne zelené signály.";
      empty.style.cssText = "font-size:11px;color:#94a3b8;padding:8px 0;";
      history.appendChild(empty);
    } else if (signals.length > recent.length) {
      const info = document.createElement("div");
      info.textContent = "Zobrazených posledných " + recent.length + " záznamov z celkových " + signals.length + ".";
      info.style.cssText = "font-size:10px;color:#94a3b8;margin-top:8px;";
      history.appendChild(info);
    }
  }


  function renderBttsSignalArchive(data, target = bttsSignalArchiveEl) {
    if (!target) return;
    target.innerHTML = "";
    const signals = Array.isArray(data?.signals) ? data.signals.slice() : [];
    if (bttsSignalArchiveCountEl) bttsSignalArchiveCountEl.textContent = String(signals.length);
    const tiers = [
      ["10_sot5_shots8", "1:0 · SOT ≥5 · strely ≥8"],
      ["10_sot5_shots10", "1:0 · SOT ≥5 · strely ≥10"],
      ["10_sot5_shots12", "1:0 · SOT ≥5 · strely ≥12"],
      ["01_sot6_shots8", "0:1 · SOT ≥6 · strely ≥8"],
    ];
    const totalWins = signals.filter(x => x.status === "WIN").length;
    const totalLosses = signals.filter(x => x.status === "LOSS").length;
    const totalOpen = signals.filter(x => x.status === "OPEN").length;
    const totalUnresolved = signals.filter(x => x.status === "UNRESOLVED").length;
    const evaluated = totalWins + totalLosses;
    addText(target, `Zdroj: výhradne Flashscore | spolu: ${signals.length} | WIN: ${totalWins} | LOSS: ${totalLosses} | otvorené: ${totalOpen} | úspešnosť: ${evaluated ? Math.round(totalWins / evaluated * 100) + "%" : "zatiaľ bez výsledkov"}`);
    addText(target, "Úspešnosť počíta iba potvrdené WIN/LOSS. Neoverené a otvorené signály sa do percenta nezapočítavajú.");
    tiers.forEach(([key, label]) => {
      const rows = signals.filter(x => x.tierKey === key);
      const wins = rows.filter(x => x.status === "WIN").length;
      const losses = rows.filter(x => x.status === "LOSS").length;
      const open = rows.filter(x => x.status === "OPEN").length;
      const unresolved = rows.filter(x => x.status === "UNRESOLVED").length;
      const evaluated = wins + losses;
      const card = document.createElement("div");
      card.style.cssText = "margin:12px 0;padding:12px;border:1px solid #2563eb;border-radius:10px;background:#101b2b;";
      const heading = document.createElement("div");
      heading.textContent = label;
      heading.style.cssText = "font-weight:900;color:#93c5fd;margin-bottom:7px;";
      const summary = document.createElement("div");
      summary.textContent = `Vzorka: ${rows.length} | WIN: ${wins} | LOSS: ${losses} | OPEN: ${open} | neoverené: ${unresolved} | úspešnosť: ${evaluated ? Math.round(wins / evaluated * 100) + "%" : "bez výsledkov"}${evaluated < 10 ? " · malá vzorka" : ""}`;
      summary.style.cssText = "font-size:12px;line-height:1.6;color:#e2e8f0;";
      card.append(heading, summary);
      target.appendChild(card);
    });
    const capturedLate = data?.captured_signals_after70_analysis;
    const capturedTitle = document.createElement("div");
    capturedTitle.textContent = "VYHODNOTENIE ZACHYTENÝCH BTTS SIGNÁLOV PO 70. MINÚTE";
    capturedTitle.style.cssText = "font-size:14px;font-weight:900;color:#67e8f9;margin:18px 0 7px;";
    target.appendChild(capturedTitle);
    const capturedSummary = document.createElement("div");
    capturedSummary.style.cssText = "padding:12px;border:1px solid #0e7490;border-radius:10px;background:#0b2230;margin-bottom:10px;";
    const currentRetrospective = capturedLate?.schema_version === 3 && capturedLate?.ready === true;
    if (currentRetrospective) {
      const rate = capturedLate.win_rate == null ? "—" : Math.round(capturedLate.win_rate * 100) + "%";
      capturedSummary.textContent =
        "Zachytené zápasy: " + capturedLate.captured_signal_count +
        " · BTTS dokončené do 70. min.: " + capturedLate.completed_by_70_count +
        " · BTTS dokončené po 70. min.: " + capturedLate.completed_after_70_count +
        " · BTTS nedokončené: " + capturedLate.not_completed_count +
        " · bez dostatočnej časovej osi: " + (capturedLate.no_completion_observed_count + capturedLate.no_timeline_data_count) +
        " | Konečný výsledok: WIN " + capturedLate.wins + " / LOSS " + capturedLate.losses +
        " / čaká " + capturedLate.pending + " · úspešnosť " + rate + ".";
    } else {
      capturedSummary.textContent = "Čakám na nové vyhodnotenie časov prvého dokončenia BTTS z uložených LIVE snímok. Staré štatistické podmienky po 70. minúte sa už nepoužívajú.";
    }
    target.appendChild(capturedSummary);
    if (currentRetrospective && capturedLate.generated_at) {
      const capturedGenerated = document.createElement("div");
      capturedGenerated.textContent = "Aktualizované: " + new Date(capturedLate.generated_at).toLocaleString("sk-SK");
      capturedGenerated.style.cssText = "font-size:10px;color:#94a3b8;margin:0 0 8px;";
      target.appendChild(capturedGenerated);
    }
    const capturedEntries = currentRetrospective && Array.isArray(capturedLate.entries) ? capturedLate.entries : [];
    const capturedDetails = document.createElement("details");
    capturedDetails.style.cssText = "margin:8px 0 14px;border:1px solid #24516a;border-radius:10px;background:#0d1b2a;overflow:hidden;";
    const capturedDetailsSummary = document.createElement("summary");
    capturedDetailsSummary.textContent = "ZOBRAZIŤ VŠETKY ZACHYTENÉ ZÁPASY (" + capturedEntries.length + ")";
    capturedDetailsSummary.style.cssText = "cursor:pointer;list-style:none;padding:12px;font-size:11px;font-weight:900;color:#a5f3fc;";
    capturedDetails.appendChild(capturedDetailsSummary);
    if (!currentRetrospective || !capturedEntries.length) {
      const empty = document.createElement("div");
      empty.textContent = currentRetrospective
        ? "Zatiaľ nie sú zachytené BTTS signály z 46.–50. minúty."
        : "Čakám na nové vyhodnotenie podľa uložených časových snímok.";
      empty.style.cssText = "padding:0 12px 12px;font-size:11px;color:#94a3b8;";
      capturedDetails.appendChild(empty);
    } else {
      capturedEntries.forEach(item => {
        const row = document.createElement("div");
        row.style.cssText = "margin:0 8px 8px;padding:10px;border:1px solid #24516a;border-radius:8px;background:#101b2b;";
        const status = item.status === "WIN" ? "BTTS VÝHRA" : item.status === "LOSS" ? "BTTS PREHRA" : "ČAKÁ NA VÝSLEDOK";
        const statusColor = item.status === "WIN" ? "#4ade80" : item.status === "LOSS" ? "#f87171" : "#fbbf24";
        const completionLabels = {
          ALREADY_MET_AT_SIGNAL:"BTTS UŽ SPLNENÉ PRI ZACHYTENÍ SIGNÁLU",
          COMPLETED_AFTER_70:"BTTS DOKONČENÉ PO 70. MINÚTE",
          COMPLETED_BY_70:"BTTS DOKONČENÉ DO 70. MINÚTY",
          NOT_COMPLETED:"BTTS SA NEDOKONČILO · aspoň jeden tím neskóroval",
          NO_COMPLETION_OBSERVED:"ČAS DOKONČENIA NEZACHYTENÝ V SNÍMKACH",
          NO_TIMELINE_DATA:"CHÝBA ČASOVÁ OS ZÁPASU"
        };
        const completionColors = {
          ALREADY_MET_AT_SIGNAL:"#60a5fa",
          COMPLETED_AFTER_70:"#4ade80",
          COMPLETED_BY_70:"#22d3ee",
          NOT_COMPLETED:"#f87171",
          NO_COMPLETION_OBSERVED:"#fbbf24",
          NO_TIMELINE_DATA:"#94a3b8"
        };
        const title = document.createElement("div");
        title.textContent = (item.homeTeam || "?") + " – " + (item.awayTeam || "?") +
          " · LIVE signál " + (item.signalStartMinute ?? "?") + ". min · skóre " + (item.signalStartScore || "?");
        title.style.cssText = "font-weight:800;color:#dbeafe;font-size:12px;line-height:1.45;";
        const league = document.createElement("div");
        league.textContent = item.competition || "Súťaž neuvedená";
        league.style.cssText = "font-size:10px;color:#94a3b8;margin-top:3px;";
        const signalStats = document.createElement("div");
        signalStats.textContent = (item.signalTier || "BTTS") +
          " · pri signále SOT " + (item.signalSot ?? "—") +
          " · strely " + (item.signalShots ?? "—");
        signalStats.style.cssText = "font-size:10px;color:#cbd5e1;margin-top:5px;";
        const completion = document.createElement("div");
        let completionText = completionLabels[item.completionStatus] || "ČAS DOKONČENIA BTTS NEZNÁMY";
        if (item.bttsCompletedMinute != null) {
          completionText += " · " + item.bttsCompletedMinute + ". min · skóre " + (item.bttsCompletedScore || "—");
        }
        completion.textContent = completionText;
        completion.style.cssText = "font-size:10px;font-weight:900;color:" +
          (completionColors[item.completionStatus] || "#cbd5e1") + ";margin-top:6px;line-height:1.45;";
        const result = document.createElement("div");
        result.textContent = status + (item.finalScore ? " · konečný stav " + item.finalScore : "");
        result.style.cssText = "font-size:10px;font-weight:900;color:" + statusColor + ";margin-top:4px;";
        const stamp = document.createElement("div");
        stamp.textContent = item.signalCreatedAt
          ? "Signál zachytený: " + new Date(item.signalCreatedAt).toLocaleString("sk-SK")
          : "Čas signálu nie je dostupný";
        stamp.style.cssText = "font-size:9px;color:#8293a8;margin-top:4px;";
        row.append(title, league, signalStats, completion, result, stamp);
        capturedDetails.appendChild(row);
      });
    }
    target.appendChild(capturedDetails);
    const recent = signals.sort((a,b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)).slice(0,150);
    addText(target, "JEDNOTLIVÉ BTTS SIGNÁLY", "15px");
    if (!recent.length) {
      addText(target, "Zatiaľ nie sú zaznamenané žiadne BTTS signály.");
      return;
    }
    recent.forEach(item => {
      const style = item.status === "WIN"
        ? ["#052e1b", "#22c55e", "#4ade80", "VÝHRA"]
        : item.status === "LOSS"
          ? ["#3b0a0a", "#ef4444", "#f87171", "PREHRA"]
          : item.status === "OPEN"
            ? ["#172554", "#3b82f6", "#93c5fd", "OTVORENÝ"]
            : ["#292524", "#a8a29e", "#d6d3d1", "NEOVERENÝ"];
      const row = document.createElement("div");
      row.style.cssText = `margin:8px 0;padding:10px;border-radius:9px;background:${style[0]};border:1px solid ${style[1]};`;
      const title = document.createElement("div");
      title.textContent = `${item.home || "?"} ${item.startScore ? "(" + item.startScore + ")" : ""} – ${item.away || "?"}`;
      title.style.cssText = "font-weight:800;margin-bottom:5px;";
      const detail = document.createElement("div");
      detail.textContent = `${item.source || "Flashscore"} | ${item.tier || item.tierKey || "BTTS"} | ${style[3]} | ${item.startMinute ?? "?"}. min | SOT ${item.combinedSot ?? "?"} | strely ${item.combinedShots ?? "?"}${item.settledScore ? " | konečný stav " + item.settledScore : ""}`;
      detail.style.cssText = `font-size:12px;line-height:1.5;color:${style[2]};font-weight:700;`;
      row.append(title, detail);
      target.appendChild(row);
    });
    if (signals.length > recent.length) addText(target, `Zobrazených posledných ${recent.length} záznamov z ${signals.length}.`);
    addText(target, "Prahy 1:0 sa môžu prekrývať: rovnaký zápas môže byť samostatne započítaný pri 8, 10 aj 12 strelách. Vzorky sa preto nesčítavajú.");
  }

  function renderFootballPerformanceCenter(greenArchive, bttsArchive) {
    const el = document.getElementById("football-model-performance-content");
    if (!el) return;
    const green = Array.isArray(greenArchive?.signals) ? greenArchive.signals : [];
    const btts = Array.isArray(bttsArchive?.signals) ? bttsArchive.signals : [];
    const stats = rows => { const w=rows.filter(x=>x.status==="WIN").length; const l=rows.filter(x=>x.status==="LOSS").length; const open=rows.filter(x=>x.status==="OPEN").length; const u=rows.filter(x=>x.status==="UNRESOLVED").length; const n=w+l; return {w,l,open,u,n,p:n?Math.round(w/n*100)+"%":"—"}; };
    const g=stats(green), b=stats(btts);
    const sourceOf = item => item.source || item.sourceSnapshot?.source || "Flashscore";
    const bttsFlashscore = stats(btts.filter(item => sourceOf(item) === "Flashscore"));
    const times=green.filter(x=>x.status==="WIN"&&Number.isFinite(Number(x.settledMinute))&&Number.isFinite(Number(x.startMinute))).map(x=>Number(x.settledMinute)-Number(x.startMinute)).filter(x=>x>=0&&x<=30);
    const avg=times.length?(times.reduce((a,v)=>a+v,0)/times.length).toFixed(1)+" min":"—";
    el.innerHTML="";
    const grid=document.createElement("div"); grid.style.cssText="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;"; el.appendChild(grid);
    const add=(label,value,detail)=>{const c=document.createElement("div");c.style.cssText="padding:11px;border:1px solid #344b65;border-radius:9px;background:#101b2b;";const v=document.createElement("div");v.textContent=value;v.style.cssText="font-size:20px;font-weight:900;color:#e2e8f0;";const l=document.createElement("div");l.textContent=label;l.style.cssText="font-size:10px;font-weight:800;color:#aebed0;margin-top:3px;";const d=document.createElement("div");d.textContent=detail;d.style.cssText="font-size:10px;color:#94a3b8;margin-top:4px;";c.append(v,l,d);grid.appendChild(c);};
    add("ZELENÝ · ÚSPEŠNOSŤ",g.p,g.w+" WIN / "+g.l+" LOSS · N="+g.n);
    add("ZELENÝ · PRIEM. ČAS DO GÓLU",avg,"Podľa prvého zachytenia gólu");
    add("BTTS · SPOLU",b.p,b.w+" WIN / "+b.l+" LOSS · N="+b.n);
    add("BTTS · FLASHSCORE",bttsFlashscore.p,bttsFlashscore.w+" WIN / "+bttsFlashscore.l+" LOSS · N="+bttsFlashscore.n);
    add("CELKOM ULOŽENÉ SIGNÁLY",String(green.length+btts.length),"Zelené "+green.length+" · BTTS "+btts.length);
    const note=document.createElement("p");note.textContent="Otvorené: zelené "+g.open+", BTTS "+b.open+" · Neoverené: zelené "+g.u+", BTTS "+b.u+". WIN rate počíta iba potvrdené WIN a LOSS. Čas do gólu je orientačný podľa prvého zachytenia v LIVE dátach.";note.style.cssText="font-size:10px;line-height:1.5;color:#aebed0;margin:9px 0;";el.appendChild(note);
    // Incidentná analýza používa výhradne snapshot zachytený v okamihu signálu.
    // Konečné incidenty zápasu sa sem nikdy nedosadzujú (ochrana pred look-ahead bias).
    const incidentSignals = green.filter(item =>
      item?.sourceSnapshot?.raw_match &&
      Array.isArray(item.sourceSnapshot.raw_match.incidents) &&
      Number.isFinite(Number(item.sourceSnapshot.minute ?? item.startMinute))
    );
    const parseIncidentMinute = value => {
      const match = String(value ?? "").trim().match(/^(\d+)(?:\+(\d+))?$/);
      return match ? Number(match[1]) + Number(match[2] || 0) : null;
    };
    const incidentRows = incidentSignals.map(item => {
      const minute = Number(item.sourceSnapshot.minute ?? item.startMinute);
      const incidents = item.sourceSnapshot.raw_match.incidents;
      const beforeSignal = incidents.filter(event => {
        const eventMinute = parseIncidentMinute(event?.time ?? event?.minute);
        return eventMinute !== null && eventMinute <= minute;
      });
      const redCard = beforeSignal.some(event =>
        /red.?card|červená karta/i.test(String(event?.type || event?.name || "")) ||
        Number(event?.type_id) === 4
      );
      const yellowCard = beforeSignal.some(event =>
        /yellow.?card|žltá karta/i.test(String(event?.type || event?.name || "")) ||
        Number(event?.type_id) === 3
      );
      return { item, redCard, yellowCard };
    });
    const settledRate = rows => {
      const wins = rows.filter(row => row.item.status === "WIN").length;
      const losses = rows.filter(row => row.item.status === "LOSS").length;
      const n = wins + losses;
      return { wins, losses, n, rate: n ? Math.round(wins / n * 100) + "%" : "—" };
    };
    const redRows = incidentRows.filter(row => row.redCard);
    const noRedRows = incidentRows.filter(row => !row.redCard);
    const redStats = settledRate(redRows);
    const noRedStats = settledRate(noRedRows);
    const incidentTitle = document.createElement("div");
    incidentTitle.textContent = "🟥 INCIDENTY V ČASE ZELENÉHO SIGNÁLU";
    incidentTitle.style.cssText = "font-size:13px;font-weight:900;color:#e2e8f0;margin:14px 0 7px;";
    el.appendChild(incidentTitle);
    const incidentGrid = document.createElement("div");
    incidentGrid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;";
    el.appendChild(incidentGrid);
    const incidentCard = (label, value, detail) => {
      const card = document.createElement("div");
      card.style.cssText = "padding:10px;border:1px solid #344b65;border-radius:9px;background:#101b2b;min-width:0;";
      const v = document.createElement("div");
      v.textContent = value;
      v.style.cssText = "font-size:18px;font-weight:900;color:#e2e8f0;";
      const l = document.createElement("div");
      l.textContent = label;
      l.style.cssText = "font-size:10px;font-weight:800;color:#aebed0;margin-top:3px;";
      const d = document.createElement("div");
      d.textContent = detail;
      d.style.cssText = "font-size:10px;color:#94a3b8;margin-top:4px;line-height:1.4;";
      card.append(v, l, d);
      incidentGrid.appendChild(card);
    };
    incidentCard("SIGNÁLY SO SNAPSHOTOM INCIDENTOV", incidentSignals.length + " / " + green.length,
      "Použiteľné záznamy s incidentmi zachytenými priamo pri signále");
    incidentCard("ČERVENÁ KARTA PRED SIGNÁLOM", redRows.length,
      "Len udalosti s potvrdenou minútou najneskôr v čase signálu");
    incidentCard("WIN RATE · ČERVENÁ KARTA", redStats.rate,
      redStats.wins + " WIN / " + redStats.losses + " LOSS · N=" + redStats.n);
    incidentCard("WIN RATE · BEZ ČERVENEJ KARTY", noRedStats.rate,
      noRedStats.wins + " WIN / " + noRedStats.losses + " LOSS · N=" + noRedStats.n);
    const incidentNote = document.createElement("p");
    incidentNote.textContent = "Žltá karta bola prítomná pred signálom v " +
      incidentRows.filter(row => row.yellowCard).length + " záznamoch. Do porovnania WIN rate vstupujú iba potvrdené WIN/LOSS; OPEN a UNRESOLVED sú vynechané. Aktuálne staršie signály bez sourceSnapshot sa nepočítajú. Malá vzorka nie je dôkazom vplyvu červenej karty.";
    incidentNote.style.cssText = "font-size:10px;line-height:1.5;color:#aebed0;margin:8px 0;";
    el.appendChild(incidentNote);
    if (!incidentSignals.length) {
      const waiting = document.createElement("p");
      waiting.textContent = "Čakám na nové zelené signály so snapshotom. Staršie záznamy bez presného stavu v okamihu signálu zámerne spätne nedopĺňam z konečných štatistík.";
      waiting.style.cssText = "font-size:10px;line-height:1.5;color:#fbbf24;";
      el.appendChild(waiting);
    }
    const warning=document.createElement("p");warning.textContent="Vzorka pod 10 je veľmi malá; pod 30 iba orientačná. Rozbory podľa minúty, skóre, ligy a štatistík sa aktivujú po doplnení týchto údajov do archívu.";warning.style.cssText="font-size:10px;line-height:1.5;color:#fbbf24;";el.appendChild(warning);
  }
  function renderApiDataQuality(current, matchArchive, permanentHistory) {
    const target = document.getElementById("api-data-quality-content");
    if (!target) return;
    target.innerHTML = "";

    const matches = new Map();
    const matchDetails = new Map();
    const addMatch = (id, candidates, source) => {
      if (!id) id = "unknown_" + matches.size;
      const key = String(id);
      if (!matches.has(key)) matches.set(key, new Set());
      const labels = matches.get(key);
      if (source && (!matchDetails.has(key) || source?.final_match || source?.match?.incidents || source?.incidents)) {
        matchDetails.set(key, source);
      }
      for (const stats of candidates) {
        if (!Array.isArray(stats)) continue;
        for (const item of stats) {
          const label = String(item?.label || item?.name || "").trim();
          if (label) labels.add(label);
        }
      }
    };
    const collectNestedStats = (value, found = [], depth = 0) => {
      if (!value || typeof value !== "object" || depth > 5) return found;
      if (Array.isArray(value)) {
        for (const item of value) collectNestedStats(item, found, depth + 1);
        return found;
      }
      if (Array.isArray(value.stats)) found.push(value.stats);
      for (const [key, child] of Object.entries(value)) {
        if (key !== "stats" && child && typeof child === "object") {
          collectNestedStats(child, found, depth + 1);
        }
      }
      return found;
    };
    // Zjednotenie ID naprieč LIVE feedom a archívmi:
    // SportScore tracker.id je preferované; pri starších záznamoch ho vieme
    // obnoviť z poslednej časti URL zápasu. Tým sa ten istý zápas nesčíta
    // samostatne len preto, že ho zdroje uložili v inom obale.
    const findCanonicalMatchId = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 7) return "";
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = findCanonicalMatchId(item, depth + 1);
          if (found) return found;
        }
        return "";
      }
      if (value.tracker?.id) return String(value.tracker.id);
      if (typeof value.url === "string") {
        const path = value.url.split(/[?#]/)[0];
        const last = path.split("/").filter(Boolean).pop() || "";
        if (/^[a-z0-9_-]{10,}$/i.test(last)) return last;
      }
      if (value.match && typeof value.match === "object") {
        const found = findCanonicalMatchId(value.match, depth + 1);
        if (found) return found;
      }
      for (const [key, child] of Object.entries(value)) {
        if (key === "stats" || key === "incidents") continue;
        if (child && typeof child === "object") {
          const found = findCanonicalMatchId(child, depth + 1);
          if (found) return found;
        }
      }
      return "";
    };

    for (const record of (Array.isArray(current?.records) ? current.records : [])) {
      const match = record?.match || {};
      const id = findCanonicalMatchId(match) ||
        (match.home && match.away ? [match.home, match.away, match.time || ""].join("_") : "");
      addMatch(id, collectNestedStats(match), match);
    }
    for (const item of (Array.isArray(matchArchive?.archived_matches) ? matchArchive.archived_matches : [])) {
      const id = findCanonicalMatchId(item) || item?.id ||
        (item?.final_match?.home && item?.final_match?.away
          ? [item.final_match.home, item.final_match.away, item.final_match.time || ""].join("_")
          : "");
      addMatch(id, collectNestedStats(item), item);
    }
    for (const item of (Array.isArray(permanentHistory) ? permanentHistory : [])) {
      const match = item?.final_match || item?.last_snapshot?.match || item?.match || {};
      const id = findCanonicalMatchId(item) || item?.id ||
        (match.home && match.away ? [match.home, match.away, match.time || ""].join("_") : "");
      addMatch(id, collectNestedStats(item));
    }

    const categoryMap = new Map();
    let observedMatches = 0;
    let totalCategoryMatches = 0;
    for (const [matchId, labels] of matches.entries()) {
      if (!labels.size) continue;
      observedMatches++;
      totalCategoryMatches += labels.size;
      for (const label of labels) {
        if (!categoryMap.has(label)) categoryMap.set(label, new Set());
        categoryMap.get(label).add(matchId);
      }
    }
    const categories = [...categoryMap.entries()]
      .map(([label, ids]) => ({ label, matches: ids.size }))
      .sort((a, b) => b.matches - a.matches || a.label.localeCompare(b.label, "sk"));
    // Doplnkové údaje z API: incidenty, polčasový stav a zostavy.
    // Každý zápas sa započíta iba raz; preferuje sa finálny/archívny objekt.
    const eventTotals = new Map();
    const eventMatches = new Map();
    let matchesWithIncidents = 0;
    let matchesWithLineups = 0;
    let matchesWithHalfTime = 0;
    const walkObjects = (value, visit, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 7) return;
      visit(value);
      if (Array.isArray(value)) {
        for (const child of value) walkObjects(child, visit, depth + 1);
      } else {
        for (const child of Object.values(value)) {
          if (child && typeof child === "object") walkObjects(child, visit, depth + 1);
        }
      }
    };
    for (const [matchId, source] of matchDetails.entries()) {
      const preferred = source?.final_match || source?.last_snapshot?.match || source?.match || source;
      let incidents = null;
      let hasLineups = false;
      let hasHalfTime = false;
      walkObjects(preferred, object => {
        if (!incidents && Array.isArray(object.incidents)) incidents = object.incidents;
        if (object.lineups && typeof object.lineups === "object") hasLineups = true;
        for (const [key, value] of Object.entries(object)) {
          if (/half.?time|half.?score|ht.?score/i.test(key) && value !== null && value !== undefined && value !== "") hasHalfTime = true;
        }
      });
      if (incidents?.length) {
        matchesWithIncidents++;
        const seenTypes = new Set();
        for (const event of incidents) {
          const type = String(event?.type || event?.type_id || "Neznámy typ").trim();
          eventTotals.set(type, (eventTotals.get(type) || 0) + 1);
          seenTypes.add(type);
        }
        for (const type of seenTypes) eventMatches.set(type, (eventMatches.get(type) || 0) + 1);
      }
      if (hasLineups) matchesWithLineups++;
      if (hasHalfTime) matchesWithHalfTime++;
    }

    const totalMatches = matches.size;
    const avg = observedMatches ? (totalCategoryMatches / observedMatches).toFixed(1) : "—";
    const coverage = totalMatches ? Math.round(observedMatches / totalMatches * 100) : 0;

    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;";
    target.appendChild(grid);
    const addCard = (label, value, detail) => {
      const card = document.createElement("div");
      card.style.cssText = "padding:11px;border:1px solid #35465e;border-radius:10px;background:#101b2b;min-width:0;";
      const name = document.createElement("div");
      name.textContent = label;
      name.style.cssText = "font-size:10px;color:#9baabe;margin-bottom:5px;font-weight:800;";
      const number = document.createElement("div");
      number.textContent = String(value);
      number.style.cssText = "font-size:19px;font-weight:900;color:#e2e8f0;overflow-wrap:anywhere;";
      const note = document.createElement("div");
      note.textContent = detail;
      note.style.cssText = "font-size:10px;color:#94a3b8;margin-top:4px;";
      card.append(name, number, note);
      grid.appendChild(card);
    };
    addCard("ROZPOZNANÉ KATEGÓRIE", categories.length, "Rôzne názvy štatistík z API");
    addCard("ZÁPASY SO ŠTATISTIKAMI", observedMatches, "Z "+totalMatches+" zápasových záznamov");
    addCard("POKRYTIE ZÁZNAMOV", coverage+"%", "Aspoň jedna štatistická kategória");
    addCard("PRIEMER KATEGÓRIÍ", avg, "Na zápas s dostupnými štatistikami");

    const heading = document.createElement("div");
    heading.textContent = "DOSTUPNOSŤ PODĽA KATEGÓRIE";
    heading.style.cssText = "font-size:12px;font-weight:900;margin:14px 0 8px;color:#dbeafe;";
    target.appendChild(heading);
    if (!categories.length) {
      addText(target, "Zatiaľ nie sú dostupné štatistiky na vyhodnotenie.");
    } else {
      for (const item of categories) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:space-between;gap:12px;padding:7px 9px;border-bottom:1px solid #26384d;font-size:12px;";
        const name = document.createElement("span");
        name.textContent = item.label;
        name.style.cssText = "color:#dbe5f0;overflow-wrap:anywhere;";
        const count = document.createElement("strong");
        count.textContent = item.matches+" / "+totalMatches+" záp.";
        count.style.cssText = "color:#39e6a5;white-space:nowrap;";
        row.append(name, count);
        target.appendChild(row);
      }
    }
    const extraHeading = document.createElement("div");
    extraHeading.textContent = "DOPLNKOVÉ ÚDAJE Z API";
    extraHeading.style.cssText = "font-size:12px;font-weight:900;margin:18px 0 8px;color:#dbeafe;";
    target.appendChild(extraHeading);
    const extraGrid = document.createElement("div");
    extraGrid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;";
    target.appendChild(extraGrid);
    const previousGrid = grid;
    const addExtraCard = (label, value, detail) => {
      const card = document.createElement("div");
      card.style.cssText = "padding:11px;border:1px solid #35465e;border-radius:10px;background:#101b2b;min-width:0;";
      const name = document.createElement("div"); name.textContent = label;
      name.style.cssText = "font-size:10px;color:#9baabe;margin-bottom:5px;font-weight:800;";
      const number = document.createElement("div"); number.textContent = String(value);
      number.style.cssText = "font-size:19px;font-weight:900;color:#e2e8f0;overflow-wrap:anywhere;";
      const note = document.createElement("div"); note.textContent = detail;
      note.style.cssText = "font-size:10px;color:#94a3b8;margin-top:4px;";
      card.append(name, number, note); extraGrid.appendChild(card);
    };
    addExtraCard("ZÁPASY S INCIDENTMI", matchesWithIncidents, "Z " + totalMatches + " unikátnych zápasov");
    addExtraCard("ZÁPASY S POLOČASOVÝM STAVOM", matchesWithHalfTime, "Dostupné HT / half-time polia");
    addExtraCard("ZÁPASY SO ZOSTAVAMI", matchesWithLineups, "Zostavy a náhradníci");
    addExtraCard("TYPY INCIDENTOV", eventTotals.size, "Rôzne typy udalostí v API");
    const eventHeading = document.createElement("div");
    eventHeading.textContent = "INCIDENTY PODĽA TYPU · POČET UDALOSTÍ / ZÁPASOV";
    eventHeading.style.cssText = "font-size:11px;font-weight:900;margin:14px 0 8px;color:#dbeafe;";
    target.appendChild(eventHeading);
    if (!eventTotals.size) addText(target, "Zatiaľ nie sú dostupné incidenty.");
    else {
      const eventRows = [...eventTotals.entries()].sort((a,b) => b[1]-a[1]);
      for (const [type, count] of eventRows) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:space-between;gap:12px;padding:7px 9px;border-bottom:1px solid #26384d;font-size:12px;";
        const name = document.createElement("span"); name.textContent = type;
        name.style.cssText = "color:#dbe5f0;overflow-wrap:anywhere;";
        const value = document.createElement("strong");
        value.textContent = count + " udal. / " + (eventMatches.get(type) || 0) + " záp.";
        value.style.cssText = "color:#39e6a5;white-space:nowrap;";
        row.append(name, value); target.appendChild(row);
      }
    }
    addText(target, "Štatistiky, incidenty, HT údaje a zostavy sa počítajú iba z polí skutočne prítomných v API. Zápasy sa deduplikujú podľa ID; chýbajúce údaje sa nepovažujú za nulu. Počty incidentov sú udalosti v uloženom zápase, nie počet historických LIVE snapshotov.");
  }

  function renderSystemStats(current, signalArchive, matchArchive) {
    if (!systemStatsEl) return;
    systemStatsEl.innerHTML = "";

    const collectedAt = Date.parse(current?.collected_at || "");
    const dataAge = Number.isFinite(collectedAt) ? Math.max(0, Date.now() - collectedAt) : null;
    const fresh = dataAge !== null && dataAge <= MAX_DATA_AGE_MS;
    const complete = current?.collection_complete === true && current?.data_status === "complete";
    const liveCount = Number.isFinite(Number(current?.live_count))
      ? Number(current.live_count)
      : (Array.isArray(current?.records) ? current.records.length : 0);

    const signals = Array.isArray(signalArchive?.signals) ? signalArchive.signals : null;
    const wins = signals ? signals.filter(item => item?.status === "WIN").length : null;
    const losses = signals ? signals.filter(item => item?.status === "LOSS").length : null;
    const open = signals ? signals.filter(item => item?.status === "OPEN").length : null;
    const unresolved = signals ? signals.filter(item => item?.status === "UNRESOLVED").length : null;

    const pendingMatches = Array.isArray(matchArchive?.pending_matches)
      ? matchArchive.pending_matches.length
      : null;
    const confirmedMatches = Array.isArray(matchArchive?.archived_matches)
      ? matchArchive.archived_matches.filter(item => item?.status_confirmation === "confirmed_finished").length
      : null;

    const signalTimes = (signals || [])
      .map(item => Date.parse(item?.createdAt || ""))
      .filter(Number.isFinite);
    const firstSignalAt = signalTimes.length ? Math.min(...signalTimes) : null;

    const fmt = value => Number.isFinite(value)
      ? new Date(value).toLocaleString("sk-SK")
      : "Nedostupné";
    const ageLabel = dataAge === null
      ? "Nedostupné"
      : dataAge < 60000
        ? Math.round(dataAge / 1000) + " s"
        : Math.floor(dataAge / 60000) + " min";
    const runStarted = Date.parse(current?.collection_started_at || "");
    const runDuration = Number.isFinite(runStarted) && Number.isFinite(collectedAt) && collectedAt >= runStarted
      ? Math.max(1, Math.round((collectedAt - runStarted) / 1000)) + " s"
      : "Nedostupné";
    let collectionDuration = "Zatiaľ bez zaznamenaného signálu";
    if (firstSignalAt !== null) {
      const elapsedHours = Math.floor(Math.max(0, Date.now() - firstSignalAt) / 3600000);
      const days = Math.floor(elapsedHours / 24);
      const hours = elapsedHours % 24;
      collectionDuration = days + " dní, " + hours + " hod.";
    }

    const statusLabel = complete && fresh
      ? "KOMPLETNÝ · AKTUÁLNY"
      : !fresh
        ? "ZASTARANÉ / NEDOSTUPNÉ"
        : "NEÚPLNÝ ZBER";

    const stat = (label, value, color = "#ffffff") => {
      const card = document.createElement("div");
      card.style.cssText = "padding:11px;border:1px solid #35465e;border-radius:10px;background:#101b2b;min-width:0;";
      const name = document.createElement("div");
      name.textContent = label;
      name.style.cssText = "font-size:11px;color:#9baabe;margin-bottom:6px;";
      const number = document.createElement("div");
      number.textContent = String(value);
      number.style.cssText = "font-size:19px;font-weight:900;color:" + color + ";overflow-wrap:anywhere;";
      card.append(name, number);
      systemStatsEl.appendChild(card);
    };

    const heading = document.createElement("div");
    heading.textContent = "STAV ZBERU A VÝSLEDKY";
    heading.style.cssText = "font-size:14px;font-weight:900;margin:4px 0 10px;";
    systemStatsEl.appendChild(heading);

    const status = document.createElement("div");
    status.textContent = "LIVE zber: " + statusLabel;
    status.style.cssText = "padding:10px;border-radius:9px;background:" +
      (complete && fresh ? "#123b32" : "#49321c") +
      ";border:1px solid " + (complete && fresh ? "#239b78" : "#c58a35") +
      ";font-weight:800;margin-bottom:10px;";
    systemStatsEl.appendChild(status);

    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;";
    systemStatsEl.appendChild(grid);

    const addGridStat = (label, value, color) => {
      const oldParent = systemStatsEl;
      const card = document.createElement("div");
      card.style.cssText = "padding:11px;border:1px solid #35465e;border-radius:10px;background:#101b2b;min-width:0;";
      const name = document.createElement("div");
      name.textContent = label;
      name.style.cssText = "font-size:11px;color:#9baabe;margin-bottom:6px;";
      const number = document.createElement("div");
      number.textContent = String(value);
      number.style.cssText = "font-size:19px;font-weight:900;color:" + (color || "#ffffff") + ";overflow-wrap:anywhere;";
      card.append(name, number);
      grid.appendChild(card);
    };

    addGridStat("LIVE zápasy", liveCount, "#39e6a5");
    addGridStat("Všetky signály", signals ? signals.length : "Nedostupné");
    addGridStat("WIN", wins === null ? "Nedostupné" : wins, "#39e6a5");
    addGridStat("LOSS", losses === null ? "Nedostupné" : losses, "#ff6464");
    addGridStat("OPEN", open === null ? "Nedostupné" : open, "#60a5fa");
    addGridStat("UNRESOLVED", unresolved === null ? "Nedostupné" : unresolved, "#aab3c2");
    addGridStat("Čaká na konečný výsledok", pendingMatches === null ? "Nedostupné" : pendingMatches);
    addGridStat("Potvrdené ukončené zápasy", confirmedMatches === null ? "Nedostupné" : confirmedMatches);

    // Analytika na úrovni zápasov: zachováva archív a oddeľuje opakované signály.
    const matchGroups = new Map();
    if (signals) {
      signals.forEach((item, index) => {
        const rawId = item?.matchId;
        const key = rawId !== null && rawId !== undefined && String(rawId).trim()
          ? String(rawId)
          : "__missing_match_id__" + index;
        if (!matchGroups.has(key)) matchGroups.set(key, []);
        matchGroups.get(key).push({ item, index });
      });
    }

    const uniqueMatchCount = signals ? matchGroups.size : null;
    const repeatedMatchGroups = signals
      ? [...matchGroups.values()].filter(group => group.length > 1)
      : [];
    const repeatedMatchCount = signals ? repeatedMatchGroups.length : null;
    const extraRepeatedSignals = signals
      ? repeatedMatchGroups.reduce((total, group) => total + group.length - 1, 0)
      : null;

    const firstSignalOutcomes = signals
      ? [...matchGroups.values()].map(group => {
          const ordered = group.slice().sort((a, b) => {
            const timeA = Date.parse(a.item?.createdAt || "");
            const timeB = Date.parse(b.item?.createdAt || "");
            if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
              return timeA - timeB;
            }
            if (Number.isFinite(timeA) && !Number.isFinite(timeB)) return -1;
            if (!Number.isFinite(timeA) && Number.isFinite(timeB)) return 1;
            return a.index - b.index;
          });
          return ordered[0]?.item?.status;
        }).filter(status => status === "WIN" || status === "LOSS")
      : [];
    const firstMatchWins = firstSignalOutcomes.filter(status => status === "WIN").length;
    const firstMatchLosses = firstSignalOutcomes.filter(status => status === "LOSS").length;
    const firstMatchSettled = firstMatchWins + firstMatchLosses;
    const firstMatchWinRate = firstMatchSettled
      ? Math.round(firstMatchWins / firstMatchSettled * 100) + "%"
      : "Zatiaľ bez vyhodnotenia";

    const matchAnalyticsHeading = document.createElement("div");
    matchAnalyticsHeading.textContent = "ANALYTIKA PODĽA UNIKÁTNYCH ZÁPASOV";
    matchAnalyticsHeading.style.cssText = "font-size:13px;font-weight:900;margin:18px 0 9px;color:#dbeafe;";
    systemStatsEl.appendChild(matchAnalyticsHeading);

    const matchAnalyticsGrid = document.createElement("div");
    matchAnalyticsGrid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;";
    systemStatsEl.appendChild(matchAnalyticsGrid);

    const addMatchAnalyticsStat = (label, value, detail, color) => {
      const card = document.createElement("div");
      card.style.cssText = "padding:11px;border:1px solid #35465e;border-radius:10px;background:#101b2b;min-width:0;";
      const name = document.createElement("div");
      name.textContent = label;
      name.style.cssText = "font-size:10px;color:#9baabe;margin-bottom:5px;font-weight:800;";
      const number = document.createElement("div");
      number.textContent = String(value);
      number.style.cssText = "font-size:18px;font-weight:900;color:" + (color || "#e2e8f0") + ";overflow-wrap:anywhere;";
      const note = document.createElement("div");
      note.textContent = detail;
      note.style.cssText = "font-size:10px;color:#94a3b8;margin-top:4px;line-height:1.4;";
      card.append(name, number, note);
      matchAnalyticsGrid.appendChild(card);
    };

    addMatchAnalyticsStat(
      "UNIKÁTNE ZÁPASY",
      uniqueMatchCount === null ? "Nedostupné" : uniqueMatchCount,
      "Zápasy zastúpené v archíve signálov"
    );
    addMatchAnalyticsStat(
      "ZÁPASY S OPAKOVANÍM",
      repeatedMatchCount === null ? "Nedostupné" : repeatedMatchCount,
      "Zápasy s viac než jedným signálom",
      repeatedMatchCount > 0 ? "#fbbf24" : "#39e6a5"
    );
    addMatchAnalyticsStat(
      "NADBYTOČNÉ SIGNÁLY",
      extraRepeatedSignals === null ? "Nedostupné" : extraRepeatedSignals,
      "Ďalšie signály nad prvý signál zápasu"
    );
    addMatchAnalyticsStat(
      "ÚSPEŠNOSŤ PRVÉHO SIGNÁLU",
      signals ? firstMatchWinRate : "Nedostupné",
      firstMatchSettled
        ? firstMatchWins + " WIN / " + firstMatchLosses + " LOSS · iba vyhodnotené prvé signály"
        : "Zatiaľ nie sú vyhodnotené prvé signály",
      firstMatchSettled && firstMatchWinRate !== "Zatiaľ bez vyhodnotenia"
        ? (firstMatchWins / firstMatchSettled >= 0.5 ? "#39e6a5" : "#fbbf24")
        : "#e2e8f0"
    );

    addText(
      systemStatsEl,
      "Táto analytika nemení ani nemaže historické záznamy. Prvý signál každého zápasu sa určuje podľa času vytvorenia; pri chýbajúcom čase sa zachová pôvodné poradie archívu. Do úspešnosti sa počítajú iba prvé signály so stavom WIN alebo LOSS. UNRESOLVED a OPEN sa vynechávajú. Ide o úspešnosť, nie ROI."
    );

    // Quality Score analytika používa výhradne skóre uložené v okamihu vzniku signálu.
    // Staršie záznamy bez qualityScore sa nikdy spätne neprepočítavajú.
    const qualitySignals = (signals || []).filter(item =>
      item?.qualityScoreVersion === "ai-quality-v1" &&
      Number.isFinite(Number(item.qualityScore)) &&
      Number(item.qualityScore) >= 0 &&
      Number(item.qualityScore) <= 100
    );
    const qualityBands = [
      { label: "POD 50", test: score => score < 50 },
      { label: "50–64", test: score => score >= 50 && score <= 64 },
      { label: "65–79", test: score => score >= 65 && score <= 79 },
      { label: "80–100", test: score => score >= 80 && score <= 100 }
    ];
    const qualityHeading = document.createElement("div");
    qualityHeading.textContent = "VÝSLEDKY PODĽA AI QUALITY SCORE";
    qualityHeading.style.cssText = "font-size:13px;font-weight:900;margin:18px 0 8px;color:#dbeafe;";
    systemStatsEl.appendChild(qualityHeading);
    const qualityMeta = document.createElement("div");
    qualityMeta.textContent = "Skóre uložené pri vzniku signálu: " + qualitySignals.length +
      " / " + (signals ? signals.length : 0) +
      " · bez historického spätného prepočtu: " + ((signals || []).length - qualitySignals.length);
    qualityMeta.style.cssText = "font-size:11px;color:#a8b8cc;margin-bottom:9px;line-height:1.45;";
    systemStatsEl.appendChild(qualityMeta);
    const qualityGrid = document.createElement("div");
    qualityGrid.style.cssText = "display:grid;grid-template-columns:1fr;gap:7px;";
    systemStatsEl.appendChild(qualityGrid);
    qualityBands.forEach(band => {
      const group = qualitySignals.filter(item => band.test(Number(item.qualityScore)));
      const winsInBand = group.filter(item => item.status === "WIN").length;
      const lossesInBand = group.filter(item => item.status === "LOSS").length;
      const openInBand = group.filter(item => item.status === "OPEN").length;
      const unresolvedInBand = group.filter(item => item.status === "UNRESOLVED").length;
      const settledInBand = winsInBand + lossesInBand;
      const rate = settledInBand ? Math.round(winsInBand / settledInBand * 100) + "%" : "Zatiaľ bez vyhodnotenia";

      // Jeden zápas môže vytvoriť viac signálov. Pre nezávislejší pohľad
      // započítaj v každom pásme iba jeho najskorší signál so skóre.
      const matchGroups = new Map();
      group.forEach((item, index) => {
        const rawId = item?.matchId;
        const key = rawId !== null && rawId !== undefined && String(rawId).trim()
          ? String(rawId)
          : "__missing_quality_match_id__" + index;
        if (!matchGroups.has(key)) matchGroups.set(key, []);
        matchGroups.get(key).push({ item, index });
      });
      const firstPerMatch = [...matchGroups.values()].map(entries =>
        entries.slice().sort((a, b) => {
          const ta = Date.parse(a.item?.createdAt || "");
          const tb = Date.parse(b.item?.createdAt || "");
          if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
          if (Number.isFinite(ta) && !Number.isFinite(tb)) return -1;
          if (!Number.isFinite(ta) && Number.isFinite(tb)) return 1;
          return a.index - b.index;
        })[0]?.item
      ).filter(Boolean);
      const uniqueWins = firstPerMatch.filter(item => item.status === "WIN").length;
      const uniqueLosses = firstPerMatch.filter(item => item.status === "LOSS").length;
      const uniqueOpen = firstPerMatch.filter(item => item.status === "OPEN").length;
      const uniqueUnresolved = firstPerMatch.filter(item => item.status === "UNRESOLVED").length;
      const uniqueSettled = uniqueWins + uniqueLosses;
      const uniqueRate = uniqueSettled
        ? Math.round(uniqueWins / uniqueSettled * 100) + "%"
        : "Zatiaľ bez vyhodnotenia";

      const row = document.createElement("div");
      row.style.cssText = "padding:10px;border:1px solid #35465e;border-radius:9px;background:#101b2b;";
      const title = document.createElement("div");
      title.textContent = band.label + " bodov · " + group.length + " signálov";
      title.style.cssText = "font-size:12px;font-weight:900;color:#fff;";
      const detail = document.createElement("div");
      detail.textContent = "Všetky signály: WIN " + winsInBand + " / LOSS " + lossesInBand +
        " · úspešnosť " + rate + " · OPEN " + openInBand + " · UNRESOLVED " + unresolvedInBand;
      detail.style.cssText = "font-size:11px;color:#b7c5d6;margin-top:5px;line-height:1.45;";
      const uniqueDetail = document.createElement("div");
      uniqueDetail.textContent = "Prvý signál v zápase: " + firstPerMatch.length +
        " záp. · WIN " + uniqueWins + " / LOSS " + uniqueLosses +
        " · úspešnosť " + uniqueRate + " · OPEN " + uniqueOpen + " · UNRESOLVED " + uniqueUnresolved;
      uniqueDetail.style.cssText = "font-size:10px;color:#94a3b8;margin-top:5px;line-height:1.45;";
      row.append(title, detail, uniqueDetail);
      qualityGrid.appendChild(row);
    });
    const qualityNote = document.createElement("div");
    qualityNote.textContent = "Upozornenie: zatiaľ ide o malú priebežnú vzorku. OPEN a UNRESOLVED sa nezapočítavajú do úspešnosti. Staré signály bez uloženého skóre zostávajú mimo porovnania. Úspešnosť nie je ROI ani dôkaz ziskovosti.";
    qualityNote.style.cssText = "font-size:10px;color:#94a3b8;margin-top:8px;line-height:1.45;";
    systemStatsEl.appendChild(qualityNote);

    // AI FILTER ENGINE v2: adaptívne sledovanie profilov nad prvým signálom
    // každého zápasu. Používajú sa len hodnoty uložené pri vzniku signálu.
    const filterHeading = document.createElement("div");
    filterHeading.textContent = "AI FILTER ENGINE v2 · ADAPTÍVNE SLEDOVANIE";
    filterHeading.style.cssText = "font-size:13px;font-weight:900;margin:18px 0 8px;color:#dbeafe;";
    systemStatsEl.appendChild(filterHeading);

    const firstSignalByMatch = new Map();
    (signals || []).forEach((item, index) => {
      const rawId = item?.matchId;
      const key = rawId !== null && rawId !== undefined && String(rawId).trim()
        ? String(rawId)
        : "__missing_filter_match_id__" + index;
      const prior = firstSignalByMatch.get(key);
      const time = Date.parse(item?.createdAt || "");
      const priorTime = prior ? Date.parse(prior.item?.createdAt || "") : NaN;
      if (!prior || (Number.isFinite(time) && (!Number.isFinite(priorTime) || time < priorTime))) {
        firstSignalByMatch.set(key, { item, index });
      }
    });
    const strictFirstSignals = [...firstSignalByMatch.values()]
      .sort((a, b) => a.index - b.index)
      .map(entry => entry.item);
    const strictFirstWithScore = strictFirstSignals.filter(item =>
      item?.qualityScoreVersion === "ai-quality-v1" &&
      typeof item.qualityScore === "number" &&
      Number.isFinite(item.qualityScore) &&
      item.qualityScore >= 0 && item.qualityScore <= 100
    );
    const strictFirstWithoutScore = strictFirstSignals.length - strictFirstWithScore.length;

    const filterProfiles = [
      { label: "Základ · prvý signál zápasu", test: () => true },
      { label: "GOAL THREAT ≥65", test: item => typeof item.goalThreat === "number" && Number.isFinite(item.goalThreat) && item.goalThreat >= 65 },
      { label: "GOAL THREAT ≥75", test: item => typeof item.goalThreat === "number" && Number.isFinite(item.goalThreat) && item.goalThreat >= 75 },
      { label: "Aktivita ≥10", test: item => typeof item.activityRate === "number" && Number.isFinite(item.activityRate) && item.activityRate >= 10 },
      { label: "Aktivita ≥15", test: item => typeof item.activityRate === "number" && Number.isFinite(item.activityRate) && item.activityRate >= 15 },
      { label: "GOAL THREAT ≥65 + aktivita ≥10", test: item =>
        typeof item.goalThreat === "number" && Number.isFinite(item.goalThreat) && item.goalThreat >= 65 &&
        typeof item.activityRate === "number" && Number.isFinite(item.activityRate) && item.activityRate >= 10 }
    ];
    const filterGrid = document.createElement("div");
    filterGrid.style.cssText = "display:grid;grid-template-columns:1fr;gap:7px;";
    systemStatsEl.appendChild(filterGrid);

    filterProfiles.forEach(profile => {
      const cohort = strictFirstSignals.filter(profile.test);
      const w = cohort.filter(item => item.status === "WIN").length;
      const l = cohort.filter(item => item.status === "LOSS").length;
      const o = cohort.filter(item => item.status === "OPEN").length;
      const u = cohort.filter(item => item.status === "UNRESOLVED").length;
      const settled = w + l;
      const rate = settled ? Math.round(w / settled * 100) + "%" : "Zatiaľ bez výsledkov";
      const row = document.createElement("div");
      row.style.cssText = "padding:10px;border:1px solid #35465e;border-radius:9px;background:#101b2b;";
      const title = document.createElement("div");
      title.textContent = profile.label;
      title.style.cssText = "font-size:12px;font-weight:900;color:#fff;";
      const detail = document.createElement("div");
      detail.textContent = cohort.length + " zápasov · WIN " + w + " / LOSS " + l +
        " · úspešnosť " + rate + " · OPEN " + o + " · UNRESOLVED " + u;
      detail.style.cssText = "font-size:11px;color:#b7c5d6;margin-top:5px;line-height:1.45;";
      const readiness = document.createElement("div");
      readiness.textContent = settled < 30
        ? "ZBIERAM VZORKU · chýba " + (30 - settled) + " vyhodnotených zápasov do prvého kontrolného bodu"
        : (w / settled >= 0.60
          ? "NA ĎALŠIE TESTOVANIE · úspešnosť ≥60 %, nie je to potvrdenie ziskovosti"
          : "BEZ POZITÍVNEHO SIGNÁLU · úspešnosť zatiaľ pod 60 %");
      readiness.style.cssText = "font-size:10px;color:" + (settled >= 30 && w / settled >= 0.60 ? "#fbbf24" : "#94a3b8") + ";margin-top:5px;";
      row.append(title, detail, readiness);
      filterGrid.appendChild(row);
    });

    const filterMeta = document.createElement("div");
    filterMeta.textContent = "Prísna kohorta: " + strictFirstSignals.length +
      " prvých signálov z unikátnych zápasov · s uloženým Quality Score: " +
      strictFirstWithScore.length + " · prvý signál bez Quality Score: " + strictFirstWithoutScore +
      ". Ak prvý signál zápasu nemá skóre, neskorší signál ho nenahrádza.";
    filterMeta.style.cssText = "font-size:11px;color:#a8b8cc;margin-top:8px;line-height:1.45;";
    systemStatsEl.appendChild(filterMeta);

    const filterNote = document.createElement("div");
    filterNote.textContent = "Adaptívny kontrolný bod je 30 vyhodnotených unikátnych zápasov na profil; hranica 60 % slúži iba na výber profilov na ďalšie testovanie. Profily sa môžu prekrývať. Chýbajúce metriky profil nespĺňajú a nepovažujú sa za nulu. Malá vzorka, úspešnosť bez kurzov a bez ROI nepreukazujú ziskovosť. Toto sledovanie nemení tvorbu signálov ani zber dát.";
    filterNote.style.cssText = "font-size:10px;color:#94a3b8;margin-top:8px;line-height:1.45;";
    systemStatsEl.appendChild(filterNote);

    addText(systemStatsEl, "Posledný kompletný zber: " +
      (complete ? fmt(collectedAt) : "aktuálny snapshot nie je potvrdený"));
    addText(systemStatsEl, "Vek posledných dát: " + ageLabel + " | Dĺžka posledného behu: " + runDuration);
    addText(systemStatsEl, "Zber signálov: " + collectionDuration +
      (firstSignalAt !== null ? " (od prvého zaznamenaného signálu)" : ""));
    addText(systemStatsEl, "Údaje sú počty z trvalého archívu. UNRESOLVED sa nezapočítava medzi prehry; percentá sa tu zámerne nezobrazujú.");
  }

  function renderMatchArchive(data) {
    if (!matchArchiveEl) return;
    matchArchiveData = data;
    matchArchiveEl.innerHTML = "";

    if (!data || data.source !== "Flashscore") {
      if (matchArchiveCountEl) matchArchiveCountEl.textContent = "Nedostupné";
      addText(matchArchiveEl, "Flashscore archív konečných výsledkov sa zatiaľ nenačítal.");
      return;
    }

    const pending = Array.isArray(data.pending_matches) ? data.pending_matches : [];
    const archived = Array.isArray(data.archived_matches) ? data.archived_matches : [];
    const confirmed = archived.filter(item =>
      item?.source === "Flashscore" &&
      item?.status_confirmation === "confirmed_finished" &&
      item?.final_status === "FINISHED" &&
      Number.isInteger(Number(item.home_score)) &&
      Number.isInteger(Number(item.away_score))
    ).sort((a, b) =>
      Date.parse(b.final_match?.time || b.archived_at || 0) -
      Date.parse(a.final_match?.time || a.archived_at || 0)
    );

    if (matchArchiveCountEl) matchArchiveCountEl.textContent = String(confirmed.length);
    addText(matchArchiveEl, "Zdroj: Flashscore · Potvrdené výsledky: " + confirmed.length +
      " · Ešte sa overuje: " + pending.length);

    const leagues = [...new Set(confirmed.map(item =>
      String(item.final_match?.competition || "").trim()
    ).filter(Boolean))].sort((a, b) => a.localeCompare(b, "sk"));
    if (matchArchiveLeagueEl) {
      const existing = [...matchArchiveLeagueEl.options].map(option => option.value);
      const desired = ["", ...leagues];
      if (existing.length !== desired.length || existing.some((value, index) => value !== desired[index])) {
        matchArchiveLeagueEl.innerHTML = "";
        desired.forEach((league, index) => {
          const option = document.createElement("option");
          option.value = league;
          option.textContent = index === 0 ? "Všetky ligy" : league;
          matchArchiveLeagueEl.appendChild(option);
        });
      }
      if (leagues.includes(archiveLeagueFilter)) matchArchiveLeagueEl.value = archiveLeagueFilter;
      else {
        archiveLeagueFilter = "";
        matchArchiveLeagueEl.value = "";
      }
    }
    if (matchArchiveDateEl && matchArchiveDateEl.value !== archiveDateDraft) {
      matchArchiveDateEl.value = archiveDateDraft;
    }
    if (matchArchiveApplyEl) matchArchiveApplyEl.disabled = !archiveDateDraft;

    const archiveDateKey = stamp => {
      const date = stamp ? new Date(stamp) : null;
      if (!date || Number.isNaN(date.getTime())) return "";
      try {
        const parts = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Bratislava",
          year: "numeric", month: "2-digit", day: "2-digit"
        }).formatToParts(date);
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return values.year && values.month && values.day
          ? values.year + "-" + values.month + "-" + values.day
          : "";
      } catch {
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
      }
    };

    const filtered = confirmed.filter(item => {
      const match = item.final_match || {};
      const league = String(match.competition || "").trim();
      const matchDate = archiveDateKey(match.time || item.archived_at);
      return (!archiveLeagueFilter || league === archiveLeagueFilter) &&
        (!archiveDateFilter || matchDate === archiveDateFilter);
    });
    addText(matchArchiveEl, "Zobrazené výsledky: " + filtered.length + " z " + confirmed.length);

    function addMatchRow(parent, title, detail, color, competition = "") {
      const row = document.createElement("div");
      row.style.cssText = "padding:12px;margin:9px 0;border-radius:10px;background:#101b2b;border:1px solid #2b3c52;";
      const heading = document.createElement("div");
      heading.textContent = title;
      heading.style.cssText = "font-size:14px;font-weight:800;line-height:1.45;color:#ffffff;";
      const score = document.createElement("div");
      score.textContent = detail;
      score.style.cssText = "font-size:17px;font-weight:900;color:" + color + ";margin-top:5px;";
      row.append(heading, score);
      if (competition) {
        const league = document.createElement("div");
        league.textContent = competition;
        league.style.cssText = "font-size:12px;color:#9baabe;margin-top:4px;";
        row.appendChild(league);
      }
      parent.appendChild(row);
    }

    if (pending.length) {
      addText(matchArchiveEl, "ZÁPASY, KTORÉ EŠTE ČAKAJÚ NA POTVRDENIE", "14px");
      pending.slice().sort((a, b) =>
        Date.parse(b.last_missing_at || 0) - Date.parse(a.last_missing_at || 0)
      ).slice(0, 20).forEach(item => {
        const match = item.last_snapshot?.match || {};
        addMatchRow(
          matchArchiveEl,
          (match.home || "?") + " – " + (match.away || "?"),
          (match.home_score ?? "?") + " : " + (match.away_score ?? "?") +
            " · " + (item.last_checked_status || "čaká na konečný výsledok") +
            " · kontrol: " + Number(item.final_check_attempts || 0),
          "#70b7ff",
          match.competition || ""
        );
      });
    }

    if (filtered.length) {
      addText(matchArchiveEl, "POTVRDENÉ KONEČNÉ VÝSLEDKY Z FLASHSCORE", "14px");
      filtered.forEach(item => {
        const match = item.final_match || {};
        addMatchRow(
          matchArchiveEl,
          (match.home || "?") + " – " + (match.away || "?"),
          item.final_score + " · " + item.final_status,
          "#39e6a5",
          match.competition || "KONEČNÝ VÝSLEDOK POTVRDENÝ"
        );

        const details = document.createElement("details");
        details.style.cssText = "margin:0 0 12px;padding:9px 11px;background:#0c1726;border:1px solid #2b3c52;border-radius:9px;";
        const summary = document.createElement("summary");
        summary.textContent = "📈 ZÁZNAM POTVRDENIA A OPRÁV";
        summary.style.cssText = "cursor:pointer;color:#a5d8ff;font-size:11px;font-weight:900;";
        details.appendChild(summary);
        const body = document.createElement("div");
        body.style.cssText = "font-size:11px;color:#cbd8e6;line-height:1.6;margin-top:7px;";
        const line = (label, value) => {
          const element = document.createElement("div");
          element.textContent = label + ": " + value;
          body.appendChild(element);
        };
        line("Zdroj", "Flashscore · explicitný stav FINISHED");
        line("ID zápasu", item.id);
        line("Konečný výsledok", item.final_score);
        line("Uložené LIVE snímky", Number(item.snapshots_count || 0));
        line("Prvé potvrdenie", item.first_confirmed_at || "—");
        line("Posledné potvrdenie", item.confirmed_at || "—");
        const revisions = Array.isArray(item.revisions) ? item.revisions : [];
        line("Počet zaznamenaných opráv", revisions.length);
        revisions.forEach(revision => {
          line("Predchádzajúci výsledok · revízia " + revision.revision,
            (revision.final_score || "?") + " · nahradené " + (revision.superseded_at || "—"));
        });
        const note = document.createElement("div");
        note.textContent = "Kompletná časová os, LIVE snímky a štatistiky zostávajú v samostatnom trvalom Flashscore archíve.";
        note.style.cssText = "font-size:10px;color:#94a3b8;margin-top:6px;";
        body.appendChild(note);
        details.appendChild(body);
        matchArchiveEl.appendChild(details);
      });
    } else if (!pending.length) {
      addText(matchArchiveEl, "Zatiaľ nie sú uložené žiadne potvrdené konečné výsledky.");
    }
  }

  function renderSummary() {
    const wins = signalHistory.filter(s => s.status === "WIN").length;
    const losses = signalHistory.filter(s => s.status === "LOSS").length;
    const open = signalHistory.filter(s => s.status === "OPEN").length;
    const total = wins + losses;
    const rate = total ? Math.round(wins / total * 100) : 0;

    addText(engine, "HISTÓRIA SIGNÁLOV", "16px");
    addText(engine, `Výhry: ${wins} | Prehry: ${losses} | Otvorené: ${open}`);
    addText(engine, `Úspešnosť vyhodnotených signálov: ${rate}%`);
    addText(engine, "GOAL THREAT je orientačné skóre tlaku, nie pravdepodobnosť gólu.");
    addText(engine, "Výsledky signálov nie sú zárukou zisku.");
  }

  // Vlajka ligy je iba vizuálny údaj; nemení výpočet ani signály.
  function getCompetitionFlag(match) {
    const direct = String(
      match?.competition_country ||
      match?.country ||
      match?.competition?.country ||
      ""
    ).trim().toLowerCase();

    const countries = [
      { flag: "🇮🇳", names: ["india", "indian", "bharat"] },
      { flag: "🇨🇳", names: ["china", "chinese", "hangzhou", "qianchao"] },
      { flag: "🇬🇧", names: ["england", "english", "premier league", "championship", "fa cup"] },
      { flag: "🏴", names: ["scotland", "scottish"] },
      { flag: "🇪🇸", names: ["spain", "spanish", "la liga", "copa del rey"] },
      { flag: "🇩🇪", names: ["germany", "german", "bundesliga", "dfb-pokal"] },
      { flag: "🇮🇹", names: ["italy", "italian", "serie a", "coppa italia"] },
      { flag: "🇫🇷", names: ["france", "french", "ligue 1", "coupe de france"] },
      { flag: "🇵🇹", names: ["portugal", "portuguese", "liga portugal"] },
      { flag: "🇳🇱", names: ["netherlands", "dutch", "eredivisie"] },
      { flag: "🇧🇪", names: ["belgium", "belgian"] },
      { flag: "🇹🇷", names: ["turkey", "turkish", "super lig"] },
      { flag: "🇬🇷", names: ["greece", "greek"] },
      { flag: "🇸🇦", names: ["saudi arabia", "saudi", "pro league"] },
      { flag: "🇦🇪", names: ["united arab emirates", "uae", "arabian gulf league"] },
      { flag: "🇯🇵", names: ["japan", "japanese", "j1 league"] },
      { flag: "🇰🇷", names: ["south korea", "korea republic", "k league"] },
      { flag: "🇦🇺", names: ["australia", "australian", "a-league"] },
      { flag: "🇺🇸", names: ["usa", "united states", "mls", "major league soccer"] },
      { flag: "🇧🇷", names: ["brazil", "brazilian", "serie a brazil"] },
      { flag: "🇦🇷", names: ["argentina", "argentine"] },
      { flag: "🇲🇽", names: ["mexico", "mexican", "liga mx"] },
      { flag: "🇨🇦", names: ["canada", "canadian"] },
      { flag: "🇸🇰", names: ["slovakia", "slovak", "niké liga", "fortuna liga"] },
      { flag: "🇨🇿", names: ["czech republic", "czechia", "czech", "chance liga"] },
      { flag: "🇵🇱", names: ["poland", "polish", "ekstraklasa"] },
      { flag: "🇭🇺", names: ["hungary", "hungarian"] },
      { flag: "🇷🇴", names: ["romania", "romanian"] },
      { flag: "🇭🇷", names: ["croatia", "croatian"] },
      { flag: "🇷🇸", names: ["serbia", "serbian"] },
      { flag: "🇺🇦", names: ["ukraine", "ukrainian"] },
      { flag: "🇷🇺", names: ["russia", "russian"] },
      { flag: "🇨🇭", names: ["switzerland", "swiss"] },
      { flag: "🇦🇹", names: ["austria", "austrian"] },
      { flag: "🇩🇰", names: ["denmark", "danish"] },
      { flag: "🇸🇪", names: ["sweden", "swedish"] },
      { flag: "🇳🇴", names: ["norway", "norwegian"] },
      { flag: "🇫🇮", names: ["finland", "finnish"] },
      { flag: "🇮🇪", names: ["ireland", "irish"] },
      { flag: "🇿🇦", names: ["south africa", "south african"] },
      { flag: "🇪🇬", names: ["egypt", "egyptian"] },
      { flag: "🇲🇦", names: ["morocco", "moroccan"] },
      { flag: "🇳🇬", names: ["nigeria", "nigerian"] },
      { flag: "🇰🇪", names: ["kenya", "kenyan"] },
      { flag: "🇲🇾", names: ["malaysia", "malaysian"] },
      { flag: "🇹🇭", names: ["thailand", "thai"] },
      { flag: "🇮🇩", names: ["indonesia", "indonesian"] },
      { flag: "🇻🇳", names: ["vietnam", "vietnamese"] },
      { flag: "🇮🇱", names: ["israel", "israeli"] },
      { flag: "🇶🇦", names: ["qatar", "qatari"] }
    ];

    const competition = String(match?.competition || "").toLowerCase();
    const source = direct || competition;
    const found = countries.find(country =>
      country.names.some(name => source.includes(name))
    );

    return found ? found.flag : "🌍";
  }

  function renderMatch(match, historyData, collectedAt, allowSignals, staleMode = false, signalArchive = null, bttsArchive = null, target = matchesEl, compact = false, noSignal = false) {
    const card = document.createElement("div");
    card.dataset.matchId = matchId(match) || "";
    card.tabIndex = -1;
    if (noSignal) card.classList.add("no-signal-match-card");
    else if (compact) card.classList.add("compact-match-card");
    else card.classList.add("priority-match-card");

    card.style.cssText = noSignal
      ? "background:linear-gradient(110deg,#101a29,#0d1929);padding:7px;margin:5px 0;border-radius:9px;border:1px solid #293d55;"
      : compact
        ? "background:#0d1929;padding:7px;margin:5px 0;border-radius:9px;border:1px solid #293d55;"
        : "background:linear-gradient(110deg,#302813 0%,#172234 42%,#101b2a 100%);padding:12px;margin:12px 0;border-radius:12px;border:1px solid #b88a2b;border-left:4px solid #facc15;box-shadow:0 5px 18px #eab30818;";

    const minute = staleMode
      ? String(match.live_minute ?? "?").trim() || "?"
      : getDisplayedMinute(match, collectedAt);
    const matchAllowsSignals = allowSignals && match.source !== "Flashscore";
    const displayStats = Array.isArray(match.stats) && match.stats.length
      ? match.stats
      : (Array.isArray(match.flashscore_stats) ? match.flashscore_stats : []);

    // Hlavička zápasu a farebný stavový štítok.
    const header = document.createElement("div");
    header.classList.add("match-card-header");

    header.style.cssText = `
      display:flex;
      flex-wrap:wrap;
      align-items:center;
      justify-content:space-between;
      gap:7px;
      margin-bottom:9px;
    `;

    const teams = document.createElement("div");
    teams.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px;width:100%;";

    const homeName = document.createElement("div");
    homeName.classList.add("match-team-name");
    homeName.textContent = match.home || "Domáci";
    homeName.style.cssText = "min-width:0;overflow-wrap:anywhere;font-size:14px;font-weight:800;line-height:1.25;color:#f1f5f9;";

    const scoreGroup = document.createElement("div");
    scoreGroup.classList.add("match-score-group");
    scoreGroup.style.cssText = "display:flex;align-items:center;justify-content:center;gap:4px;min-width:0;flex-wrap:nowrap;";

    const clock = document.createElement("span");
    clock.classList.add("match-clock");
    clock.textContent = minute === "HT" ? "HT" : minute !== "?" ? `${minute}′` : "";
    clock.style.cssText = "white-space:nowrap;font-size:10px;font-weight:900;color:#7dd3fc;font-variant-numeric:tabular-nums;padding:3px 4px;background:#102b43;border:1px solid #245477;border-radius:6px;";

    const score = document.createElement("div");
    score.classList.add("match-score");
    score.textContent = `${Number(match.home_score || 0)} : ${Number(match.away_score || 0)}`;
    score.style.cssText = "white-space:nowrap;font-size:19px;font-weight:900;letter-spacing:.3px;color:#fff;font-variant-numeric:tabular-nums;padding:3px 7px;background:#17283d;border:1px solid #38516e;border-radius:8px;";
    if (clock.textContent) scoreGroup.appendChild(clock);
    scoreGroup.appendChild(score);

    const statusBadge = staleMode
      ? { label: "ZASTARANÉ", background: "#7f1d1d", border: "#ef4444" }
      : getStatusBadge(match);
    const statusPill = addBadge(scoreGroup, statusBadge.label, statusBadge.background, statusBadge.border);
    statusPill.classList.add("match-status-pill");
    statusPill.style.cssText = `display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;flex:0 0 auto;padding:3px 5px;margin:0;border-radius:6px;background:${statusBadge.background};border:1px solid ${statusBadge.border};color:#fff;font-size:9px;font-weight:900;letter-spacing:.1px;line-height:1.15;box-shadow:none;`;
    const awayName = document.createElement("div");
    awayName.classList.add("match-team-name");
    awayName.textContent = match.away || "Hostia";
    awayName.style.cssText = "min-width:0;overflow-wrap:anywhere;text-align:right;font-size:14px;font-weight:800;line-height:1.25;color:#f1f5f9;";

    teams.append(homeName, scoreGroup, awayName);
    header.appendChild(teams);

    card.appendChild(header);

    let matchDetailPanel = null;
    const deepViewButton = document.createElement("button");
    deepViewButton.type = "button";
    deepViewButton.className = "match-deep-view-button";
    deepViewButton.textContent = "＋ DETAILNÉ ŠTATISTIKY · MOMENTUM · ČASOVÁ OS";
    deepViewButton.setAttribute("aria-expanded", "false");
    deepViewButton.style.cssText = "display:block;width:100%;margin:2px 0 9px;padding:9px 11px;border:1px solid #3b7180;border-left:3px solid #38bdf8;border-radius:9px;background:linear-gradient(100deg,#123044,#14263a);color:#c8f3ff;text-align:left;font-size:10px;font-weight:900;letter-spacing:.35px;cursor:pointer;";
    deepViewButton.addEventListener("click", event => {
      event.stopPropagation();
      if (matchDetailPanel) {
        matchDetailPanel.open = !matchDetailPanel.open;
        if (noSignal) card.classList.toggle("no-signal-expanded", matchDetailPanel.open);
        deepViewButton.setAttribute("aria-expanded", String(matchDetailPanel.open));
        deepViewButton.textContent = matchDetailPanel.open
          ? "− SKRYŤ DETAILNÚ ANALÝZU"
          : "＋ DETAILNÉ ŠTATISTIKY · MOMENTUM · ČASOVÁ OS";
        if (matchDetailPanel.open) {
          matchDetailPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    });
    card.appendChild(deepViewButton);

    // Rýchly prehľad LIVE štatistík – iba reálne dostupné hodnoty.
    const quickStats = document.createElement("div");
    quickStats.classList.add("match-quick-stats");
    if (noSignal) quickStats.classList.add("no-signal-expand-stats", "no-signal-quick-stats");
    quickStats.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:6px;margin:3px 0 9px;";
    const quickFind = pattern => {
      const item = displayStats.find(stat =>
        pattern.test(String(stat.label || stat.name || stat.category || "").toLowerCase())
      );
      if (!item) return null;
      const toNumber = value => {
        if (value === null || value === undefined || value === "") return null;
        const parsed = Number(String(value).replace(/[%\s]/g, "").replace(",", "."));
        return Number.isFinite(parsed) ? parsed : null;
      };
      const home = toNumber(item.home_numeric ?? item.home);
      const away = toNumber(item.away_numeric ?? item.away);
      if (home === null || away === null) return null;
      return { home, away, suffix: item.suffix || "" };
    };
    const addQuickStat = (label, value, suffix = "") => {
      if (!value || value.home === null || value.away === null) return;
      const chip = document.createElement("span");
      chip.classList.add("match-quick-stat");
      chip.textContent = `${label} ${value.home} : ${value.away}${suffix || value.suffix || ""}`;
      chip.style.cssText = "display:block;min-width:0;text-align:center;font-size:10px;font-weight:800;color:#d5e2ef;background:linear-gradient(135deg,#172a40,#122033);border:1px solid #2b4059;border-radius:8px;padding:6px 5px;font-variant-numeric:tabular-nums;white-space:nowrap;";
      quickStats.appendChild(chip);
    };
    const quickSot = quickFind(/shots? on target|shots? on goal|strely na br[aá]nu/);
    const quickOff = quickFind(/shots? off target|strely mimo br[aá]nu/);
    let quickTotal = quickFind(/total shots|shots total|celkov[eé] strely/);
    if (!quickTotal && quickSot && quickOff) {
      quickTotal = {
        home: quickSot.home + quickOff.home,
        away: quickSot.away + quickOff.away
      };
    }
    addQuickStat("SOT", quickSot);
    addQuickStat("STRELY", quickTotal);
    addQuickStat("ROHY", quickFind(/corners|rohy/));
    addQuickStat("DRŽANIE", quickFind(/possession|dr[zž]anie lopty/), "%");
    addQuickStat("STRELY MIMO", quickFind(/shots off target/));
    addQuickStat("ŽK", quickFind(/yellow cards|[zž]lt[eé] karty/));
    addQuickStat("ČK", quickFind(/red cards|[cč]erven[eé] karty/));
    if (quickStats.childElementCount) {
      const quickStatsHeading = document.createElement("div");
      quickStatsHeading.textContent = "RÝCHLE ŠTATISTIKY · DOMÁCI : HOSTIA";
      quickStatsHeading.style.cssText = "font-size:9px;font-weight:900;letter-spacing:.55px;color:#829bb5;margin:3px 1px 6px;";
      card.append(quickStatsHeading, quickStats);
    } else {
      const unavailable = document.createElement("div");
      unavailable.textContent = "ŠTATISTIKY ZATIAĽ NIE SÚ DOSTUPNÉ";
      unavailable.style.cssText = "font-size:9px;font-weight:700;letter-spacing:.25px;color:#8293a8;margin:2px 0 7px;padding:3px 0;";
      card.appendChild(unavailable);
    }

    const leagueLine = document.createElement("div");
    leagueLine.classList.add("match-league-line");
    leagueLine.textContent = `${getCompetitionFlag(match)} ${match.competition || "Neznáma súťaž"}`;
    leagueLine.style.cssText = "font-size:12px;color:#a8b8cc;margin:2px 0 9px;";
    card.appendChild(leagueLine);
    const collectedDate = collectedAt ? new Date(collectedAt) : null;
    if (collectedDate && Number.isFinite(collectedDate.getTime())) {
      const dataStamp = document.createElement("div");
      dataStamp.classList.add("match-data-stamp");
      dataStamp.textContent = `ZBER DÁT · ${collectedDate.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
      card.appendChild(dataStamp);
    }

    const priority = getMatchPriority(match, historyData, collectedAt, matchAllowsSignals, staleMode, signalArchive, bttsArchive);

    if (priority.label) {
      const priorityTag = document.createElement("div");
      if (noSignal) priorityTag.classList.add("no-signal-expand-priority");
      priorityTag.textContent = priority.label;
      priorityTag.style.cssText = "display:inline-flex;align-items:center;font-size:10px;font-weight:900;letter-spacing:.35px;padding:5px 8px;margin:0 0 9px;border-radius:7px;color:" + priority.color + ";background:" + priority.background + ";border:1px solid " + priority.border + ";";
      card.appendChild(priorityTag);
    }

    const relatedSignals = Array.isArray(signalArchive?.signals)
      ? signalArchive.signals.filter(item => String(item.matchId) === matchId(match))
      : [];
    const signalSummary = document.createElement("div");
    if (noSignal) signalSummary.classList.add("no-signal-expand-summary");
    signalSummary.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px;";
    const signalCounts = {
      OPEN: relatedSignals.filter(item => item.status === "OPEN").length,
      WIN: relatedSignals.filter(item => item.status === "WIN").length,
      LOSS: relatedSignals.filter(item => item.status === "LOSS").length,
      UNRESOLVED: relatedSignals.filter(item => item.status === "UNRESOLVED").length
    };
    const addMiniTag = (label, value, color) => {
      if (!value) return;
      const tag = document.createElement("span");
      tag.textContent = `${label}: ${value}`;
      tag.style.cssText = `font-size:11px;font-weight:700;padding:5px 8px;border-radius:20px;background:#172638;color:${color};border:1px solid ${color};`;
      signalSummary.appendChild(tag);
    };
    addMiniTag("OTVORENÉ", signalCounts.OPEN, "#39e6a5");
    addMiniTag("WIN", signalCounts.WIN, "#4ade80");
    addMiniTag("LOSS", signalCounts.LOSS, "#f87171");
    addMiniTag("NEVYRIEŠENÉ", signalCounts.UNRESOLVED, "#fbbf24");
    card.appendChild(signalSummary);

    const detail = document.createElement("details");
    matchDetailPanel = detail;
    // Empty hidden summary prevents the browser fallback label "Podrobnosti".
    const hiddenDetailSummary = document.createElement("summary");
    hiddenDetailSummary.textContent = "";
    hiddenDetailSummary.style.cssText = "display:none!important;";
    detail.appendChild(hiddenDetailSummary);
    if (noSignal) detail.classList.add("no-signal-expand-detail");
    detail.style.cssText = "border-top:1px solid #293b52;padding-top:8px;";

    const makeSection = (title, open = false) => {
      const section = document.createElement("details");
      section.open = open;
      section.style.cssText = "margin:9px 0;padding:10px;background:#111d2d;border:1px solid #293d55;border-radius:10px;";
      const summary = document.createElement("summary");
      summary.textContent = title;
      summary.style.cssText = "cursor:pointer;list-style:none;font-size:13px;font-weight:900;color:#e2e8f0;padding:3px 0;";
      section.appendChild(summary);
      detail.appendChild(section);
      return section;
    };

    const signalSection = makeSection("⚡ SIGNÁLY A ICH HISTÓRIA", true);
    signalSection.hidden = true;
    const statsSection = makeSection("📊 ŠTATISTIKY ZÁPASU");
    const momentumSection = makeSection("🔥 MOMENTUM A VÝVOJ TLAKU");
    const diagnosticsSection = makeSection("🛠 KVALITA DÁT A DIAGNOSTIKA");

    addText(signalSection, "HISTÓRIA SIGNÁLOV", "13px");
    if (relatedSignals.length) {
      relatedSignals
        .slice()
        .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
        .slice(0, 8)
        .forEach(item => {
          const stamp = item.createdAt
            ? new Date(item.createdAt).toLocaleString("sk-SK")
            : "čas nezaznamenaný";
          const side = item.side === "home" ? "Domáci" : "Hostia";
          const statusLabel = ({
            OPEN: "OTVORENÝ",
            WIN: "WIN",
            LOSS: "LOSS",
            UNRESOLVED: "NEVYRIEŠENÝ"
          })[item.status] || String(item.status || "NEZNÁMY");
          const signalRow = document.createElement("div");
          signalRow.textContent = `${stamp} · ${side} – ${item.team || "tím"} · ${item.startMinute ?? "?"}. min · ${item.startScore || "?"} · ${statusLabel}`;
          signalRow.style.cssText = "font-size:12px;color:#cbd5e1;padding:7px 9px;margin:5px 0;background:#101b2b;border-radius:8px;border-left:3px solid " +
            (item.status === "WIN" ? "#4ade80" : item.status === "LOSS" ? "#f87171" : item.status === "OPEN" ? "#39e6a5" : "#fbbf24") + ";";
          signalSection.appendChild(signalRow);
        });
    } else if (Array.isArray(signalArchive?.signals)) {
      addText(signalSection, "Pre tento zápas zatiaľ nie sú uložené žiadne signály.");
    } else {
      addText(signalSection, "Archív signálov sa nepodarilo načítať.");
    }

    if (staleMode) {
      addSignalPanel(signalSection, {
        heading: "UPOZORNENIE",
        title: "ZASTARANÉ DÁTA – NIE LIVE",
        detail: "Toto je posledný uložený obraz zápasu. Aktuálny stav sa nepotvrdil; nepoužívaj ho na rozhodovanie ani stávky.",
        background: "#450a0a",
        border: "#ef4444",
        titleColor: "#fca5a5"
      });
    }

    addText(
      diagnosticsSection,
      `${getCompetitionFlag(match)} ${match.competition || "Neznáma súťaž"} | ${minute === "HT" ? "Prestávka" : minute + ". minúta"} | meranie: ${collectedAt || "neznámy čas"}`
    );

    const quality = getDataQuality(match, collectedAt);
    addBadge(
      diagnosticsSection,
      quality.label,
      quality.background,
      quality.border
    );
    addText(diagnosticsSection, quality.detail);

    const reliability = getMatchReliability(
      match,
      historyData,
      collectedAt
    );

    addText(diagnosticsSection, "HISTÓRIA PÔVODNÉHO ZELENÉHO MODELU", "14px");
    if (reliability) {
      addBadge(
        diagnosticsSection,
        reliability.label,
        reliability.background,
        reliability.border
      );
      addText(
        diagnosticsSection,
        `Vzorka: ${reliability.count} meraní | SOT + strely mimo dostupné: ${reliability.momentumCoverage}% | Úplné pôvodné dáta: ${reliability.fullCoverage}%`
      );
      addText(
        diagnosticsSection,
        `Priemerný interval: ${reliability.averageGap === null ? "zatiaľ bez porovnania" : reliability.averageGap.toFixed(1) + " min"} | Najdlhšia medzera: ${reliability.maxGap === null ? "—" : reliability.maxGap.toFixed(1) + " min"} | Medzery nad 7 min: ${reliability.longGaps}`
      );
    } else {
      addText(diagnosticsSection, "Zatiaľ nie je dostupná história meraní tohto zápasu.");
    }
    addText(
      diagnosticsSection,
      "Ukazovateľ vychádza z uložených kompletných zberov (približne posledných 24 hodín); je iba informačný."
    );

    renderCurrentStats(statsSection, displayStats, match, historyData, collectedAt);
    renderHalfPeriodComparison(statsSection, displayStats, match);

    // Starý BTTS archív je vypnutý; nové BTTS záznamy budú vedené oddelene z Flashscore.

    // Legacy green signal remains isolated during validation; its logic is not used for the new momentum panel.
    const pressure = calculatePressure(match.stats || []);
    const snapshot = getSnapshot(match, historyData, collectedAt);
    const threat = calculateThreat(pressure, snapshot);
    const momentumReliability = getMatchReliability(match, historyData, collectedAt);
    const pressureAcceleration = calculatePressureAcceleration(match, historyData, collectedAt);
    addText(momentumSection, "ČASOVÁ OS PRIEBEHU · ULOŽENÉ STAVY", "12px");
    renderMatchTimeline(momentumSection, match, historyData, collectedAt);
    renderMomentumEnginePanel(momentumSection, match, historyData, collectedAt);

    if (!matchAllowsSignals) {
      addSignalPanel(signalSection, {
        heading: "LIVE SIGNÁL",
        title: match.source === "Flashscore"
          ? "ZELENÝ MODEL Z FLASHSCORE VYPNUTÝ"
          : staleMode ? "SIGNÁLY VYPNUTÉ – ZASTARANÉ DÁTA" : "ZBER DÁT NIE JE KOMPLETNÝ",
        detail: match.source === "Flashscore"
          ? "Zápas aj štatistiky sa zobrazujú z Flashscore. Zelený model zostáva vypnutý počas validácie; BTTS monitoring je samostatný."
          : staleMode ? "Z tohto záznamu sa nevytvára ani nevyhodnocuje žiadny LIVE signál." : "Nové signály sú momentálne zablokované.",
        background: "#292524",
        border: "#78716c",
        titleColor: "#d6d3d1"
      });
    } else {
      const signalQuality = calculateSignalQuality(
        threat,
        snapshot,
        momentumReliability,
        pressureAcceleration,
        collectedAt
      );
      const signal = makeSignal(
        match,
        threat,
        snapshot,
        collectedAt,
        signalQuality
      );

      if (signal) {
        addSignalPanel(signalSection, {
          heading: "⚡ LIVE SIGNÁL – POTVRDENÝ",
          title: signal.team,
          detail:
            `Strana: ${signal.side === "home" ? "Domáci" : "Hostia"} | ` +
            `GOAL THREAT: ${signal.score}/100 | ` +
            `Aktivita: ${signal.activity.toFixed(1)} za 10 min`,
          background: "#123b2d",
          border: "#39e6a5",
          titleColor: "#39e6a5"
        });

        recordSignal(match, signal);

      } else if (
        threat &&
        Math.max(threat.home, threat.away) >= 55
      ) {
        const side = threat.home >= threat.away ? "Domáci" : "Hostia";
        const score = Math.max(threat.home, threat.away);

        addSignalPanel(signalSection, {
          heading: "⚠ ZVÝŠENÝ TLAK",
          title: `${side} – ${score}/100`,
          detail: "Zatiaľ nie sú splnené všetky podmienky pre LIVE signál.",
          background: "#422b12",
          border: "#f59e0b",
          titleColor: "#fbbf24"
        });

      } else {
        addSignalPanel(signalSection, {
          heading: "LIVE SIGNÁL",
          title: "Zatiaľ bez potvrdeného signálu",
          detail: "Systém naďalej sleduje vývoj zápasu.",
          background: "#202b3b",
          border: "#64748b",
          titleColor: "#cbd5e1"
        });
      }
    }

    card.appendChild(detail);
    target.appendChild(card);
  }

  function getMatchPriority(match, historyData, collectedAt, allowSignals, staleMode, signalArchive, bttsArchive) {
    if (staleMode) return { rank: 0, score: 0, label: null, color: "", background: "", border: "" };

    const id = matchId(match);
    const hasOpenGreen = Array.isArray(signalArchive?.signals) &&
      signalArchive.signals.some(item => String(item.matchId) === id && item.status === "OPEN");
    const hasOpenBtts = Array.isArray(bttsArchive?.signals) &&
      bttsArchive.signals.some(item => String(item.matchId) === id && item.status === "OPEN");

    const pressure = calculatePressure(match.stats || []);
    const snapshot = getSnapshot(match, historyData, collectedAt);
    const threat = calculateThreat(pressure, snapshot);
    const currentGreen = allowSignals && match.source !== "Flashscore" &&
      Boolean(makeSignal(match, threat, snapshot, collectedAt));
    const confirmed = currentGreen || hasOpenGreen || hasOpenBtts;
    // Číslo v TOP LIVE TLAK musí používať rovnaký kumulatívny výpočet ako Momentum panel.
    // Legacy pressure/threat ostáva nedotknutý pre existujúce pravidlá signalizácie.
    const momentum = window.LiveMomentumEngine?.analyse(
      match,
      historyRecords(historyData, id),
      collectedAt
    );
    const cumulative = momentum?.ready ? momentum.pressure : null;
    const score = cumulative
      ? Math.max(cumulative.home, cumulative.away)
      : 0;
    const scoreBasis = cumulative
      ? "KUMULATÍVNA PREVAHA · MOMENTUM"
      : "KUMULATÍVNE ŠTATISTIKY NEDOSTUPNÉ";

    if (confirmed) {
      return {
        rank: 2,
        score,
        scoreBasis,
        label: score > 0 ? "⚡ POTVRDENÝ SIGNÁL · " + score + "/100" : "⚡ POTVRDENÝ SIGNÁL",
        color: "#8fffd0",
        background: "#123b2d",
        border: "#39e6a5"
      };
    }

    if (threat && score >= 55) {
      return {
        rank: 1,
        score,
        scoreBasis,
        label: "⚠ ZVÝŠENÝ TLAK · " + score + "/100",
        color: "#fcd38d",
        background: "#422b12",
        border: "#f59e0b"
      };
    }

    return { rank: 0, score, scoreBasis, label: null, color: "", background: "", border: "" };
  }

  function renderMatchesGrouped(items, historyData, allowSignals, staleMode, signalArchive, bttsArchive) {
    const priorityByItem = new Map(items.map(item => [
      item,
      getMatchPriority(item.match, historyData, item.collectedAt, allowSignals, staleMode, signalArchive, bttsArchive)
    ]));
    const getPriority = item => priorityByItem.get(item) || { rank: 0, score: 0 };

    // Prehľad TOP LIVE tlaku je iba navigačný panel; nemení signály ani ich podmienky.
    const pressureOverview = document.getElementById("live-pressure-overview");
    if (pressureOverview) {
      pressureOverview.innerHTML = "";
      pressureOverview.style.cssText = "padding:13px 14px;border:1px solid #29475c;border-left:3px solid #39bfa2;border-radius:13px;background:linear-gradient(135deg,#14263a 0%,#101b2a 100%);box-shadow:0 7px 20px #0003;";
      const title = document.createElement("div");
      title.textContent = "🔥 TOP LIVE TLAK";
      title.style.cssText = "font-size:12px;font-weight:900;letter-spacing:.8px;color:#c8e7ff;margin-bottom:4px;";
      pressureOverview.appendChild(title);
      const subtitle = document.createElement("div");
      subtitle.textContent = "Číslo = kumulatívna prevaha podľa rovnakého výpočtu ako v LIVE MOMENTUM. Trend je samostatné intervalové zrýchlenie; farba označuje stav signálu. Nie je to pravdepodobnosť gólu ani stávkový signál.";
      subtitle.style.cssText = "font-size:10px;color:#8fa6bf;margin-bottom:9px;line-height:1.4;";
      pressureOverview.appendChild(subtitle);

      const topPressure = items
        .filter(item => !staleMode && Number.isFinite(getPriority(item).score) && getPriority(item).score > 0)
        .sort((a, b) => getPriority(b).score - getPriority(a).score)
        .slice(0, 5);

      if (!topPressure.length) {
        const empty = document.createElement("div");
        empty.textContent = staleMode
          ? "Prehľad čaká na čerstvé LIVE dáta."
          : "Zatiaľ nie je dostupné kladné skóre tlaku z aktuálnych štatistík.";
        empty.style.cssText = "font-size:11px;color:#9aacc1;padding:8px 0;";
        pressureOverview.appendChild(empty);
      } else {
        topPressure.forEach((item, index) => {
          const match = item.match || {};
          const priority = getPriority(item);
          const row = document.createElement("button");
          row.type = "button";
          row.setAttribute("aria-label", "Prejsť na zápas " + (match.home || "Domáci") + " – " + (match.away || "Hostia"));
          row.style.cssText = "display:grid;width:100%;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;padding:10px 9px;margin:7px 0 0;border:1px solid #2b435b;border-radius:10px;background:linear-gradient(110deg,#172a40,#122033);text-align:left;cursor:pointer;";
          row.addEventListener("click", () => {
            matchSearchTerm = "";
            if (matchSearchEl) matchSearchEl.value = "";
            liveMatchFilter = "all";
            applyLiveMatchSearch();
            const targetId = matchId(match);
            const targetCard = Array.from(matchesEl.querySelectorAll("[data-match-id]"))
              .find(card => card.dataset.matchId === targetId);
            if (targetCard) {
              targetCard.scrollIntoView({ behavior: "smooth", block: "center" });
              targetCard.focus({ preventScroll: true });
              targetCard.style.outline = "2px solid #38bdf8";
              targetCard.style.outlineOffset = "3px";
              window.setTimeout(() => {
                targetCard.style.outline = "";
                targetCard.style.outlineOffset = "";
              }, 1800);
            }
          });
          const info = document.createElement("div");
          info.style.cssText = "min-width:0;";
          const teams = document.createElement("div");
          teams.textContent = (match.home || "Domáci") + " – " + (match.away || "Hostia");
          teams.style.cssText = "font-size:12px;font-weight:900;color:#edf6ff;overflow-wrap:anywhere;line-height:1.3;";
          const meta = document.createElement("div");
          const minute = getDisplayedMinute(match, item.collectedAt);
          const score = String(match.home_score ?? "?") + " : " + String(match.away_score ?? "?");
          const league = String(match.competition || match.league || "Neznáma súťaž");
          meta.textContent = league + " · " + score + (minute && minute !== "?" ? " · " + minute + (minute === "HT" ? "" : "′") : "");
          meta.style.cssText = "font-size:9px;color:#8fa6bf;margin-top:3px;overflow-wrap:anywhere;";

          // Trend je odvodený iba z dvoch posledných platných intervalov reálnych snímok.
          const trend = calculatePressureAcceleration(match, historyData, item.collectedAt);
          const trendLine = document.createElement("div");
          trendLine.style.cssText = "font-size:9px;margin-top:5px;line-height:1.4;overflow-wrap:anywhere;";
          if (trend.ready) {
            const marker = state => state === "ZRÝCHĽUJE" ? "↑" : state === "SPOMAĽUJE" ? "↓" : "→";
            const homeColor = trend.homeState === "ZRÝCHĽUJE" ? "#4ade80" : trend.homeState === "SPOMAĽUJE" ? "#fbbf24" : "#9fb2c8";
            const awayColor = trend.awayState === "ZRÝCHĽUJE" ? "#4ade80" : trend.awayState === "SPOMAĽUJE" ? "#fbbf24" : "#9fb2c8";
            const homeTrend = document.createElement("span");
            homeTrend.textContent = marker(trend.homeState) + " Domáci " + trend.homeState.toLowerCase() + " (" + (trend.homeDelta > 0 ? "+" : "") + trend.homeDelta + ")";
            homeTrend.style.color = homeColor;
            const separator = document.createElement("span");
            separator.textContent = " · ";
            separator.style.color = "#64748b";
            const awayTrend = document.createElement("span");
            awayTrend.textContent = marker(trend.awayState) + " Hostia " + trend.awayState.toLowerCase() + " (" + (trend.awayDelta > 0 ? "+" : "") + trend.awayDelta + ")";
            awayTrend.style.color = awayColor;
            trendLine.append(homeTrend, separator, awayTrend);
          } else {
            const diag = trend.snapshots !== undefined
              ? `Vzorky: ${trend.snapshots} · platné intervaly: ${trend.intervals} · chýbajúce štatistiky: ${trend.missingShots} · reset: ${trend.resetStats} · časové medzery: ${trend.rejectedGap}`
              : (trend.reason || "Nedostatok historických meraní");
            trendLine.textContent = "Trend čaká · " + diag;
            trendLine.style.color = "#8296ad";
            trendLine.title = trend.reason || "Diagnostika časových meraní";
          }
          info.append(teams, meta, trendLine);
          const badge = document.createElement("div");
          const status = priority.rank === 2 ? "SIGNÁL" : priority.rank === 1 ? "VYŠŠÍ TLAK" : "SLEDOVAŤ";
          const color = priority.rank === 2 ? "#39e6a5" : priority.rank === 1 ? "#fbbf24" : "#7dd3fc";
          badge.textContent = priority.score + "/100";
          badge.title = status + " · " + (priority.scoreBasis || "skóre tlaku") + " · nie pravdepodobnosť gólu";
          badge.setAttribute("aria-label", status + ", skóre tlaku " + priority.score + " zo 100");
          badge.style.cssText = "white-space:nowrap;font-size:13px;font-weight:950;color:" + color + ";font-variant-numeric:tabular-nums;padding:7px 9px;border:1px solid " + color + "66;border-radius:9px;background:" + (priority.rank === 2 ? "#12372e" : priority.rank === 1 ? "#352a16" : "#12263a") + ";";
          const meter = document.createElement("div");
          meter.setAttribute("aria-hidden", "true");
          meter.style.cssText = "height:4px;margin-top:7px;border-radius:5px;background:#26394d;overflow:hidden;";
          const fill = document.createElement("div");
          fill.style.cssText = "height:100%;width:" + Math.max(0, Math.min(100, Number(priority.score) || 0)) + "%;border-radius:5px;background:" + color + ";opacity:.9;";
          meter.appendChild(fill);
          info.append(teams, meta, trendLine, meter);
          row.append(info, badge);
          pressureOverview.appendChild(row);
        });
      }
    }

    const confirmedItems = items.filter(item => getPriority(item).rank === 2);
    const pressureItems = items.filter(item => getPriority(item).rank === 1);

    const latestSignalTime = item => {
      const id = matchId(item.match);
      const records = [
        ...(Array.isArray(signalArchive?.signals) ? signalArchive.signals : []),
        ...(Array.isArray(bttsArchive?.signals) ? bttsArchive.signals : [])
      ];
      let latest = 0;
      records.forEach(signal => {
        if (String(signal?.matchId) !== id) return;
        const time = Date.parse(signal?.createdAt || "");
        if (Number.isFinite(time)) latest = Math.max(latest, time);
      });
      if (latest) return latest;
      const collected = Date.parse(item.collectedAt || "");
      return Number.isFinite(collected) ? collected : 0;
    };
    const noSignalItems = items.filter(item => getPriority(item).rank === 0);

    const renderCategory = (categoryItems, title, compact, noSignal = false) => {
      if (!categoryItems.length) return;

      const categoryHeading = document.createElement("div");
      categoryHeading.textContent = title + " · " + categoryItems.length;
      categoryHeading.classList.add(compact ? "match-category-other" : "match-category-confirmed");
      categoryHeading.style.cssText = compact
        ? "font-size:11px;font-weight:900;letter-spacing:.6px;color:#9fb0c5;margin:16px 2px 5px;padding:2px 1px;"
        : "font-size:12px;font-weight:900;letter-spacing:.7px;color:#39e6a5;margin:8px 2px 6px;padding:3px 1px;";
      matchesEl.appendChild(categoryHeading);

      // Potvrdené signály zobrazujeme ako jeden chronologický zoznam,
      // aby poradie neovplyvňovalo rozdelenie podľa súťaží.
      if (!compact) {
        categoryItems
          .slice()
          .sort((a, b) =>
            latestSignalTime(b) - latestSignalTime(a) ||
            getPriority(b).score - getPriority(a).score
          )
          .forEach(item => renderMatch(
            item.match,
            historyData,
            item.collectedAt,
            allowSignals,
            staleMode,
            signalArchive,
            bttsArchive,
            matchesEl,
            false,
            noSignal
          ));
        return;
      }

      const groups = new Map();
      categoryItems.forEach(item => {
        const name = String(item.match?.competition || item.match?.league || "Neznáma súťaž").trim() || "Neznáma súťaž";
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(item);
      });

      const rankedGroups = [...groups.entries()].map(([league, leagueItems]) => {
        leagueItems.sort((a, b) => {
          const pa = getPriority(a);
          const pb = getPriority(b);
          return pb.rank - pa.rank || pb.score - pa.score;
        });
        const top = leagueItems.length ? getPriority(leagueItems[0]) : { rank: 0, score: 0 };
        return { league, leagueItems, rank: top.rank, score: top.score };
      });

      rankedGroups
        .sort((a, b) => b.rank - a.rank || b.score - a.score || a.league.localeCompare(b.league, "sk"))
        .forEach(({ league, leagueItems }) => {
          const section = document.createElement("section");
          section.classList.add(compact ? "match-league-other" : "match-league-confirmed");
          section.style.cssText = "margin:7px 0 10px;padding:8px;background:#0a1422;border:1px solid #263a52;border-radius:12px;";

          const heading = document.createElement("div");
          const flag = getCompetitionFlag(leagueItems[0].match);
          heading.textContent = `${flag} ${league} · ${leagueItems.length} ${leagueItems.length === 1 ? "zápas" : leagueItems.length < 5 ? "zápasy" : "zápasov"}`;
          heading.style.cssText = "font-size:12px;font-weight:800;color:#e2e8f0;padding:2px 2px 6px;border-bottom:1px solid #31445c;margin-bottom:6px;";
          section.appendChild(heading);

          leagueItems.forEach(item => renderMatch(
            item.match,
            historyData,
            item.collectedAt,
            allowSignals,
            staleMode,
            signalArchive,
            bttsArchive,
            section,
            compact,
            noSignal
          ));

          matchesEl.appendChild(section);
        });
    };

    renderCategory(confirmedItems, "⚡ POTVRDENÉ SIGNÁLY", false);
    renderCategory(pressureItems, "⚠ ZVÝŠENÝ TLAK – BEZ POTVRDENÉHO SIGNÁLU", true);
    renderCategory(noSignalItems, "○ ZÁPASY BEZ AKTUÁLNEHO SIGNÁLU", true, true);
    applyLiveMatchSearch();
  }

  function updateDashboard(current, liveCount, signalArchive, bttsArchive, fresh, complete) {
    const set = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = String(value);
    };
    const greenSignals = Array.isArray(signalArchive?.signals) ? signalArchive.signals : [];
    const bttsSignals = Array.isArray(bttsArchive?.signals) ? bttsArchive.signals : [];
    const greenOpen = greenSignals.filter(item => item?.status === "OPEN").length;
    const bttsOpen = bttsSignals.filter(item => item?.status === "OPEN").length;
    const status = !fresh ? "NEAKTUÁLNE" : current?.feed_state === "FLASHSCORE_VALIDATION_PENDING" ? "OVEROVANIE" : complete ? "KOMPLETNÉ" : "NEÚPLNÉ";
    const collectedAt = Date.parse(current?.collected_at || "");
    const updated = Number.isFinite(collectedAt)
      ? new Date(collectedAt).toLocaleString("sk-SK")
      : "nedostupná";
    set("dashboard-live-count", fresh ? liveCount : 0);
    set("dashboard-data-status", status);
    set("dashboard-updated", "Posledný zber dát: " + updated + " · " + status);
    const statusElement = document.getElementById("dashboard-data-status");
    if (statusElement) statusElement.style.color = !fresh ? "#f87171" : status === "KOMPLETNÉ" ? "#39e6a5" : "#fbbf24";
  }

  async function scan() {
    if (scanning) return;
    scanning = true;
    pageLastAttemptAt = Date.now();
    pageLoadState = "LOADING";
    renderLiveDataHealth();

    try {
      const current = await getJSON(CURRENT_URL);
      const historyData = Array.isArray(current.recent_history)
        ? current.recent_history
        : await loadFlashscoreRecentHistory().catch(error => {
            flashscoreRecentHistoryStatus = { state: "ERROR", count: 0, error: String(error?.message || error) };
            console.warn("Flashscore timeline história nie je dostupná – LIVE zobrazenie pokračuje bez historických metrík:", error);
            return [];
          });
      if (Array.isArray(current.recent_history)) {
        flashscoreRecentHistoryStatus = {
          state: "READY",
          count: historyData.length,
          error: ""
        };
        flashscoreRecentHistoryCache = { loadedAt: Date.now(), rows: historyData };
      }
      const [signalArchive, bttsArchive, matchArchive] = await Promise.all([
        Promise.resolve(null),
        getCachedJSON(BTTS_ARCHIVE_URL, 60 * 1000).catch(error => {
          console.warn("Nový Flashscore BTTS archív zatiaľ nie je dostupný:", error);
          return null;
        }),
        getCachedJSON(OUTCOMES_URL, 10 * 60 * 1000).catch(error => {
          console.warn("Flashscore výsledkový archív nie je dostupný:", error);
          return null;
        }),
      ]);


      pageLastSuccessAt = Date.now();
      pageLastError = "";
      pageLoadState = "SUCCESS";
      latestCollectorAt = current.collected_at || null;
      renderLiveDataHealth();

      const collectedTime = Date.parse(current.collected_at || "");
      const age = Date.now() - collectedTime;

      matchesEl.innerHTML = "";
      engine.innerHTML = "";

      addText(engine, "SMART SIGNAL ENGINE v14", "18px");
      addText(engine, "Zdroj LIVE dát a historických meraní: Flashscore");
      addText(engine, `Dáta: ${current.collected_at || "neznámy čas"}`);
      addText(engine, `Posledná kontrola: ${new Date().toLocaleTimeString("sk-SK")}`);

      if (
        !Number.isFinite(collectedTime) ||
        age < 0 ||
        age > MAX_DATA_AGE_MS
      ) {
        addText(engine, "STAV: NEAKTUÁLNE DÁTA", "16px");
        addText(
          engine,
          "Posledný zber je starší ako 7 minút. LIVE signály sú zablokované."
        );

        const staleRecords = Array.isArray(current.records) ? current.records : [];
        const staleMatches = staleRecords
          .map(record => ({
            match: record.match,
            collectedAt: record.collected_at || current.collected_at
          }))
          .filter(item => item.match && isLive(item.match));

        updateDashboard(current, 0, signalArchive, bttsArchive, false, false);
        addText(engine, "LIVE zápasy: 0 – aktuálny feed nie je potvrdený");
        addText(engine, `Posledné uložené zápasy: ${staleMatches.length}`);
        addText(engine, "Zobrazenie je iba archívny náhľad. Žiadne signály, vyhodnocovanie ani aktualizácia skóre sa z neho nevykonáva.");

        if (staleMatches.length) {
          renderMatchesGrouped(staleMatches, historyData, false, true, signalArchive, bttsArchive);
        } else {
          addText(matchesEl, "Nie sú dostupné ani posledné uložené LIVE zápasy.");
        }

        renderSummary();
        if (signalArchive !== lastRenderedSignalArchive) {
          if (signalArchive !== lastRenderedSignalArchive) {
            if (signalArchive) renderServerSignalArchive(signalArchive, greenSignalArchiveEl);
            else if (greenSignalArchiveEl) { greenSignalArchiveEl.innerHTML = ""; addText(greenSignalArchiveEl, "Archív zelených signálov sa nepodarilo načítať."); }
            lastRenderedSignalArchive = signalArchive;
          }
          if (bttsArchive !== lastRenderedBttsArchive) {
            if (bttsArchive) renderBttsSignalArchive(bttsArchive, bttsSignalArchiveEl);
            else if (bttsSignalArchiveEl) { bttsSignalArchiveEl.innerHTML = ""; addText(bttsSignalArchiveEl, "BTTS archív sa nepodarilo načítať."); }
            lastRenderedBttsArchive = bttsArchive;
          }
          if (matchArchive !== lastRenderedMatchArchive) {
            renderMatchArchive(matchArchive);
            lastRenderedMatchArchive = matchArchive;
          }
          lastRenderedMatchArchive = matchArchive;
        }
        renderSystemStats(current, signalArchive, matchArchive);
        renderApiDataQuality(current, matchArchive, []);
        if (
        signalArchive !== lastRenderedPerformanceGreen ||
        bttsArchive !== lastRenderedPerformanceBtts
      ) {
        renderFootballPerformanceCenter(signalArchive, bttsArchive);
        lastRenderedPerformanceGreen = signalArchive;
        lastRenderedPerformanceBtts = bttsArchive;
      }

        signalEl.textContent =
          `ZASTARANÉ DÁTA – NIE LIVE | Posledný zber: ${current.collected_at || "neznámy čas"} | Signály zablokované`;

        return;
      }

      const allowSignals = false; // Legacy green signals are disabled; focus is Flashscore data collection.

      const records = Array.isArray(current.records)
        ? current.records
        : [];

      const matches = records
        .filter(record => {
          const recordTime = Date.parse(record.collected_at || "");

          return (
            Number.isFinite(recordTime) &&
            Date.now() - recordTime <= MAX_DATA_AGE_MS &&
            Date.now() >= recordTime
          );
        })
        .map(record => ({
          match: record.match,
          collectedAt: record.collected_at || current.collected_at
        }))
        .filter(item => isLive(item.match));

      const actualMatches = matches.map(item => item.match);
      updateDashboard(current, matches.length, signalArchive, bttsArchive, true, current.collection_complete === true);

      // Legacy green-signal settlement is disabled during the Flashscore-only transition.

      const providerStatus = current.source_status || {};
      const flashscoreLiveCount = Number(providerStatus.Flashscore?.live_count || 0);
      const feedStateLabel = current.feed_state === "NO_LIVE"
        ? (flashscoreLiveCount > 0
          ? "KOMPLETNÝ – LIVE ZÁPASY Z FLASHSCORE"
          : "KOMPLETNÝ – BEZ LIVE ZÁPASOV")
        : current.feed_state === "PARTIAL"
          ? "NEÚPLNÝ – CHYBA ZBERU"
          : current.feed_state === "SUSPECTED_DROP"
            ? "POZASTAVENÝ – PODOZRIVÝ POKLES"
            : current.feed_state === "BASELINE_PENDING"
              ? "ČAKÁ NA POTVRDENIE ZÁKLADNE"
              : current.feed_state === "FLASHSCORE_VALIDATION_PENDING" ? "PREBIEHA OVEROVANIE FLASHSCORE" : current.collection_complete === true ? "KOMPLETNÝ" : "NEÚPLNÝ";
      addText(engine, `Stav zberu: ${feedStateLabel}`);
      if (current.feed_state === "NO_LIVE" && flashscoreLiveCount > 0) {
        addText(engine, `Flashscore poskytuje ${flashscoreLiveCount} LIVE zápasov. Sú zobrazené v zozname; dôveryhodnosť štatistík a pravidlá signálov zostávajú počas validácie oddelené.`);
      } else if (current.feed_state === "NO_LIVE") {
        addText(engine, "Flashscore momentálne nevracia prebiehajúce zápasy. Zber je kompletný.");
      }
      addText(engine, `Bezpečná archivácia: ${current.archive_safe ? "ÁNO" : "POZASTAVENÁ"}`);
      if (current.feed_guard_warning === true && current.feed_state === "SUSPECTED_DROP") {
        addText(
          engine,
          "UPOZORNENIE: Počet LIVE zápasov je nižší než historická základňa. Zobrazené sú iba zápasy s overenými detailmi; nové signály a archivácia sú do potvrdenia feedu zablokované."
        );
      } else if (current.feed_guard_warning === true && current.feed_state === "BASELINE_PENDING") {
        addText(
          engine,
          "UPOZORNENIE: Historická základňa Flashscore sa ešte overuje; nové signály a archivácia sú zatiaľ zablokované."
        );
      }
      addText(engine, `Vek dát: ${Math.max(0, Math.round(age / 1000))} sekúnd`);
      addText(engine, `LIVE zápasy: ${matches.length}`);

      const qualityCounts = { OK: 0, PARTIAL: 0, INCOMPLETE: 0, STALE: 0 };
      matches.forEach(item => {
        const quality = getDataQuality(item.match, item.collectedAt);
        qualityCounts[quality.status] = (qualityCounts[quality.status] || 0) + 1;
      });
      addText(
        engine,
        `Kvalita dát: Kompletné ${qualityCounts.OK} | Čiastočné ${qualityCounts.PARTIAL} | Neúplné ${qualityCounts.INCOMPLETE} | Zastarané ${qualityCounts.STALE}`
      );

      const collectorHealth = getCollectorHealth(historyData);
      addText(engine, "ZDRAVIE FLASHSCORE ARCHÍVU – POSLEDNÝCH 24 HODÍN", "15px");
      if (collectorHealth) {
        addText(
          engine,
          `Časové zbery: ${collectorHealth.total} | Snímky so štatistikami: ${collectorHealth.complete} | Bez štatistík: ${collectorHealth.partial}`
        );
        addText(
          engine,
          `Priemerný interval: ${collectorHealth.averageGap === null ? "bez porovnania" : collectorHealth.averageGap.toFixed(1) + " min"} | Najdlhšia medzera: ${collectorHealth.maxGap === null ? "—" : collectorHealth.maxGap.toFixed(1) + " min"}`
        );
      } else {
        addText(engine, "Za posledných 24 hodín zatiaľ nie sú dostupné Flashscore časové snímky.");
      }

      addText(engine, `Obnovovanie: každých ${SCAN_INTERVAL_MS / 1000} sekúnd`);
      addText(engine, `Povolený rozdiel meraní: ${MIN_GAP_MINUTES}–${MAX_GAP_MINUTES} min`);

      if (!allowSignals && current.feed_state !== "BASELINE_PENDING" && current.feed_state !== "SUSPECTED_DROP") {
        addText(
          engine,
          "Flashscore je načítaný; prebieha validačné obdobie. Archivácia a nové signály zostávajú do ukončenia validácie zablokované."
        );
      }

      if (current.feed_state === "SUSPECTED_DROP") {
        addText(
          engine,
          "FEED GUARD: Podozrivý pokles LIVE zápasov. Nové signály a archivácia sú pozastavené."
        );
      } else if (current.feed_state === "BASELINE_PENDING") {
        addText(
          engine,
          "Flashscore: Historická základňa sa ešte overuje. Nové signály a archivácia sú zatiaľ pozastavené."
        );
      }

      if (!matches.length) {
        addText(
          matchesEl,
          "Momentálne nie sú dostupné aktuálne LIVE zápasy."
        );
      }

      renderMatchesGrouped(matches, historyData, allowSignals, false, signalArchive, bttsArchive);

      renderSummary();
      if (signalArchive !== lastRenderedSignalArchive) {
        if (signalArchive) renderServerSignalArchive(signalArchive, greenSignalArchiveEl);
        else if (greenSignalArchiveEl) { greenSignalArchiveEl.innerHTML = ""; addText(greenSignalArchiveEl, "Archív zelených signálov sa nepodarilo načítať."); }
        lastRenderedSignalArchive = signalArchive;
      }
      if (bttsArchive !== lastRenderedBttsArchive) {
        if (bttsArchive) renderBttsSignalArchive(bttsArchive, bttsSignalArchiveEl);
        else if (bttsSignalArchiveEl) { bttsSignalArchiveEl.innerHTML = ""; addText(bttsSignalArchiveEl, "BTTS archív sa nepodarilo načítať."); }
        lastRenderedBttsArchive = bttsArchive;
      }
      const matchArchiveChanged = matchArchive !== lastRenderedMatchArchive;
      if (matchArchiveChanged) {
        renderMatchArchive(matchArchive);
        lastRenderedMatchArchive = matchArchive;
        renderApiDataQuality(current, matchArchive, []);
      }
      renderSystemStats(current, signalArchive, matchArchive);
      if (
        signalArchive !== lastRenderedPerformanceGreen ||
        bttsArchive !== lastRenderedPerformanceBtts
      ) {
        renderFootballPerformanceCenter(signalArchive, bttsArchive);
        lastRenderedPerformanceGreen = signalArchive;
        lastRenderedPerformanceBtts = bttsArchive;
      }

      signalEl.textContent =
        `Aktualizované: ${new Date().toLocaleTimeString("sk-SK")} | LIVE: ${matches.length}`;

    } catch (error) {
      pageLoadState = "ERROR";
      pageLastError = String(error?.message || "Neznáma chyba").slice(0, 220);
      renderLiveDataHealth();
      console.error("Scanner chyba:", error);

      matchesEl.innerHTML = "";
      engine.innerHTML = "";
      updateDashboard(null, 0, null, null, false, false);

      addText(engine, "SMART SIGNAL ENGINE v14");
      addText(engine, "Nepodarilo sa načítať aktuálne LIVE dáta.");
      addText(engine, error.message);

      addText(
        matchesEl,
        "Dáta nie sú dostupné. Staré zápasy nezobrazujem."
      );

      signalEl.textContent = "CHYBA NAČÍTANIA – signály zablokované. " + (error?.message || "Neznáma chyba");

    } finally {
      scanning = false;
    }
  }

  scan();
  setInterval(scan, SCAN_INTERVAL_MS);
  setInterval(renderLiveDataHealth, 15000);

  // Mobilné prehliadače môžu pozastaviť časovače na karte na pozadí.
  // Po návrate do aplikácie alebo obnovení stránky obnov LIVE dáta ihneď.
  function refreshOnResume() {
    if (document.visibilityState === "visible") scan();
  }
  document.addEventListener("visibilitychange", refreshOnResume);
  window.addEventListener("pageshow", refreshOnResume);
  window.addEventListener("focus", refreshOnResume);
  window.addEventListener("online", refreshOnResume);
})();

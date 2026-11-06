
(() => {
  const CURRENT_URL = "./data/live-current.json";
  const HISTORY_URL = "./data/live-history.json";
  const SIGNAL_ARCHIVE_URL = "./data/signal-archive.json";
  const BTTS_ARCHIVE_URL = "./data/btts-signal-archive.json";
  const MATCH_ARCHIVE_URL = "./data/live-archive.json";
  const MATCH_HISTORY_URL = "./data/live-match-history.jsonl";
  const SIGNAL_KEY = "live_edge_signals_v6";

  const MIN_GAP_MINUTES = 3;
  const MAX_GAP_MINUTES = 15;

  const MAX_DATA_AGE_MS = 7 * 60 * 1000;
  const SCAN_INTERVAL_MS = 120 * 1000;

  const matchesEl = document.getElementById("matches");
  const signalEl = document.getElementById("signal");
  const systemStatsEl = document.getElementById("system-stats");
  const matchArchiveEl = document.getElementById("match-archive");
  const matchArchiveCountEl = document.getElementById("match-archive-count");
  const matchArchiveLeagueEl = document.getElementById("match-archive-league");
  const matchArchiveDateEl = document.getElementById("match-archive-date");
  const matchArchiveResetEl = document.getElementById("match-archive-reset");
  const greenSignalArchiveEl = document.getElementById("green-signal-archive");
  const greenSignalArchiveCountEl = document.getElementById("green-signal-archive-count");
  const bttsSignalArchiveEl = document.getElementById("btts-signal-archive");
  const bttsSignalArchiveCountEl = document.getElementById("btts-signal-archive-count");
  let matchArchiveData = null;
  let matchHistoryData = [];
  let matchHistoryPromise = null;
  let archiveLeagueFilter = "";
  let archiveDateFilter = "";

  if (matchArchiveLeagueEl) {
    matchArchiveLeagueEl.addEventListener("change", () => {
      archiveLeagueFilter = matchArchiveLeagueEl.value;
      renderMatchArchive(matchArchiveData);
    });
  }
  if (matchArchiveDateEl) {
    matchArchiveDateEl.addEventListener("change", () => {
      archiveDateFilter = matchArchiveDateEl.value;
      renderMatchArchive(matchArchiveData);
    });
  }
  if (matchArchiveResetEl) {
    matchArchiveResetEl.addEventListener("click", () => {
      archiveLeagueFilter = "";
      archiveDateFilter = "";
      if (matchArchiveLeagueEl) matchArchiveLeagueEl.value = "";
      if (matchArchiveDateEl) matchArchiveDateEl.value = "";
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

  async function getJSON(url) {
    const response = await fetch(
      url + "?t=" + Date.now(),
      {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache"
        }
      }
    );

    if (!response.ok) {
      throw new Error("HTTP " + response.status + " – " + url);
    }

    return response.json();
  }

  async function loadPermanentMatchHistory() {
    if (!matchHistoryPromise) {
      matchHistoryPromise = fetch(MATCH_HISTORY_URL + "?t=" + Date.now(), {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" }
      }).then(async response => {
        if (!response.ok) throw new Error("HTTP " + response.status);
        const content = await response.text();
        return content.split("\n").filter(Boolean).map(line => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
      }).catch(error => {
        console.warn("Trvalá história zápasov nie je dostupná:", error);
        return [];
      });
    }
    return matchHistoryPromise;
  }

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
    return String(
      match?.tracker?.id ||
      match?.slug ||
      match?.url ||
      match?.id ||
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
  function getStatusBadge(match, minute) {
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

    const minuteLabel =
      minute && minute !== "?" && minute !== "HT"
        ? `${minute}′`
        : "";

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
        label: minuteLabel
          ? `PREDĹŽENIE · ${minuteLabel}`
          : "PREDĹŽENIE",
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
        label: "● PRESTÁVKA · HT",
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
        label: minuteLabel
          ? `● 1. POLČAS · ${minuteLabel}`
          : "● 1. POLČAS",
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
        label: minuteLabel
          ? `● 2. POLČAS · ${minuteLabel}`
          : "● 2. POLČAS",
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
      label: minuteLabel
        ? `● LIVE · ${minuteLabel}`
        : "● LIVE",
      background: "#047857",
      border: "#34d399"
    };
  }

  function getDisplayedMinute(match, collectedAt) {
    const raw = String(match.live_minute ?? "").trim();

    if (!raw) return "?";

    const base = parseInt(raw, 10);

    if (!Number.isFinite(base)) return raw;

    const statusText = String(
      match.status_text || ""
    ).toLowerCase();

    if (
      statusText.includes("half-time") ||
      statusText === "ht" ||
      raw.toLowerCase().includes("ht")
    ) {
      return "HT";
    }

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

  function statValue(stats, keyword) {
    const item = (stats || []).find(s =>
      String(s.label || "").toLowerCase().includes(keyword)
    );

    if (!item) return null;

    const home = Number(item.home);
    const away = Number(item.away);

    if (!Number.isFinite(home) || !Number.isFinite(away)) {
      return null;
    }

    return { home, away };
  }

  function calculatePressure(stats) {
    const measures = [
      { key: "possession", weight: 0.10 },
      { key: "shots on target", weight: 0.40 },
      { key: "dangerous attacks", weight: 0.50 }
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

  function renderCurrentStats(card, stats) {
    const available = Array.isArray(stats)
      ? stats.filter(item =>
          item &&
          String(item.label || "").trim() &&
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

    const heading = document.createElement("div");
    heading.style.cssText = "display:grid;grid-template-columns:1fr 1.5fr 1fr;gap:8px;padding:4px 10px 8px;color:#94a3b8;font-size:10px;font-weight:900;letter-spacing:.5px;text-align:center;";
    heading.innerHTML = "<span style='text-align:left'>DOMÁCI</span><span>ŠTATISTIKA</span><span style='text-align:right'>HOSTIA</span>";
    card.appendChild(heading);

    displayStats.forEach(item => {
      const row = document.createElement("div");
      const isKeyShotStat = /shots? on target|strely na bránu|strely na branu|celkové strely|celkove strely/i.test(String(item.label || ""));
      row.style.cssText = "padding:10px;margin:6px 0;background:" + (isKeyShotStat ? "#14283a" : "#101b2b") + ";border:1px solid " + (isKeyShotStat ? "#32617a" : "#26384f") + ";border-radius:9px;";
      const values = document.createElement("div");
      values.style.cssText = "display:grid;grid-template-columns:minmax(38px,1fr) minmax(90px,1.7fr) minmax(38px,1fr);align-items:center;gap:8px;font-size:13px;";
      const home = document.createElement("strong");
      const away = document.createElement("strong");
      const label = document.createElement("span");
      const suffix = item.suffix === null || item.suffix === undefined ? "" : String(item.suffix);
      home.textContent = String(item.home) + suffix;
      away.textContent = String(item.away) + suffix;
      label.textContent = String(item.label);
      home.style.cssText = "color:#fff;text-align:left;font-variant-numeric:tabular-nums;";
      away.style.cssText = "color:#fff;text-align:right;font-variant-numeric:tabular-nums;";
      label.style.cssText = "color:" + (isKeyShotStat ? "#d7e8f5" : "#a8b8cc") + ";text-align:center;font-size:11px;font-weight:" + (isKeyShotStat ? "800" : "600") + ";line-height:1.3;";
      values.append(home, label, away);
      row.appendChild(values);

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

    if (!statValue(stats, "possession")) missing.push("držanie lopty");
    if (!statValue(stats, "shots on target")) missing.push("strely na bránu");
    if (!statValue(stats, "dangerous attacks")) missing.push("nebezpečné útoky");

    if (!statValue(stats, "shots on target") ||
        !statValue(stats, "dangerous attacks")) {
      return {
        status: "INCOMPLETE",
        label: "NEÚPLNÉ DÁTA",
        background: "#78350f",
        border: "#f59e0b",
        detail: "Pre Momentum chýbajú: " + missing.join(", ") + "."
      };
    }

    if (missing.length) {
      return {
        status: "PARTIAL",
        label: "ČIASTOČNÉ DÁTA",
        background: "#713f12",
        border: "#eab308",
        detail: "Prehľadové štatistiky chýbajú: " + missing.join(", ") +
          ". Momentum sa dá vypočítať."
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

    const windowStart = now - 24 * 60 * 60 * 1000;
    const batches = historyData
      .map(batch => ({
        batch,
        time: Date.parse(batch.collected_at || "")
      }))
      .filter(item =>
        Number.isFinite(item.time) &&
        item.time >= windowStart &&
        item.time <= now
      )
      .sort((a, b) => a.time - b.time);

    if (!batches.length) return null;

    const complete = batches.filter(item =>
      item.batch.collection_complete === true &&
      item.batch.data_status === "complete"
    ).length;

    const errors = batches.reduce((sum, item) =>
      sum + (Array.isArray(item.batch.errors) ? item.batch.errors.length : 0), 0
    );

    const gaps = [];
    for (let i = 1; i < batches.length; i++) {
      const gap = (batches[i].time - batches[i - 1].time) / 60000;
      if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
    }

    return {
      total: batches.length,
      complete,
      partial: batches.length - complete,
      successRate: Math.round(complete / batches.length * 100),
      errors,
      averageGap: gaps.length
        ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length
        : null,
      maxGap: gaps.length ? Math.max(...gaps) : null
    };
  }

  // Súhrnná diagnostika pravidelnosti zberača; nemení signály.
    function historyRecords(historyData, id) {
    const snapshots = [];

    if (!Array.isArray(historyData) || !id) return snapshots;

    historyData.forEach(batch => {
      const validCollection =
        batch.collection_complete === true ||
        batch.data_status === "complete";

      if (!validCollection) return;
      if (!Array.isArray(batch.records)) return;

      batch.records.forEach(record => {
        const match = record.match;

        if (!match || matchId(match) !== id) return;
        if (!isLive(match)) return;

        const time = Date.parse(
          record.collected_at || batch.collected_at || ""
        );

        if (!Number.isFinite(time)) return;

        snapshots.push({ time, match });
      });
    });

    return snapshots.sort((a, b) => a.time - b.time);
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
      const hasAttacks = !!statValue(stats, "dangerous attacks");
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
    const currentAttacks = statValue(currentStats, "dangerous attacks");

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
    const oldAttacks = statValue(oldStats, "dangerous attacks");

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
    for (let i = 1; i < unique.length; i++) {
      const previous = unique[i - 1];
      const current = unique[i];
      const minutes = (current.time - previous.time) / 60000;
      if (!Number.isFinite(minutes) || minutes < MIN_GAP_MINUTES || minutes > MAX_GAP_MINUTES) continue;

      const oldShots = statValue(previous.match.stats || [], "shots on target");
      const shots = statValue(current.match.stats || [], "shots on target");
      const oldAttacks = statValue(previous.match.stats || [], "dangerous attacks");
      const attacks = statValue(current.match.stats || [], "dangerous attacks");
      if (!oldShots || !shots || !oldAttacks || !attacks) continue;

      if (shots.home < oldShots.home || shots.away < oldShots.away ||
          attacks.home < oldAttacks.home || attacks.away < oldAttacks.away) continue;

      intervals.push({
        time: current.time,
        minutes,
        homeRate: ((shots.home - oldShots.home) * 3 + attacks.home - oldAttacks.home) / minutes * 10,
        awayRate: ((shots.away - oldShots.away) * 3 + attacks.away - oldAttacks.away) / minutes * 10
      });
    }

    if (intervals.length < 2) {
      return { ready: false, reason: "Nie sú dostupné dva po sebe idúce platné intervaly bez resetu štatistík." };
    }

    const previous = intervals[intervals.length - 2];
    const latest = intervals[intervals.length - 1];
    const homeDelta = Number((latest.homeRate - previous.homeRate).toFixed(1));
    const awayDelta = Number((latest.awayRate - previous.awayRate).toFixed(1));
    const classify = delta => delta >= 2 ? "ZRÝCHĽUJE"
      : delta <= -2 ? "SPOMAĽUJE" : "STABILNÉ";

    return {
      ready: true,
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
      const oldAttacks = statValue(oldStats, "dangerous attacks");
      const attacks = statValue(stats, "dangerous attacks");
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
      addText(target, "Na graf potrebujeme aspoň dve platné historické merania. Zber pokračuje každých približne 5 minút.", "11px");
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
    legend.style.cssText = "display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:11px;color:#cbd5e1;";
    legend.textContent = "🟢 Domáci  ·  ⚪ Hostia";
    target.appendChild(legend);

    const latest = visible[visible.length - 1];
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

  function renderMomentumOverview(target, pressure, snapshot, threat, trend, reliability, acceleration, collectedAt) {
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
      return /^\\d+[:\\-]\\d+$/.test(score) ? score.replace("-", ":") : null;
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
      ["01_sot6_shots8", "0:1 · SOT ≥6 · strely ≥8"]
    ];
    const totalWins = signals.filter(x => x.status === "WIN").length;
    const totalLosses = signals.filter(x => x.status === "LOSS").length;
    const totalOpen = signals.filter(x => x.status === "OPEN").length;
    const totalUnresolved = signals.filter(x => x.status === "UNRESOLVED").length;
    addText(target, `Spolu: ${signals.length} | WIN: ${totalWins} | LOSS: ${totalLosses} | otvorené: ${totalOpen} | neoverené: ${totalUnresolved}`);
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
      detail.textContent = `${item.tier || item.tierKey || "BTTS"} | ${style[3]} | ${item.startMinute ?? "?"}. min | SOT ${item.combinedSot ?? "?"} | strely ${item.combinedShots ?? "?"}${item.settledScore ? " | konečný stav " + item.settledScore : ""}`;
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
    const times=green.filter(x=>x.status==="WIN"&&Number.isFinite(Number(x.settledMinute))&&Number.isFinite(Number(x.startMinute))).map(x=>Number(x.settledMinute)-Number(x.startMinute)).filter(x=>x>=0&&x<=30);
    const avg=times.length?(times.reduce((a,v)=>a+v,0)/times.length).toFixed(1)+" min":"—";
    el.innerHTML="";
    const grid=document.createElement("div"); grid.style.cssText="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;"; el.appendChild(grid);
    const add=(label,value,detail)=>{const c=document.createElement("div");c.style.cssText="padding:11px;border:1px solid #344b65;border-radius:9px;background:#101b2b;";const v=document.createElement("div");v.textContent=value;v.style.cssText="font-size:20px;font-weight:900;color:#e2e8f0;";const l=document.createElement("div");l.textContent=label;l.style.cssText="font-size:10px;font-weight:800;color:#aebed0;margin-top:3px;";const d=document.createElement("div");d.textContent=detail;d.style.cssText="font-size:10px;color:#94a3b8;margin-top:4px;";c.append(v,l,d);grid.appendChild(c);};
    add("ZELENÝ · ÚSPEŠNOSŤ",g.p,g.w+" WIN / "+g.l+" LOSS · N="+g.n);
    add("ZELENÝ · PRIEM. ČAS DO GÓLU",avg,"Podľa prvého zachytenia gólu");
    add("BTTS · ÚSPEŠNOSŤ",b.p,b.w+" WIN / "+b.l+" LOSS · N="+b.n);
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
      const row = document.createElement("div");
      row.style.cssText = "padding:10px;border:1px solid #35465e;border-radius:9px;background:#101b2b;";
      const title = document.createElement("div");
      title.textContent = band.label + " bodov · " + group.length + " signálov";
      title.style.cssText = "font-size:12px;font-weight:900;color:#fff;";
      const detail = document.createElement("div");
      detail.textContent = "WIN " + winsInBand + " / LOSS " + lossesInBand +
        " · úspešnosť " + rate + " · OPEN " + openInBand + " · UNRESOLVED " + unresolvedInBand;
      detail.style.cssText = "font-size:11px;color:#b7c5d6;margin-top:5px;line-height:1.45;";
      row.append(title, detail);
      qualityGrid.appendChild(row);
    });
    const qualityNote = document.createElement("div");
    qualityNote.textContent = "Upozornenie: zatiaľ ide o malú priebežnú vzorku. OPEN a UNRESOLVED sa nezapočítavajú do úspešnosti. Staré signály bez uloženého skóre zostávajú mimo porovnania. Úspešnosť nie je ROI ani dôkaz ziskovosti.";
    qualityNote.style.cssText = "font-size:10px;color:#94a3b8;margin-top:8px;line-height:1.45;";
    systemStatsEl.appendChild(qualityNote);

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

    if (!data || typeof data !== "object") {
      if (matchArchiveCountEl) matchArchiveCountEl.textContent = "Nedostupné";
      addText(matchArchiveEl, "Archív zápasov sa nepodarilo načítať.");
      return;
    }

    const pending = Array.isArray(data.pending_matches) ? data.pending_matches : [];
    const archived = Array.isArray(data.archived_matches) ? data.archived_matches : [];
    const confirmed = archived
      .filter(item => item?.status_confirmation === "confirmed_finished")
      .sort((a, b) =>
        Date.parse(b.finished_at || b.archived_at || 0) -
        Date.parse(a.finished_at || a.archived_at || 0)
      );
    const olderUnconfirmed = archived.length - confirmed.length;

    if (matchArchiveCountEl) {
      matchArchiveCountEl.textContent = String(confirmed.length);
    }

    addText(matchArchiveEl, `Potvrdené výsledky: ${confirmed.length} | Ešte sa overuje: ${pending.length}`);

    const leagues = [...new Set(confirmed
      .map(item => {
        const match = item?.final_match || item?.last_snapshot?.match || {};
        return String(match.competition || match.league || "").trim();
      })
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "sk"));

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
      if (leagues.includes(archiveLeagueFilter)) {
        matchArchiveLeagueEl.value = archiveLeagueFilter;
      } else {
        archiveLeagueFilter = "";
        matchArchiveLeagueEl.value = "";
      }
    }

    if (matchArchiveDateEl && matchArchiveDateEl.value !== archiveDateFilter) {
      matchArchiveDateEl.value = archiveDateFilter;
    }

    const filtered = confirmed.filter(item => {
      const match = item?.final_match || item?.last_snapshot?.match || {};
      const league = String(match.competition || match.league || "").trim();
      const stamp = item.finished_at || item.archived_at;
      const date = stamp ? new Date(stamp) : null;
      const localDate = date && !Number.isNaN(date.getTime())
        ? [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-")
        : "";
      return (!archiveLeagueFilter || league === archiveLeagueFilter) &&
        (!archiveDateFilter || localDate === archiveDateFilter);
    });

    addText(matchArchiveEl, `Zobrazené výsledky: ${filtered.length} z ${confirmed.length}`);

    function addMatchRow(parent, title, detail, color, competition = "") {
      const row = document.createElement("div");
      row.style.cssText = "padding:12px;margin:9px 0;border-radius:10px;background:#101b2b;border:1px solid #2b3c52;";
      const heading = document.createElement("div");
      heading.textContent = title;
      heading.style.cssText = "font-size:14px;font-weight:800;line-height:1.45;color:#ffffff;";
      const score = document.createElement("div");
      score.textContent = detail;
      score.style.cssText = `font-size:17px;font-weight:900;color:${color};margin-top:5px;`;
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
      addText(matchArchiveEl, "ZÁPASY, KTORÉ SA EŠTE SLEDUJÚ", "14px");
      [...pending]
        .sort((a, b) =>
          Date.parse(b.last_final_check_at || b.last_missing_at || 0) -
          Date.parse(a.last_final_check_at || a.last_missing_at || 0)
        )
        .forEach(item => {
          const match = item?.last_snapshot?.match || {};
          const score = `${match.home_score ?? "?"} : ${match.away_score ?? "?"}`;
          const status = item.last_checked_status || "čaká na prvé overenie";
          addMatchRow(
            matchArchiveEl,
            `${match.home || "?"} – ${match.away || "?"}`,
            `${score} | ${status} | kontrol: ${Number(item.final_check_attempts || 0)}`,
            "#70b7ff",
            match.competition || match.league || ""
          );
        });
    }

    if (filtered.length) {
      addText(matchArchiveEl, "POTVRDENÉ KONEČNÉ VÝSLEDKY", "14px");
      filtered.forEach(item => {
        const match = item?.final_match || item?.last_snapshot?.match || {};
        addMatchRow(
          matchArchiveEl,
          `${match.home || "?"} – ${match.away || "?"}`,
          `${item.final_score || "skóre nepotvrdené"}  ·  ${item.final_status || "FINISHED"}`,
          "#39e6a5",
          match.competition || match.league || "KONEČNÝ VÝSLEDOK POTVRDENÝ"
        );

        const archivedDetail = matchHistoryData.find(entry =>
          String(entry.match_id || "") === String(item.id || "") ||
          (entry.final_match && matchId(entry.final_match) === matchId(match))
        );
        const snapshots = Array.isArray(archivedDetail?.snapshots)
          ? archivedDetail.snapshots
          : [];
        const rawFinalStats = Array.isArray(archivedDetail?.final_match?.stats)
          ? archivedDetail.final_match.stats
          : Array.isArray(match.stats) ? match.stats : [];

        const details = document.createElement("details");
        details.style.cssText = "margin:0 0 12px 0;padding:10px 12px;background:#0c1726;border:1px solid #2b3c52;border-radius:10px;";
        const summary = document.createElement("summary");
        summary.textContent = `📊 KOMPLETNÉ API ŠTATISTIKY · ${snapshots.length} LIVE snímok`;
        summary.style.cssText = "cursor:pointer;color:#8fd8ff;font-size:12px;font-weight:800;";
        details.appendChild(summary);

        const intro = document.createElement("p");
        intro.textContent = snapshots.length
          ? "Časová os zachytáva dostupné údaje približne každých 5 minút. Chýbajúce údaje zostávajú prázdne – nie sú nahradené nulou."
          : "Pre tento starší zápas nie sú v trvalom archíve dostupné LIVE snímky.";
        intro.style.cssText = "font-size:11px;color:#9baabe;line-height:1.45;";
        details.appendChild(intro);

        function appendRawStats(container, stats, heading) {
          const title = document.createElement("div");
          title.textContent = heading;
          title.style.cssText = "margin:10px 0 6px;color:#dce8f5;font-size:12px;font-weight:800;";
          container.appendChild(title);
          if (!Array.isArray(stats) || !stats.length) {
            const empty = document.createElement("p");
            empty.textContent = "API v tomto meraní neposkytlo štatistiky.";
            empty.style.cssText = "font-size:11px;color:#9baabe;";
            container.appendChild(empty);
            return;
          }
          stats.forEach(stat => {
            const line = document.createElement("div");
            const label = stat?.label || stat?.name || "Štatistika";
            const suffix = stat?.suffix === null || stat?.suffix === undefined ? "" : String(stat.suffix).trim();
            const unit = suffix ? " " + suffix : "";
            const home = stat?.home ?? "—";
            const away = stat?.away ?? "—";
            const extras = Object.entries(stat || {})
              .filter(([key]) => !["label", "name", "home", "away", "suffix", "home_pct", "away_pct"].includes(key))
              .map(([key, value]) => key + ": " + (typeof value === "object" ? JSON.stringify(value) : String(value)));
            line.textContent = `${label}: ${home}${unit} – ${away}${unit}${extras.length ? " | " + extras.join(" | ") : ""}`;
            line.style.cssText = "padding:5px 0;border-bottom:1px solid #1d2b3d;font-size:11px;color:#d1dbea;overflow-wrap:anywhere;";
            container.appendChild(line);
          });
        }

        snapshots.forEach((snapshot, index) => {
          const block = document.createElement("details");
          block.style.cssText = "margin:7px 0;padding:8px;background:#111f31;border-radius:8px;";
          const snapSummary = document.createElement("summary");
          const stamp = snapshot.collected_at ? new Date(snapshot.collected_at).toLocaleString("sk-SK") : "čas neznámy";
          snapSummary.textContent = `${stamp} · ${snapshot.minute ?? "?"}' · ${snapshot.home_score ?? "?"}:${snapshot.away_score ?? "?"} · ${(snapshot.raw_stats || snapshot.raw_match?.stats || snapshot.stats || []).length} štatistík`;
          snapSummary.style.cssText = "cursor:pointer;font-size:11px;color:#c9d8e9;";
          block.appendChild(snapSummary);
          appendRawStats(block, snapshot.raw_stats || snapshot.raw_match?.stats || snapshot.stats || [], "ÚDAJE Z API");
          details.appendChild(block);
        });

        appendRawStats(details, rawFinalStats, "KONEČNÉ ŠTATISTIKY Z API");
        matchArchiveEl.appendChild(details);
      });
    } else if (confirmed.length) {
      addText(matchArchiveEl, "Pre zvolenú ligu a dátum sa nenašli žiadne zápasy.");
    }

    if (olderUnconfirmed > 0) {
      addText(matchArchiveEl, `Staršie archívne záznamy bez potvrdeného konečného výsledku: ${olderUnconfirmed}.`);
    }

    if (!pending.length && !confirmed.length && !olderUnconfirmed) {
      addText(matchArchiveEl, "Zatiaľ nie sú zápasy čakajúce na ukončenie ani potvrdené konečné výsledky.");
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

  function renderMatch(match, historyData, collectedAt, allowSignals, staleMode = false, signalArchive = null, bttsArchive = null, target = matchesEl) {
    const card = document.createElement("div");

    card.style.cssText =
      "background:#0d1929;padding:12px;margin:12px 0;border-radius:12px;border:1px solid #31445c;";

    const minute = staleMode
      ? String(match.live_minute ?? "?").trim() || "?"
      : getDisplayedMinute(match, collectedAt);

    // Hlavička zápasu a farebný stavový štítok.
    const header = document.createElement("div");

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
    homeName.textContent = match.home || "Domáci";
    homeName.style.cssText = "min-width:0;overflow-wrap:anywhere;font-size:14px;font-weight:800;line-height:1.25;color:#f1f5f9;";

    const score = document.createElement("div");
    score.textContent = `${Number(match.home_score || 0)} : ${Number(match.away_score || 0)}`;
    score.style.cssText = "white-space:nowrap;font-size:23px;font-weight:900;letter-spacing:.5px;color:#fff;font-variant-numeric:tabular-nums;padding:4px 10px;background:#17283d;border:1px solid #38516e;border-radius:10px;";

    const awayName = document.createElement("div");
    awayName.textContent = match.away || "Hostia";
    awayName.style.cssText = "min-width:0;overflow-wrap:anywhere;text-align:right;font-size:14px;font-weight:800;line-height:1.25;color:#f1f5f9;";

    teams.append(homeName, score, awayName);
    header.appendChild(teams);

    const statusBadge = staleMode
      ? { label: "ZASTARANÉ DÁTA – NIE LIVE", background: "#7f1d1d", border: "#ef4444" }
      : getStatusBadge(match, minute);

    addBadge(
      header,
      statusBadge.label,
      statusBadge.background,
      statusBadge.border
    );

    card.appendChild(header);

    const leagueLine = document.createElement("div");
    leagueLine.textContent = `${getCompetitionFlag(match)} ${match.competition || "Neznáma súťaž"}`;
    leagueLine.style.cssText = "font-size:12px;color:#a8b8cc;margin:2px 0 9px;";
    card.appendChild(leagueLine);

    // Rýchly prehľad kľúčových štatistík priamo v karte zápasu.
    const quickStats = document.createElement("div");
    quickStats.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px;";
    const addQuickStat = (label, value) => {
      if (!value) return;
      const chip = document.createElement("span");
      chip.textContent = `${label} ${value.home} : ${value.away}`;
      chip.style.cssText = "font-size:11px;font-weight:800;color:#cbd5e1;background:#142338;border:1px solid #2b4059;border-radius:8px;padding:6px 8px;font-variant-numeric:tabular-nums;";
      quickStats.appendChild(chip);
    };
    const quickSot = statValue(match.stats || [], "shots on target");
    const quickOff = statValue(match.stats || [], "shots off target");
    let quickTotal = statValue(match.stats || [], "total shots");
    if (!quickTotal && quickSot && quickOff) {
      quickTotal = {
        home: quickSot.home + quickOff.home,
        away: quickSot.away + quickOff.away
      };
    }
    addQuickStat("SOT", quickSot);
    addQuickStat("STRELY", quickTotal);
    addQuickStat("NEB. ÚTOKY", statValue(match.stats || [], "dangerous attacks"));
    if (quickStats.childElementCount) card.appendChild(quickStats);

    const priority = getMatchPriority(match, historyData, collectedAt, allowSignals, staleMode, signalArchive, bttsArchive);
    if (priority.label) {
      const priorityTag = document.createElement("div");
      priorityTag.textContent = priority.label;
      priorityTag.style.cssText = "display:inline-flex;align-items:center;font-size:10px;font-weight:900;letter-spacing:.35px;padding:5px 8px;margin:0 0 9px;border-radius:7px;color:" + priority.color + ";background:" + priority.background + ";border:1px solid " + priority.border + ";";
      card.appendChild(priorityTag);
    }

    const relatedSignals = Array.isArray(signalArchive?.signals)
      ? signalArchive.signals.filter(item => String(item.matchId) === matchId(match))
      : [];
    const signalSummary = document.createElement("div");
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
    if (!relatedSignals.length) {
      const noSignal = document.createElement("span");
      noSignal.textContent = "Bez zaznamenaného signálu";
      noSignal.style.cssText = "font-size:11px;color:#94a3b8;";
      signalSummary.appendChild(noSignal);
    }
    card.appendChild(signalSummary);

    const detail = document.createElement("details");
    detail.style.cssText = "border-top:1px solid #293b52;padding-top:8px;";
    const detailSummary = document.createElement("summary");
    detailSummary.textContent = "📊 OTVORIŤ PREHĽAD ZÁPASU";
    detailSummary.style.cssText = "cursor:pointer;list-style:none;font-size:13px;font-weight:900;color:#39e6a5;padding:8px 2px;";
    detail.appendChild(detailSummary);

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

    addText(diagnosticsSection, "SPOĽAHLIVOSŤ ZBERU – HISTÓRIA", "14px");
    if (reliability) {
      addBadge(
        diagnosticsSection,
        reliability.label,
        reliability.background,
        reliability.border
      );
      addText(
        diagnosticsSection,
        `Vzorka: ${reliability.count} meraní | Momentum dostupné: ${reliability.momentumCoverage}% | Všetky kľúčové štatistiky: ${reliability.fullCoverage}%`
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

    renderCurrentStats(statsSection, match.stats || []);

    // BTTS je samostatný modrý model; jeho história sa nemieša so zeleným gólovým modelom.
    const bttsSignals = Array.isArray(bttsArchive?.signals)
      ? bttsArchive.signals.filter(item => String(item.matchId) === matchId(match))
      : [];
    const bttsOpenSignals = bttsSignals.filter(item => item.status === "OPEN");
    const bttsLatest = bttsSignals.slice().sort((a, b) =>
      Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)
    )[0];
    if (bttsOpenSignals.length) {
      bttsOpenSignals.forEach((signal, index) => addSignalPanel(signalSection, {
        heading: "🔵 BTTS – " + (signal.tier || "PODMIENKA"),
        title: signal.predictedTeam || (signal.predictedSide === "home" ? match.home : match.away),
        detail: `Podmienky: ${signal.tier} | ${signal.combinedSot} SOT spolu | ${signal.combinedShots} striel spolu | vstup ${signal.startMinute}'. Skóre pri signále: ${signal.startScore}. Cieľ: predikovaný tím skóruje do konca zápasu.`,
        background: "#102d4a",
        border: "#38bdf8",
        titleColor: "#7dd3fc"
      }));
    } else if (bttsLatest) {
      addSignalPanel(signalSection, {
        heading: "🔵 BTTS – HISTÓRIA",
        title: bttsLatest.status === "WIN" ? "WIN" : bttsLatest.status === "LOSS" ? "LOSS" : "NEVYRIEŠENÉ",
        detail: `${bttsLatest.tier} | vstup ${bttsLatest.startMinute}' pri skóre ${bttsLatest.startScore} | konečné skóre ${bttsLatest.settledScore || "—"}`,
        background: "#102d4a",
        border: "#38bdf8",
        titleColor: "#7dd3fc"
      });
    } else {
      addSignalPanel(signalSection, {
        heading: "🔵 BTTS",
        title: "Bez potvrdeného signálu",
        detail: "Sledujú sa samostatne všetky tri prahy pri 1:0 a samostatná podmienka pri 0:1.",
        background: "#102d4a",
        border: "#2563eb",
        titleColor: "#93c5fd"
      });
    }

    const pressure = calculatePressure(match.stats || []);
    const snapshot = getSnapshot(match, historyData, collectedAt);
    const threat = calculateThreat(pressure, snapshot);

    if (pressure) {
      addText(
        momentumSection,
        `Tlak: Domáci ${pressure.home}/100 | Hostia ${pressure.away}/100`
      );
    } else {
      addText(momentumSection, "Tlak: čakám na štatistiky.");
    }

    if (snapshot.ready) {
      addText(
        momentumSection,
        `Porovnávané merania: ${snapshot.oldTime} | Rozdiel ${snapshot.minutes} min`
      );

      addText(
        momentumSection,
        `Nové strely na bránu: ${snapshot.homeShots} : ${snapshot.awayShots}`
      );

      addText(
        momentumSection,
        `Nové nebezpečné útoky: ${snapshot.homeAttacks} : ${snapshot.awayAttacks}`
      );

      addText(
        momentumSection,
        `Aktivita spolu: Domáci ${snapshot.homeActivity} | Hostia ${snapshot.awayActivity}`
      );

      addText(
        momentumSection,
        `Aktivita za 10 min: Domáci ${snapshot.homeActivityRate.toFixed(1)} | Hostia ${snapshot.awayActivityRate.toFixed(1)}`
      );
    } else {
      addText(momentumSection, snapshot.text);
    }

    if (threat) {
      addText(
        momentumSection,
        `GOAL THREAT: Domáci ${threat.home}/100 | Hostia ${threat.away}/100`,
        "15px"
      );
    }
    const momentumTrend = renderMomentumTrend(momentumSection, match, historyData, collectedAt, threat);
    const momentumReliability = getMatchReliability(match, historyData, collectedAt);
    const pressureAcceleration = calculatePressureAcceleration(match, historyData, collectedAt);
    renderMomentumOverview(momentumSection, pressure, snapshot, threat, momentumTrend, momentumReliability, pressureAcceleration, collectedAt);

    if (!allowSignals) {
      addSignalPanel(signalSection, {
        heading: staleMode ? "LIVE SIGNÁL" : "LIVE SIGNÁL",
        title: staleMode ? "SIGNÁLY VYPNUTÉ – ZASTARANÉ DÁTA" : "ZBER DÁT NIE JE KOMPLETNÝ",
        detail: staleMode ? "Z tohto záznamu sa nevytvára ani nevyhodnocuje žiadny LIVE signál." : "Nové signály sú momentálne zablokované.",
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
    const currentGreen = allowSignals && Boolean(makeSignal(match, threat, snapshot, collectedAt));
    const confirmed = currentGreen || hasOpenGreen || hasOpenBtts;
    const score = threat ? Math.max(threat.home, threat.away) : 0;

    if (confirmed) {
      return {
        rank: 2,
        score,
        label: "⚡ POTVRDENÝ SIGNÁL",
        color: "#8fffd0",
        background: "#123b2d",
        border: "#39e6a5"
      };
    }

    if (threat && score >= 55) {
      return {
        rank: 1,
        score,
        label: "⚠ ZVÝŠENÝ TLAK",
        color: "#fcd38d",
        background: "#422b12",
        border: "#f59e0b"
      };
    }

    return { rank: 0, score, label: null, color: "", background: "", border: "" };
  }

  function renderMatchesGrouped(items, historyData, allowSignals, staleMode, signalArchive, bttsArchive) {
    const groups = new Map();

    items.forEach(item => {
      const name = String(item.match?.competition || item.match?.league || "Neznáma súťaž").trim() || "Neznáma súťaž";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(item);
    });

    const priorityByItem = new Map(items.map(item => [
      item,
      getMatchPriority(item.match, historyData, item.collectedAt, allowSignals, staleMode, signalArchive, bttsArchive)
    ]));
    const getPriority = item => priorityByItem.get(item) || { rank: 0, score: 0 };
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
        section.style.cssText = "margin:16px 0 20px;padding:10px;background:#0a1422;border:1px solid #263a52;border-radius:12px;";

        const heading = document.createElement("div");
        const flag = getCompetitionFlag(leagueItems[0].match);
        heading.textContent = `${flag} ${league} · ${leagueItems.length} ${leagueItems.length === 1 ? "zápas" : leagueItems.length < 5 ? "zápasy" : "zápasov"}`;
        heading.style.cssText = "font-size:14px;font-weight:800;color:#e2e8f0;padding:3px 2px 8px;border-bottom:1px solid #31445c;margin-bottom:8px;";
        section.appendChild(heading);

        leagueItems.forEach(item => renderMatch(
          item.match,
          historyData,
          item.collectedAt,
          allowSignals,
          staleMode,
          signalArchive,
          bttsArchive,
          section
        ));

        matchesEl.appendChild(section);
      });
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
    const status = !fresh ? "NEAKTUÁLNE" : complete ? "KOMPLETNÉ" : "NEÚPLNÉ";
    const collectedAt = Date.parse(current?.collected_at || "");
    const updated = Number.isFinite(collectedAt)
      ? new Date(collectedAt).toLocaleString("sk-SK")
      : "nedostupná";
    set("dashboard-live-count", fresh ? liveCount : 0);
    set("dashboard-green-count", greenOpen);
    set("dashboard-btts-count", bttsOpen);
    set("dashboard-data-status", status);
    set("dashboard-updated", "Posledný zber dát: " + updated + " · " + status);
    const statusElement = document.getElementById("dashboard-data-status");
    if (statusElement) statusElement.style.color = !fresh ? "#f87171" : complete ? "#39e6a5" : "#fbbf24";
  }

  async function scan() {
    if (scanning) return;
    scanning = true;

    try {
      const [current, historyData, signalArchive, bttsArchive, matchArchive, permanentMatchHistory] = await Promise.all([
        getJSON(CURRENT_URL),
        getJSON(HISTORY_URL).catch(error => {
          console.warn("História zberu nie je dostupná – LIVE zobrazenie pokračuje bez historických metrík:", error);
          return [];
        }),
        getJSON(SIGNAL_ARCHIVE_URL).catch(error => {
          console.warn("Trvalý archív signálov nie je dostupný:", error);
          return null;
        }),
        getJSON(BTTS_ARCHIVE_URL).catch(error => {
          console.warn("BTTS archív zatiaľ nie je dostupný:", error);
          return null;
        }),
        getJSON(MATCH_ARCHIVE_URL).catch(error => {
          console.warn("Archív zápasov nie je dostupný:", error);
          return null;
        }),
        loadPermanentMatchHistory()
      ]);

      matchHistoryData = Array.isArray(permanentMatchHistory) ? permanentMatchHistory : [];

      const collectedTime = Date.parse(current.collected_at || "");
      const age = Date.now() - collectedTime;

      matchesEl.innerHTML = "";
      engine.innerHTML = "";

      addText(engine, "SMART SIGNAL ENGINE v14", "18px");
      addText(engine, `Zdroj: ${current.source || "neznámy"}`);
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
        if (signalArchive) renderServerSignalArchive(signalArchive, greenSignalArchiveEl);
        else if (greenSignalArchiveEl) { greenSignalArchiveEl.innerHTML = ""; addText(greenSignalArchiveEl, "Archív zelených signálov sa nepodarilo načítať."); }
        if (bttsArchive) renderBttsSignalArchive(bttsArchive, bttsSignalArchiveEl);
        else if (bttsSignalArchiveEl) { bttsSignalArchiveEl.innerHTML = ""; addText(bttsSignalArchiveEl, "Archív BTTS sa nepodarilo načítať."); }
        renderMatchArchive(matchArchive);
        renderSystemStats(current, signalArchive, matchArchive);
        renderApiDataQuality(current, matchArchive, matchHistoryData);
        renderFootballPerformanceCenter(signalArchive, bttsArchive);

        signalEl.textContent =
          `ZASTARANÉ DÁTA – NIE LIVE | Posledný zber: ${current.collected_at || "neznámy čas"} | Signály zablokované`;

        return;
      }

      const allowSignals =
        current.collection_complete === true &&
        current.data_status === "complete";

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
      updateDashboard(current, matches.length, signalArchive, bttsArchive, true, allowSignals);

      if (allowSignals) {
        settleSignals(actualMatches);
      }

      addText(engine, `Stav zberu: ${allowSignals ? "KOMPLETNÝ" : "NEÚPLNÝ"}`);
      addText(engine, `Bezpečná archivácia: ${current.archive_safe ? "ÁNO" : "POZASTAVENÁ"}`);
      if (current.feed_guard_warning === true) {
        addText(
          engine,
          "UPOZORNENIE: Počet zápasov vo feede je nižší než historická základňa. Zobrazené sú iba zápasy s overenými detailmi; nové signály a archivácia sú do potvrdenia feedu zablokované."
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
      addText(engine, "ZDRAVIE ZBERAČA – POSLEDNÝCH 24 HODÍN", "15px");
      if (collectorHealth) {
        addText(
          engine,
          `Zbery: ${collectorHealth.total} | Kompletné: ${collectorHealth.complete} | Neúplné: ${collectorHealth.partial} | Úspešnosť: ${collectorHealth.successRate}%`
        );
        addText(
          engine,
          `Priemerný interval: ${collectorHealth.averageGap === null ? "bez porovnania" : collectorHealth.averageGap.toFixed(1) + " min"} | Najdlhšia medzera: ${collectorHealth.maxGap === null ? "—" : collectorHealth.maxGap.toFixed(1) + " min"} | Chyby API: ${collectorHealth.errors}`
        );
      } else {
        addText(engine, "Za posledných 24 hodín zatiaľ nie je dostupná história zberov.");
      }

      addText(engine, `Obnovovanie: každých ${SCAN_INTERVAL_MS / 1000} sekúnd`);
      addText(engine, `Povolený rozdiel meraní: ${MIN_GAP_MINUTES}–${MAX_GAP_MINUTES} min`);

      if (!allowSignals) {
        addText(
          engine,
          "UPOZORNENIE: Zber nie je kompletný. Nové signály sú zablokované."
        );
      }

      if (current.feed_guard_warning) {
        addText(
          engine,
          "FEED GUARD: Podozrivý pokles počtu zápasov. Archivácia je pozastavená."
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
      if (signalArchive) renderServerSignalArchive(signalArchive, greenSignalArchiveEl);
      else if (greenSignalArchiveEl) { greenSignalArchiveEl.innerHTML = ""; addText(greenSignalArchiveEl, "Archív zelených signálov sa nepodarilo načítať."); }
      if (bttsArchive) renderBttsSignalArchive(bttsArchive, bttsSignalArchiveEl);
      else if (bttsSignalArchiveEl) { bttsSignalArchiveEl.innerHTML = ""; addText(bttsSignalArchiveEl, "Archív BTTS sa nepodarilo načítať."); }

      renderMatchArchive(matchArchive);
      renderSystemStats(current, signalArchive, matchArchive);
      renderApiDataQuality(current, matchArchive, matchHistoryData);
      renderFootballPerformanceCenter(signalArchive, bttsArchive);

      signalEl.textContent =
        `Aktualizované: ${new Date().toLocaleTimeString("sk-SK")} | LIVE: ${matches.length}`;

    } catch (error) {
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

      signalEl.textContent = "CHYBA NAČÍTANIA – signály zablokované.";

    } finally {
      scanning = false;
    }
  }

  scan();
  setInterval(scan, SCAN_INTERVAL_MS);
})();

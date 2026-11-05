
(() => {
  const CURRENT_URL = "./data/live-current.json";
  const HISTORY_URL = "./data/live-history.json";
  const SIGNAL_ARCHIVE_URL = "./data/signal-archive.json";
  const MATCH_ARCHIVE_URL = "./data/live-archive.json";
  const SIGNAL_KEY = "live_edge_signals_v6";

  const MIN_GAP_MINUTES = 3;
  const MAX_GAP_MINUTES = 15;

  const MAX_DATA_AGE_MS = 7 * 60 * 1000;
  const SCAN_INTERVAL_MS = 10 * 1000;

  const matchesEl = document.getElementById("matches");
  const signalEl = document.getElementById("signal");

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
    addText(card, "ŠTATISTIKY ZÁPASU", "15px");

    const items = [
      { label: "Držanie lopty", key: "possession" },
      { label: "Strely na bránu", key: "shots on target" },
      { label: "Strely mimo brány", key: "shots off target" },
      { label: "Nebezpečné útoky", key: "dangerous attacks" },
      { label: "Celkové útoky", key: "attacks" },
      { label: "Rohy", key: "corner" }
    ];

    let found = 0;

    items.forEach(item => {
      const value = statValue(stats, item.key);
      if (!value) return;

      addText(card, `${item.label}: ${value.home} : ${value.away}`);
      found++;
    });

    if (!found) {
      addText(card, "Štatistiky zatiaľ nie sú dostupné.");
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

  function makeSignal(match, threat, snapshot, collectedAt) {
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
        difference: threat.home - threat.away
      },
      {
        side: "away",
        team: match.away,
        score: threat.away,
        activity: snapshot.awayActivityRate,
        difference: threat.away - threat.home
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
      status: "OPEN"
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

  function renderServerSignalArchive(data) {
    const serverSignals = Array.isArray(data?.signals) ? data.signals : [];
    const localSignals = Array.isArray(signalHistory) ? signalHistory : [];

    // Spoj trvalý archív zo servera s históriou v tomto prehliadači.
    // Kľúč bráni duplicitám toho istého signálu v oboch zdrojoch.
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

      // Serverové údaje doplnia miestny záznam; už vyhodnotený výsledok
      // sa nestratí, ak druhý zdroj ešte stále uvádza OPEN.
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
    const wins = signals.filter(item => item.status === "WIN").length;
    const losses = signals.filter(item => item.status === "LOSS").length;
    const unresolved = signals.filter(item => item.status === "UNRESOLVED").length;
    const open = signals.filter(item => item.status === "OPEN").length;
    const evaluated = wins + losses;
    const rate = evaluated ? Math.round(wins / evaluated * 100) : 0;

    addText(engine, "TRVALÝ ARCHÍV SIGNÁLOV", "16px");
    addText(engine, `Spolu: ${signals.length} | Výhry: ${wins} | Prehry: ${losses} | Otvorené: ${open} | Neoverené: ${unresolved}`);
    addText(engine, `Úspešnosť vyhodnotených: ${rate}%`);
    addText(engine, "Archív spája záznamy z GitHubu a históriu tohto prehliadača; duplicitné signály sa zobrazia iba raz.");
    addText(engine, "Neoverené znamená, že zápas zmizol z LIVE feedu bez potvrdeného konečného výsledku. Nezapočítava sa ako prehra.");

    // Rozbory úspešnosti počítajú iba potvrdené WIN/LOSS výsledky.
    // Pri malej vzorke zobraz upozornenie, aby percentá nevyzerali spoľahlivejšie, než sú.
    const settledSignals = signals.filter(item =>
      item.status === "WIN" || item.status === "LOSS"
    );

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

      addText(engine, title, "15px");
      if (!groups.size) {
        addText(engine, "Zatiaľ málo vyhodnotených dát.");
        return;
      }

      [...groups.entries()]
        .sort((a, b) => {
          const na = a[1].wins + a[1].losses;
          const nb = b[1].wins + b[1].losses;
          return nb - na || String(a[0]).localeCompare(String(b[0]), "sk");
        })
        .forEach(([key, value]) => {
          const count = value.wins + value.losses;
          const percent = Math.round(value.wins / count * 100);
          const reliability = count < 10 ? " | malá vzorka" : "";
          addText(engine, key + ": " + percent + "% (" + value.wins + " výhier / " + value.losses + " prehier, N=" + count + ")" + reliability);
        });
    }

    renderBreakdown("ÚSPEŠNOSŤ PODĽA MINÚTY", item => {
      const minute = Number(item.startMinute);
      if (!Number.isFinite(minute)) return null;
      const from = Math.floor(minute / 10) * 10;
      return from + "–" + (from + 9) + ". min";
    });

    renderBreakdown("ÚSPEŠNOSŤ PODĽA POČIATOČNÉHO SKÓRE", item => {
      const score = String(item.startScore || "").trim();
      return /^\\d+[:\\-]\\d+$/.test(score) ? score.replace("-", ":") : null;
    });

    renderBreakdown("ÚSPEŠNOSŤ PODĽA STRANY", item => {
      if (item.side === "home") return "Domáci";
      if (item.side === "away") return "Hostia";
      return null;
    });

    const recent = [...signals].sort((a, b) =>
      Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)
    ).slice(0, 100);

    recent.forEach(item => {
      const statusLabels = {
        WIN: "VÝHRA",
        LOSS: "PREHRA",
        OPEN: "OTVORENÝ",
        UNRESOLVED: "NEOVERENÝ"
      };
      const label = statusLabels[item.status] || String(item.status || "NEZNÁMY");
      const line = document.createElement("div");
      const statusStyle = {
        WIN: { background: "#052e1b", border: "#22c55e", color: "#4ade80" },
        LOSS: { background: "#3b0a0a", border: "#ef4444", color: "#f87171" },
        OPEN: { background: "#172554", border: "#3b82f6", color: "#93c5fd" },
        UNRESOLVED: { background: "#292524", border: "#a8a29e", color: "#d6d3d1" }
      };
      const style = statusStyle[item.status] || {
        background: "#0d1929", border: "#31445c", color: "#cbd5e1"
      };
      line.style.cssText = `margin:8px 0;padding:10px;border-radius:9px;background:${style.background};border:1px solid ${style.border};`;
      const title = document.createElement("div");
      title.textContent = (item.home || "?") + (item.startScore ? " (" + item.startScore + ")" : "") + " – " + (item.away || "?");
      title.style.cssText = "font-weight:800;margin-bottom:5px;";
      const detail = document.createElement("div");
      const settledDetail = item.settledScore
        ? " | vyhodnotené pri stave " + item.settledScore + (item.settledMinute != null ? " v " + item.settledMinute + ". min" : "")
        : "";
      detail.textContent = (item.team || item.side || "Tím") + " | " + label + " | začiatok " + (item.startMinute ?? "?") + ". min" + settledDetail;
      detail.style.cssText = `font-size:13px;color:${style.color};font-weight:800;`;
      line.append(title, detail);
      engine.appendChild(line);
    });

    if (signals.length > recent.length) {
      addText(engine, `Zobrazených posledných ${recent.length} záznamov z ${signals.length}.`);
    }
    if (!recent.length) {
      addText(engine, "Zatiaľ nie sú uložené žiadne signály.");
    }
  }

  function renderMatchArchive(data) {
    addText(engine, "SLEDOVANIE ZÁPASOV DO KONCA", "16px");

    if (!data || typeof data !== "object") {
      addText(engine, "Archív zápasov sa nepodarilo načítať.");
      return;
    }

    const pending = Array.isArray(data.pending_matches) ? data.pending_matches : [];
    const archived = Array.isArray(data.archived_matches) ? data.archived_matches : [];
    const confirmed = archived.filter(item =>
      item?.status_confirmation === "confirmed_finished"
    );
    const olderUnconfirmed = archived.length - confirmed.length;

    addText(engine, `Čaká na konečný výsledok: ${pending.length} | Potvrdené ukončené: ${confirmed.length}`);

    if (pending.length) {
      addText(engine, "ZÁPASY, KTORÉ SA EŠTE SLEDUJÚ", "14px");
      [...pending]
        .sort((a, b) =>
          Date.parse(b.last_final_check_at || b.last_missing_at || 0) -
          Date.parse(a.last_final_check_at || a.last_missing_at || 0)
        )
        .slice(0, 10)
        .forEach(item => {
          const match = item?.last_snapshot?.match || {};
          const score = `${match.home_score ?? "?"}:${match.away_score ?? "?"}`;
          const status = item.last_checked_status || "čaká na prvé overenie";
          addText(engine, `${match.home || "?"} – ${match.away || "?"} | ${score} | ${status} | kontrol: ${Number(item.final_check_attempts || 0)}`);
        });
    }

    if (confirmed.length) {
      addText(engine, "POTVRDENÉ KONEČNÉ VÝSLEDKY", "14px");
      [...confirmed]
        .sort((a, b) =>
          Date.parse(b.finished_at || b.archived_at || 0) -
          Date.parse(a.finished_at || a.archived_at || 0)
        )
        .slice(0, 10)
        .forEach(item => {
          const match = item?.final_match || item?.last_snapshot?.match || {};
          addText(engine, `${match.home || "?"} – ${match.away || "?"} | ${item.final_score || "skóre nepotvrdené"} | ${item.final_status || "FINISHED"} | KONEČNÝ VÝSLEDOK POTVRDENÝ`);
        });
    }

    if (olderUnconfirmed > 0) {
      addText(engine, `Staršie archívne záznamy bez potvrdeného konečného výsledku: ${olderUnconfirmed}.`);
    }

    if (!pending.length && !confirmed.length && !olderUnconfirmed) {
      addText(engine, "Zatiaľ nie sú zápasy čakajúce na ukončenie ani potvrdené konečné výsledky.");
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

  function renderMatch(match, historyData, collectedAt, allowSignals, staleMode = false) {
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

    teams.textContent =
      `${match.home} ${Number(match.home_score || 0)} : ${Number(match.away_score || 0)} ${match.away}`;

    teams.style.cssText = `
      font-size:16px;
      font-weight:800;
      line-height:1.5;
      flex:1 1 180px;
    `;

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

    if (staleMode) {
      addSignalPanel(card, {
        heading: "UPOZORNENIE",
        title: "ZASTARANÉ DÁTA – NIE LIVE",
        detail: "Toto je posledný uložený obraz zápasu. Aktuálny stav sa nepotvrdil; nepoužívaj ho na rozhodovanie ani stávky.",
        background: "#450a0a",
        border: "#ef4444",
        titleColor: "#fca5a5"
      });
    }

    addText(
      card,
      `${getCompetitionFlag(match)} ${match.competition || "Neznáma súťaž"} | ${minute === "HT" ? "Prestávka" : minute + ". minúta"} | meranie: ${collectedAt || "neznámy čas"}`
    );

    const quality = getDataQuality(match, collectedAt);
    addBadge(
      card,
      quality.label,
      quality.background,
      quality.border
    );
    addText(card, quality.detail);

    const reliability = getMatchReliability(
      match,
      historyData,
      collectedAt
    );

    addText(card, "SPOĽAHLIVOSŤ ZBERU – HISTÓRIA", "14px");
    if (reliability) {
      addBadge(
        card,
        reliability.label,
        reliability.background,
        reliability.border
      );
      addText(
        card,
        `Vzorka: ${reliability.count} meraní | Momentum dostupné: ${reliability.momentumCoverage}% | Všetky kľúčové štatistiky: ${reliability.fullCoverage}%`
      );
      addText(
        card,
        `Priemerný interval: ${reliability.averageGap === null ? "zatiaľ bez porovnania" : reliability.averageGap.toFixed(1) + " min"} | Najdlhšia medzera: ${reliability.maxGap === null ? "—" : reliability.maxGap.toFixed(1) + " min"} | Medzery nad 7 min: ${reliability.longGaps}`
      );
    } else {
      addText(card, "Zatiaľ nie je dostupná história meraní tohto zápasu.");
    }
    addText(
      card,
      "Ukazovateľ vychádza z uložených kompletných zberov (približne posledných 24 hodín); je iba informačný."
    );

    renderCurrentStats(card, match.stats || []);

    const pressure = calculatePressure(match.stats || []);
    const snapshot = getSnapshot(match, historyData, collectedAt);
    const threat = calculateThreat(pressure, snapshot);

    if (pressure) {
      addText(
        card,
        `Tlak: Domáci ${pressure.home}/100 | Hostia ${pressure.away}/100`
      );
    } else {
      addText(card, "Tlak: čakám na štatistiky.");
    }

    if (snapshot.ready) {
      addText(
        card,
        `Porovnávané merania: ${snapshot.oldTime} | Rozdiel ${snapshot.minutes} min`
      );

      addText(
        card,
        `Nové strely na bránu: ${snapshot.homeShots} : ${snapshot.awayShots}`
      );

      addText(
        card,
        `Nové nebezpečné útoky: ${snapshot.homeAttacks} : ${snapshot.awayAttacks}`
      );

      addText(
        card,
        `Aktivita spolu: Domáci ${snapshot.homeActivity} | Hostia ${snapshot.awayActivity}`
      );

      addText(
        card,
        `Aktivita za 10 min: Domáci ${snapshot.homeActivityRate.toFixed(1)} | Hostia ${snapshot.awayActivityRate.toFixed(1)}`
      );
    } else {
      addText(card, snapshot.text);
    }

    if (threat) {
      addText(
        card,
        `GOAL THREAT: Domáci ${threat.home}/100 | Hostia ${threat.away}/100`,
        "15px"
      );
    }

    if (!allowSignals) {
      addSignalPanel(card, {
        heading: staleMode ? "LIVE SIGNÁL" : "LIVE SIGNÁL",
        title: staleMode ? "SIGNÁLY VYPNUTÉ – ZASTARANÉ DÁTA" : "ZBER DÁT NIE JE KOMPLETNÝ",
        detail: staleMode ? "Z tohto záznamu sa nevytvára ani nevyhodnocuje žiadny LIVE signál." : "Nové signály sú momentálne zablokované.",
        background: "#292524",
        border: "#78716c",
        titleColor: "#d6d3d1"
      });
    } else {
      const signal = makeSignal(
        match,
        threat,
        snapshot,
        collectedAt
      );

      if (signal) {
        addSignalPanel(card, {
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

        addSignalPanel(card, {
          heading: "⚠ ZVÝŠENÝ TLAK",
          title: `${side} – ${score}/100`,
          detail: "Zatiaľ nie sú splnené všetky podmienky pre LIVE signál.",
          background: "#422b12",
          border: "#f59e0b",
          titleColor: "#fbbf24"
        });

      } else {
        addSignalPanel(card, {
          heading: "LIVE SIGNÁL",
          title: "Zatiaľ bez potvrdeného signálu",
          detail: "Systém naďalej sleduje vývoj zápasu.",
          background: "#202b3b",
          border: "#64748b",
          titleColor: "#cbd5e1"
        });
      }
    }

    matchesEl.appendChild(card);
  }

  async function scan() {
    if (scanning) return;
    scanning = true;

    try {
      const [current, historyData, signalArchive, matchArchive] = await Promise.all([
        getJSON(CURRENT_URL),
        getJSON(HISTORY_URL).catch(error => {
          console.warn("História zberu nie je dostupná – LIVE zobrazenie pokračuje bez historických metrík:", error);
          return [];
        }),
        getJSON(SIGNAL_ARCHIVE_URL).catch(error => {
          console.warn("Trvalý archív signálov nie je dostupný:", error);
          return null;
        }),
        getJSON(MATCH_ARCHIVE_URL).catch(error => {
          console.warn("Archív zápasov nie je dostupný:", error);
          return null;
        })
      ]);

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

        addText(engine, "LIVE zápasy: 0 – aktuálny feed nie je potvrdený");
        addText(engine, `Posledné uložené zápasy: ${staleMatches.length}`);
        addText(engine, "Zobrazenie je iba archívny náhľad. Žiadne signály, vyhodnocovanie ani aktualizácia skóre sa z neho nevykonáva.");

        if (staleMatches.length) {
          staleMatches.forEach(item => renderMatch(
            item.match,
            historyData,
            item.collectedAt,
            false,
            true
          ));
        } else {
          addText(matchesEl, "Nie sú dostupné ani posledné uložené LIVE zápasy.");
        }

        renderSummary();
        if (signalArchive) renderServerSignalArchive(signalArchive);
        renderMatchArchive(matchArchive);

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

      matches.forEach(item => {
        renderMatch(
          item.match,
          historyData,
          item.collectedAt,
          allowSignals
        );
      });

      renderSummary();
      if (signalArchive) renderServerSignalArchive(signalArchive);
      else addText(engine, "Trvalý archív signálov sa nepodarilo načítať.");
      renderMatchArchive(matchArchive);

      signalEl.textContent =
        `Aktualizované: ${new Date().toLocaleTimeString("sk-SK")} | LIVE: ${matches.length}`;

    } catch (error) {
      console.error("Scanner chyba:", error);

      matchesEl.innerHTML = "";
      engine.innerHTML = "";

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

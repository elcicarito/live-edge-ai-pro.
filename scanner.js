
(() => {
  const CURRENT_URL = "./data/live-current.json";
  const HISTORY_URL = "./data/live-history.json";
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
      { label: "Celkové útoky", key: "attacks" }
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

      const goals = signal.side === "home"
        ? Number(match.home_score || 0)
        : Number(match.away_score || 0);

      const minute = Number(match.live_minute);
      const status = (
        getStatus(match) + " " + String(match.status_text || "")
      ).toLowerCase();

      if (goals > signal.startGoals) {
        signal.status = "WIN";
        signal.settledAt = new Date().toISOString();
        changed = true;
      } else if (
        (Number.isFinite(minute) && minute >= signal.deadlineMinute) ||
        status.includes("finished")
      ) {
        signal.status = "LOSS";
        signal.settledAt = new Date().toISOString();
        changed = true;
      }
    });

    if (changed) saveSignals();
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

  function renderMatch(match, historyData, collectedAt, allowSignals) {
    const card = document.createElement("div");

    card.style.cssText =
      "background:#0d1929;padding:12px;margin:12px 0;border-radius:12px;border:1px solid #31445c;";

    const minute = getDisplayedMinute(match, collectedAt);

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

    const statusBadge = getStatusBadge(match, minute);

    addBadge(
      header,
      statusBadge.label,
      statusBadge.background,
      statusBadge.border
    );

    card.appendChild(header);

    addText(
      card,
      `${match.competition || "Futbal"} | ${minute === "HT" ? "Prestávka" : minute + ". minúta"}`
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
        heading: "LIVE SIGNÁL",
        title: "ZBER DÁT NIE JE KOMPLETNÝ",
        detail: "Nové signály sú momentálne zablokované.",
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
      const [current, historyData] = await Promise.all([
        getJSON(CURRENT_URL),
        getJSON(HISTORY_URL)
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

        addText(engine, "LIVE zápasy: 0");
        renderSummary();

        addText(matchesEl, "Čakám na nový aktuálny zber LIVE zápasov.");

        signalEl.textContent =
          "NEAKTUÁLNE DÁTA – LIVE signály zablokované.";

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
      addText(engine, `Vek dát: ${Math.max(0, Math.round(age / 1000))} sekúnd`);
      addText(engine, `LIVE zápasy: ${matches.length}`);
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

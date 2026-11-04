(() => {
  const LATEST_URL = "./data/live-latest.json";
  const HISTORY_URL = "./data/live-history.json";
  const SIGNAL_KEY = "live_edge_signals_v6";

  const MIN_GAP_MINUTES = 3;
  const MAX_GAP_MINUTES = 15;

  // Collector pracuje každých 5 minút.
  // Tolerancia umožňuje oneskorenie GitHub Actions.
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
      // Čiastočné zbery sa nepoužívajú na výpočet aktivity.
      if (batch.data_status !== "complete") return;
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
      "background:#0d1929;padding:12px;margin:12px 0;border-radius:10px;border:1px solid #31445c;";

    const minute = getDisplayedMinute(match, collectedAt);

    addText(
      card,
      `${match.home} ${Number(match.home_score || 0)} : ${Number(match.away_score || 0)} ${match.away}`,
      "16px"
    );

    addText(
      card,
      `${match.competition || "Futbal"} | ${minute}. minúta`
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
      addText(
        card,
        "LIVE SIGNÁL: Zablokovaný – zber dát nie je kompletný.",
        "15px"
      );
    } else {
      const signal = makeSignal(
        match,
        threat,
        snapshot,
        collectedAt
      );

      if (signal) {
        addText(
          card,
          `LIVE SIGNÁL: ${signal.team} – tlak ${signal.score}/100`,
          "16px"
        );

        recordSignal(match, signal);
      } else {
        addText(card, "LIVE SIGNÁL: Zatiaľ bez potvrdeného signálu.");
      }
    }

    matchesEl.appendChild(card);
  }

  async function scan() {
    if (scanning) return;
    scanning = true;

    try {
      const [latest, historyData] = await Promise.all([
        getJSON(LATEST_URL),
        getJSON(HISTORY_URL)
      ]);

      const collectedTime = Date.parse(latest.collected_at || "");
      const age = Date.now() - collectedTime;

      matchesEl.innerHTML = "";
      engine.innerHTML = "";

      addText(engine, "SMART SIGNAL ENGINE v11", "18px");
      addText(engine, `Zdroj: ${latest.source || "neznámy"}`);
      addText(engine, `Dáta: ${latest.collected_at || "neznámy čas"}`);
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

      const dataStatus = latest.data_status || "complete";
      const allowSignals = dataStatus === "complete";

      const records = Array.isArray(latest.records)
        ? latest.records
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
          collectedAt: record.collected_at || latest.collected_at
        }))
        .filter(item => isLive(item.match));

      const actualMatches = matches.map(item => item.match);

      if (allowSignals) {
        settleSignals(actualMatches);
      }

      addText(engine, `Stav zberu: ${dataStatus.toUpperCase()}`);
      addText(engine, `Vek dát: ${Math.max(0, Math.round(age / 1000))} sekúnd`);
      addText(engine, `LIVE zápasy: ${matches.length}`);
      addText(engine, `Obnovovanie stránky: každých ${SCAN_INTERVAL_MS / 1000} sekúnd`);
      addText(engine, `Povolený rozdiel meraní: ${MIN_GAP_MINUTES}–${MAX_GAP_MINUTES} min`);

      if (!allowSignals) {
        addText(
          engine,
          "UPOZORNENIE: Čiastočný zber. Nové signály sú zablokované."
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

      addText(engine, "SMART SIGNAL ENGINE v11");
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

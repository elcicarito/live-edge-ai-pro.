(() => {
  const LATEST_URL = "./data/live-latest.json";
  const HISTORY_URL = "./data/live-history.json";
  const SIGNAL_KEY = "live_edge_signals_v6";

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

    if (!Array.isArray(signalHistory)) {
      signalHistory = [];
    }
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
  }

  async function getJSON(url) {
    const response = await fetch(
      url + "?t=" + Date.now(),
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    return response.json();
  }

  function matchId(match) {
    return String(match.tracker?.id || match.url || "");
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

  // AKTUÁLNE ŠTATISTIKY ZÁPASU

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

      addText(
        card,
        `${item.label}: ${value.home} : ${value.away}`
      );

      found++;
    });

    if (!found) {
      addText(card, "Štatistiky zatiaľ nie sú dostupné.");
    }
  }

  function historyRecords(historyData, id) {
    const snapshots = [];

    if (!Array.isArray(historyData)) return snapshots;

    historyData.forEach(batch => {
      (batch.records || []).forEach(record => {
        const match = record.match;

        if (!match || matchId(match) !== id) return;

        const time = Date.parse(
          record.collected_at || batch.collected_at || ""
        );

        if (!Number.isFinite(time)) return;

        snapshots.push({ time, match });
      });
    });

    return snapshots.sort((a, b) => a.time - b.time);
  }

  function getSnapshot(match, historyData) {
    const id = matchId(match);
    const stats = match.stats || [];

    const shots = statValue(stats, "shots on target");
    const attacks = statValue(stats, "dangerous attacks");

    const records = historyRecords(historyData, id);
    const now = Date.now();

    const oldRecords = records.filter(record => {
      const age = now - record.time;

      return age >= 4 * 60000 && age <= 20 * 60000;
    });

    const old = oldRecords.length
      ? oldRecords[oldRecords.length - 1]
      : null;

    if (!old) {
      return {
        ready: false,
        text: "Zbieram historické dáta – čakám na ďalšie meranie."
      };
    }

    const oldStats = old.match.stats || [];

    const oldShots = statValue(oldStats, "shots on target");
    const oldAttacks = statValue(oldStats, "dangerous attacks");

    const homeShots = shots && oldShots
      ? Math.max(0, shots.home - oldShots.home) : 0;

    const awayShots = shots && oldShots
      ? Math.max(0, shots.away - oldShots.away) : 0;

    const homeAttacks = attacks && oldAttacks
      ? Math.max(0, attacks.home - oldAttacks.home) : 0;

    const awayAttacks = attacks && oldAttacks
      ? Math.max(0, attacks.away - oldAttacks.away) : 0;

    return {
      ready: true,
      homeShots,
      awayShots,
      homeAttacks,
      awayAttacks,
      homeActivity: homeShots * 3 + homeAttacks,
      awayActivity: awayShots * 3 + awayAttacks,
      minutes: Math.round((now - old.time) / 60000)
    };
  }

  function calculateThreat(pressure, snapshot) {
    if (!pressure || !snapshot.ready) return null;

    const home = Math.min(
      100,
      Math.round(
        pressure.home * 0.45 +
        Math.min(snapshot.homeActivity * 3, 40) * 0.55
      )
    );

    const away = Math.min(
      100,
      Math.round(
        pressure.away * 0.45 +
        Math.min(snapshot.awayActivity * 3, 40) * 0.55
      )
    );

    return { home, away };
  }

  function makeSignal(match, threat, snapshot) {
    const minute = Number(match.live_minute);

    if (!threat || !snapshot.ready) return null;
    if (!Number.isFinite(minute)) return null;
    if (minute < 10 || minute > 90) return null;

    const candidates = [
      {
        side: "home",
        team: match.home,
        score: threat.home,
        activity: snapshot.homeActivity,
        difference: threat.home - threat.away
      },
      {
        side: "away",
        team: match.away,
        score: threat.away,
        activity: snapshot.awayActivity,
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

      const match = matches.find(
        item => matchId(item) === signal.matchId
      );

      if (!match) return;

      const goals = signal.side === "home"
        ? Number(match.home_score || 0)
        : Number(match.away_score || 0);

      const minute = Number(match.live_minute);
      const status = String(match.status || "").toLowerCase();

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

    const rate = total
      ? Math.round(wins / total * 100)
      : 0;

    addText(engine, "HISTÓRIA SIGNÁLOV", "16px");
    addText(engine, `Výhry: ${wins} | Prehry: ${losses} | Otvorené: ${open}`);
    addText(engine, `Úspešnosť vyhodnotených signálov: ${rate}%`);

    addText(
      engine,
      "Pozor: ide o technické vyhodnotenie signálov, nie garantovaný zisk."
    );
  }

  function renderMatch(match, historyData) {
    const card = document.createElement("div");

    card.style.cssText =
      "background:#0d1929;padding:12px;margin:12px 0;border-radius:10px;border:1px solid #31445c;";

    const homeScore = Number(match.home_score || 0);
    const awayScore = Number(match.away_score || 0);
    const minute = match.live_minute || "?";

    addText(
      card,
      `${match.home} ${homeScore} : ${awayScore} ${match.away}`,
      "16px"
    );

    addText(
      card,
      `${match.competition || "Futbal"} | ${minute}. minúta`
    );

    // ZOBRAZENIE VŠETKÝCH DOSTUPNÝCH ŠTATISTÍK
    renderCurrentStats(card, match.stats || []);

    const pressure = calculatePressure(match.stats || []);
    const snapshot = getSnapshot(match, historyData);
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
        `Zmena za ${snapshot.minutes} min: strely na bránu ${snapshot.homeShots} : ${snapshot.awayShots}`
      );

      addText(
        card,
        `Zmena nebezpečných útokov: ${snapshot.homeAttacks} : ${snapshot.awayAttacks}`
      );

      addText(
        card,
        `Aktivita: Domáci ${snapshot.homeActivity} | Hostia ${snapshot.awayActivity}`
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

    const signal = makeSignal(match, threat, snapshot);

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

      const records = Array.isArray(latest.records)
        ? latest.records
        : [];

      const matches = records
        .map(record => record.match)
        .filter(match =>
          match &&
          String(match.status || "").toLowerCase().includes("live")
        );

      settleSignals(matches);

      matchesEl.innerHTML = "";
      engine.innerHTML = "";

      addText(engine, "SMART SIGNAL ENGINE v6", "18px");

      addText(
        engine,
        `Posledná aktualizácia: ${new Date().toLocaleTimeString("sk-SK")}`
      );

      addText(
        engine,
        `LIVE zápasy: ${matches.length}`
      );

      if (!matches.length) {
        addText(matchesEl, "Momentálne nie sú dostupné LIVE zápasy.");
      }

      matches.forEach(match => {
        renderMatch(match, historyData);
      });

      renderSummary();

      signalEl.textContent =
        `Aktualizované: ${new Date().toLocaleTimeString("sk-SK")} | LIVE: ${matches.length}`;

    } catch (error) {
      console.error("Scanner chyba:", error);

      matchesEl.textContent =
        "Chyba načítania dát: " + error.message;

      engine.innerHTML = "";

      addText(engine, "SMART SIGNAL ENGINE v6");
      addText(engine, "Nepodarilo sa načítať LIVE dáta.");

    } finally {
      scanning = false;
    }
  }

  scan();
  setInterval(scan, 60000);

})();

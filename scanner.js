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
    return String(match?.tracker?.id || match?.url || "");
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

  // ZÍSKANIE VŠETKÝCH MERANÍ KONKRÉTNEHO ZÁPASU

  function historyRecords(historyData, id) {
    const snapshots = [];

    if (!Array.isArray(historyData)) return snapshots;

    historyData.forEach(batch => {
      if (!Array.isArray(batch.records)) return;

      batch.records.forEach(record => {
        const match = record.match;

        if (!match || matchId(match) !== id) return;

        const time = Date.parse(
          record.collected_at ||
          batch.collected_at ||
          ""
        );

        if (!Number.isFinite(time)) return;

        snapshots.push({
          time,
          match
        });
      });
    });

    return snapshots.sort((a, b) => a.time - b.time);
  }

  function sameStats(statsA, statsB) {
    const keys = [
      "shots on target",
      "dangerous attacks"
    ];

    return keys.every(key => {
      const a = statValue(statsA, key);
      const b = statValue(statsB, key);

      if (!a || !b) return false;

      return (
        a.home === b.home &&
        a.away === b.away
      );
    });
  }

  // POROVNANIE POSLEDNÝCH DVOCH MERANÍ

  function getSnapshot(match, historyData, collectedAt) {
    const id = matchId(match);
    const currentStats = match.stats || [];

    const currentShots = statValue(
      currentStats,
      "shots on target"
    );

    const currentAttacks = statValue(
      currentStats,
      "dangerous attacks"
    );

    if (!currentShots || !currentAttacks) {
      return {
        ready: false,
        text: "Čakám na kompletné štatistiky zápasu."
      };
    }

    const records = historyRecords(historyData, id);

    if (!records.length) {
      return {
        ready: false,
        text: "Zbieram prvé historické meranie."
      };
    }

    const currentTime = Date.parse(collectedAt || "");

    let previousRecords;

    if (Number.isFinite(currentTime)) {
      // Vynecháme aktuálne meranie z histórie.
      previousRecords = records.filter(record =>
        record.time < currentTime - 1000
      );
    } else {
      // Záložný režim, ak chýba čas aktuálneho zberu.
      previousRecords = records.slice();

      const last = previousRecords[previousRecords.length - 1];

      if (
        last &&
        sameStats(last.match.stats || [], currentStats)
      ) {
        previousRecords.pop();
      }
    }

    if (!previousRecords.length) {
      return {
        ready: false,
        text: "Čakám na druhé meranie tohto zápasu."
      };
    }

    // Posledné dostupné staršie meranie.
    const old = previousRecords[previousRecords.length - 1];

    const oldStats = old.match.stats || [];

    const oldShots = statValue(
      oldStats,
      "shots on target"
    );

    const oldAttacks = statValue(
      oldStats,
      "dangerous attacks"
    );

    if (!oldShots || !oldAttacks) {
      return {
        ready: false,
        text: "Staršie meranie nemá kompletné štatistiky."
      };
    }

    const minutes = (Date.now() - old.time) / 60000;

    if (!Number.isFinite(minutes) || minutes <= 0) {
      return {
        ready: false,
        text: "Čakám na platné časové údaje."
      };
    }

    // Ochrana pred použitím príliš starých dát.
    if (minutes > 60) {
      return {
        ready: false,
        text: "Historické meranie je staršie ako 60 minút."
      };
    }

    const homeShots = Math.max(
      0,
      currentShots.home - oldShots.home
    );

    const awayShots = Math.max(
      0,
      currentShots.away - oldShots.away
    );

    const homeAttacks = Math.max(
      0,
      currentAttacks.home - oldAttacks.home
    );

    const awayAttacks = Math.max(
      0,
      currentAttacks.away - oldAttacks.away
    );

    const homeActivity =
      homeShots * 3 + homeAttacks;

    const awayActivity =
      awayShots * 3 + awayAttacks;

    // Prepočet aktivity na 10 minút.
    const homeActivityRate =
      homeActivity / minutes * 10;

    const awayActivityRate =
      awayActivity / minutes * 10;

    return {
      ready: true,

      homeShots,
      awayShots,

      homeAttacks,
      awayAttacks,

      homeActivity,
      awayActivity,

      homeActivityRate,
      awayActivityRate,

      minutes: Math.round(minutes),

      oldTime: new Date(old.time).toLocaleTimeString("sk-SK")
    };
  }

  // ORIENTAČNÉ SKÓRE HROZBY

  function calculateThreat(pressure, snapshot) {
    if (!pressure || !snapshot.ready) return null;

    const home = Math.min(
      100,
      Math.round(
        pressure.home * 0.45 +
        Math.min(snapshot.homeActivityRate * 3, 40) * 0.55
      )
    );

    const away = Math.min(
      100,
      Math.round(
        pressure.away * 0.45 +
        Math.min(snapshot.awayActivityRate * 3, 40) * 0.55
      )
    );

    return { home, away };
  }

  // VYTVORENIE SIGNÁLU

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

  // VYHODNOTENIE SIGNÁLOV

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
      const status = String(
        match.status_text || match.status || ""
      ).toLowerCase();

      if (goals > signal.startGoals) {
        signal.status = "WIN";
        signal.settledAt = new Date().toISOString();
        changed = true;
      } else if (
        (Number.isFinite(minute) &&
          minute >= signal.deadlineMinute) ||
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
    const wins = signalHistory.filter(
      s => s.status === "WIN"
    ).length;

    const losses = signalHistory.filter(
      s => s.status === "LOSS"
    ).length;

    const open = signalHistory.filter(
      s => s.status === "OPEN"
    ).length;

    const total = wins + losses;

    const rate = total
      ? Math.round(wins / total * 100)
      : 0;

    addText(engine, "HISTÓRIA SIGNÁLOV", "16px");

    addText(
      engine,
      `Výhry: ${wins} | Prehry: ${losses} | Otvorené: ${open}`
    );

    addText(
      engine,
      `Úspešnosť vyhodnotených signálov: ${rate}%`
    );

    addText(
      engine,
      "GOAL THREAT je orientačné skóre tlaku, nie pravdepodobnosť gólu."
    );

    addText(
      engine,
      "Výsledky signálov nie sú zárukou zisku."
    );
  }

  // ZOBRAZENIE ZÁPASU

  function renderMatch(match, historyData, collectedAt) {
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

    renderCurrentStats(card, match.stats || []);

    const pressure = calculatePressure(match.stats || []);

    const snapshot = getSnapshot(
      match,
      historyData,
      collectedAt
    );

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

    const signal = makeSignal(match, threat, snapshot);

    if (signal) {
      addText(
        card,
        `LIVE SIGNÁL: ${signal.team} – tlak ${signal.score}/100`,
        "16px"
      );

      recordSignal(match, signal);
    } else {
      addText(
        card,
        "LIVE SIGNÁL: Zatiaľ bez potvrdeného signálu."
      );
    }

    matchesEl.appendChild(card);
  }

  // HLAVNÉ SKENOVANIE

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

      addText(engine, "SMART SIGNAL ENGINE v7", "18px");

      addText(
        engine,
        `Posledná aktualizácia: ${new Date().toLocaleTimeString("sk-SK")}`
      );

      addText(
        engine,
        `LIVE zápasy: ${matches.length}`
      );

      if (!matches.length) {
        addText(
          matchesEl,
          "Momentálne nie sú dostupné LIVE zápasy."
        );
      }

      records.forEach(record => {
        const match = record.match;

        if (
          !match ||
          !String(match.status || "").toLowerCase().includes("live")
        ) {
          return;
        }

        renderMatch(
          match,
          historyData,
          record.collected_at || latest.collected_at
        );
      });

      renderSummary();

      signalEl.textContent =
        `Aktualizované: ${new Date().toLocaleTimeString("sk-SK")} | LIVE: ${matches.length}`;

    } catch (error) {
      console.error("Scanner chyba:", error);

      matchesEl.textContent =
        "Chyba načítania dát: " + error.message;

      engine.innerHTML = "";

      addText(engine, "SMART SIGNAL ENGINE v7");
      addText(engine, "Nepodarilo sa načítať LIVE dáta.");

    } finally {
      scanning = false;
    }
  }

  scan();
  setInterval(scan, 60000);

})();

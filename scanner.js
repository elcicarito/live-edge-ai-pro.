(() => {
  const API = "https://sportscore.com/api/widget/matches/?sport=football&limit=50";
  const MATCH_API = "https://sportscore.com/api/widget/match/?sport=football&slug=";
  const HISTORY_KEY = "live_edge_history_v5";
  const SIGNAL_KEY = "live_edge_signals_v5";

  const matchesEl = document.getElementById("matches");
  const signalEl = document.getElementById("signal");
  if (!matchesEl || !signalEl) return;

  let engine = document.getElementById("pressure-engine");
  if (!engine) {
    engine = document.createElement("div");
    engine.id = "pressure-engine";
    signalEl.insertAdjacentElement("afterend", engine);
  }

  engine.style.cssText =
    "margin-top:15px;padding:14px;background:#172438;color:white;border-radius:12px;";

  let scanning = false;
  let history = {};
  let signalHistory = [];

  try {
    history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
    if (!history || typeof history !== "object") history = {};
  } catch {
    history = {};
  }

  try {
    signalHistory = JSON.parse(localStorage.getItem(SIGNAL_KEY) || "[]");
    if (!Array.isArray(signalHistory)) signalHistory = [];
  } catch {
    signalHistory = [];
  }

  function saveData() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      localStorage.setItem(SIGNAL_KEY, JSON.stringify(signalHistory.slice(-500)));
    } catch (e) {
      console.warn("Ukladanie zlyhalo", e);
    }
  }

  function slugFromUrl(url) {
    const parts = (url || "").split("/").filter(Boolean);
    return parts.length >= 4 ? parts[2] : "";
  }

  function statValue(stats, keyword) {
    const item = (stats || []).find(s =>
      String(s.label || "").toLowerCase().includes(keyword)
    );
    if (!item) return null;

    const home = Number(item.home);
    const away = Number(item.away);
    if (!Number.isFinite(home) || !Number.isFinite(away)) return null;

    return { home, away };
  }

  function calculatePressure(stats) {
    const measures = [
      { key: "possession", weight: 0.10 },
      { key: "shots on target", weight: 0.40 },
      { key: "dangerous attacks", weight: 0.50 }
    ];

    let home = 0, away = 0, totalWeight = 0;

    measures.forEach(m => {
      const v = statValue(stats, m.key);
      if (!v) return;

      const total = v.home + v.away;
      const h = total > 0 ? v.home / total : 0.5;

      home += h * m.weight;
      away += (1 - h) * m.weight;
      totalWeight += m.weight;
    });

    if (!totalWeight) return null;

    return {
      home: Math.round(home / totalWeight * 100),
      away: Math.round(away / totalWeight * 100)
    };
  }

  function getSnapshot(id, stats, pressure) {
    const now = Date.now();
    if (!history[id]) history[id] = [];

    const shots = statValue(stats, "shots on target");
    const attacks = statValue(stats, "dangerous attacks");

    const current = {
      time: now,
      hs: shots?.home ?? null,
      as: shots?.away ?? null,
      ha: attacks?.home ?? null,
      aa: attacks?.away ?? null,
      ph: pressure?.home ?? null,
      pa: pressure?.away ?? null
    };

    const records = history[id];
    const last = records[records.length - 1];

    // Vzorka najviac raz za minútu.
    if (!last || now - last.time >= 60000) {
      records.push(current);
    }

    history[id] = records
      .filter(r => now - r.time <= 86400000)
      .slice(-150);

    const old = [...history[id]].reverse().find(
      r => now - r.time >= 5 * 60000
    );

    saveData();

    if (!old) {
      return {
        ready: false,
        text: "Zbieram dáta – potrebných je 5 minút."
      };
    }

    const homeShots = shots && old.hs !== null
      ? Math.max(0, shots.home - old.hs) : 0;
    const awayShots = shots && old.as !== null
      ? Math.max(0, shots.away - old.as) : 0;
    const homeAttacks = attacks && old.ha !== null
      ? Math.max(0, attacks.home - old.ha) : 0;
    const awayAttacks = attacks && old.aa !== null
      ? Math.max(0, attacks.away - old.aa) : 0;

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
      difference: homeActivity - awayActivity,
      homePressureChange:
        pressure && old.ph !== null ? pressure.home - old.ph : 0,
      awayPressureChange:
        pressure && old.pa !== null ? pressure.away - old.pa : 0
    };
  }

  function calculateThreat(stats, snapshot, pressure, match) {
    const shots = statValue(stats, "shots on target");
    const attacks = statValue(stats, "dangerous attacks");

    if (!shots && !attacks) {
      return { home: null, away: null, level: "Nedostatok dát" };
    }

    const minute = parseInt(match.live_minute, 10) || 0;
    const homeScore = Number(match.home_score) || 0;
    const awayScore = Number(match.away_score) || 0;

    function score(side) {
      let value = 0;

      if (shots) value += Math.min(shots[side] * 10, 40);
      if (attacks) value += Math.min(attacks[side] * 0.8, 30);

      if (snapshot.ready) {
        value += Math.min(snapshot[side + "Activity"] * 2, 25);
      }

      if (pressure) {
        value += Math.max(0, pressure[side] - 50) * 0.2;
      }

      const team = side === "home" ? homeScore : awayScore;
      const opponent = side === "home" ? awayScore : homeScore;

      if (minute >= 60 && team <= opponent) value += 5;

      return Math.max(0, Math.min(100, Math.round(value)));
    }

    const home = score("home");
    const away = score("away");
    const highest = Math.max(home, away);

    let level = "Nízka";
    if (highest >= 35) level = "Stredná";
    if (highest >= 65) level = "Vysoká";

    return { home, away, level };
  }

  function makeSignal(match, snapshot, threat) {
    if (!snapshot.ready || threat.home === null) {
      return { text: "NO BET – čakám na dostatok dát", side: null };
    }

    const minute = parseInt(match.live_minute, 10) || 0;

    if (minute < 10 || minute > 90) {
      return { text: "NO BET – mimo hodnotiaceho okna", side: null };
    }

    const homeStrong =
      threat.home >= 65 &&
      snapshot.homeActivity >= 4 &&
      snapshot.difference >= 3;

    const awayStrong =
      threat.away >= 65 &&
      snapshot.awayActivity >= 4 &&
      snapshot.difference <= -3;

    if (homeStrong) {
      return {
        text: "SLEDOVAŤ DOMÁCICH – zvýšená útočná aktivita",
        side: "home"
      };
    }

    if (awayStrong) {
      return {
        text: "SLEDOVAŤ HOSTÍ – zvýšená útočná aktivita",
        side: "away"
      };
    }

    return { text: "NO BET – podmienky nesplnené", side: null };
  }

  function settleSignals(match) {
    const id = match.tracker?.id || match.url;
    const minute = parseInt(match.live_minute, 10);
    const homeGoals = Number(match.home_score) || 0;
    const awayGoals = Number(match.away_score) || 0;

    if (!Number.isFinite(minute)) return;

    let changed = false;

    signalHistory.forEach(s => {
      if (s.id !== id || s.status !== "OPEN") return;

      const teamGoals = s.side === "home" ? homeGoals : awayGoals;
      const scored = teamGoals > s.startGoals;

      if (scored && minute <= s.deadlineMinute + 1) {
        s.status = "WIN";
        s.settledAt = Date.now();
        s.result = "Tím skóroval v sledovanom okne.";
        changed = true;
      } else if (minute >= s.deadlineMinute + 1) {
        s.status = "LOSS";
        s.settledAt = Date.now();
        s.result = "Tím v sledovanom okne neskóroval.";
        changed = true;
      }
    });

    if (changed) saveData();
  }

  function recordSignal(match, signal, threat, snapshot) {
    if (!signal.side) return;

    const id = match.tracker?.id || match.url;
    const now = Date.now();
    const minute = parseInt(match.live_minute, 10);

    if (!Number.isFinite(minute)) return;

    const alreadyExists = signalHistory.some(s =>
      s.id === id &&
      s.side === signal.side &&
      now - s.time < 10 * 60000
    );

    if (alreadyExists) return;

    const startGoals = Number(
      signal.side === "home" ? match.home_score : match.away_score
    ) || 0;

    signalHistory.push({
      id,
      match: `${match.home} - ${match.away}`,
      score: `${match.home_score}:${match.away_score}`,
      side: signal.side,
      startGoals,
      startMinute: minute,
      deadlineMinute: minute + 10,
      threat: signal.side === "home" ? threat.home : threat.away,
      activity: signal.side === "home"
        ? snapshot.homeActivity : snapshot.awayActivity,
      time: now,
      status: "OPEN"
    });

    saveData();
  }

  async function getDetails(match) {
    const slug = slugFromUrl(match.url);
    if (!slug) throw new Error("Chýba identifikátor zápasu.");

    const response = await fetch(
      MATCH_API + encodeURIComponent(slug)
    );

    if (!response.ok) throw new Error("HTTP " + response.status);

    const data = await response.json();
    return data.match || data;
  }

  function addText(parent, text, size = "14px") {
    const p = document.createElement("p");
    p.textContent = text;
    p.style.cssText = `margin:7px 0;font-size:${size};`;
    parent.appendChild(p);
  }

  function render(results) {
    engine.replaceChildren();
    addText(engine, "SMART SIGNAL ENGINE v5", "18px");

    if (!results.length) {
      addText(engine, "Žiadne dostupné LIVE zápasy.");
    }

    results.forEach(result => {
      const match = result.match;
      const card = document.createElement("div");

      card.style.cssText =
        "padding:12px;margin-top:12px;background:#26364b;border-radius:9px;";

      addText(
        card,
        `${match.home} ${match.home_score ?? "-"} : ${match.away_score ?? "-"} ${match.away}`,
        "15px"
      );

      if (result.error) {
        addText(card, "Chyba detailu: " + result.error);
        engine.appendChild(card);
        return;
      }

      const stats = match.stats || [];
      const pressure = calculatePressure(stats);
      const id = match.tracker?.id || match.url;
      const snapshot = getSnapshot(id, stats, pressure);

      // Najprv vyhodnotíme už existujúce otvorené signály.
      settleSignals(match);

      const threat = calculateThreat(stats, snapshot, pressure, match);
      const signal = makeSignal(match, snapshot, threat);

      addText(card, `Minúta: ${match.live_minute || match.status_text || "LIVE"}`);

      if (pressure) {
        addText(card, `Pressure Score: ${pressure.home} : ${pressure.away}`);
      }

      const possession = statValue(stats, "possession");
      const shots = statValue(stats, "shots on target");
      const attacks = statValue(stats, "dangerous attacks");

      if (possession) addText(card, `Držanie lopty: ${possession.home} – ${possession.away}`);
      if (shots) addText(card, `Strely na bránu: ${shots.home} – ${shots.away}`);
      if (attacks) addText(card, `Nebezpečné útoky: ${attacks.home} – ${attacks.away}`);

      if (!snapshot.ready) {
        addText(card, snapshot.text);
      } else {
        addText(card, `Strely za 5+ min: ${snapshot.homeShots} – ${snapshot.awayShots}`);
        addText(card, `Nebezpečné útoky za 5+ min: ${snapshot.homeAttacks} – ${snapshot.awayAttacks}`);
        addText(card, `Útočná aktivita: ${snapshot.homeActivity} – ${snapshot.awayActivity}`);

        let momentum = "Vyrovnané momentum";
        if (snapshot.difference >= 3) momentum = "Rastúce momentum domácich";
        if (snapshot.difference <= -3) momentum = "Rastúce momentum hostí";

        addText(card, `Momentum: ${momentum}`);
      }

      if (threat.home === null) {
        addText(card, "Goal Threat: nedostatok údajov");
      } else {
        addText(card, `Gólová hrozba domácich: ${threat.home}/100`);
        addText(card, `Gólová hrozba hostí: ${threat.away}/100`);
        addText(card, `Úroveň hrozby: ${threat.level}`);
      }

      addText(card, `SMART SIGNAL: ${signal.text}`, "15px");
      recordSignal(match, signal, threat, snapshot);

      addText(
        card,
        "Experimentálny model. Signál nie je potvrdená stávková výhoda.",
        "12px"
      );

      engine.appendChild(card);
    });

    const wins = signalHistory.filter(s => s.status === "WIN").length;
    const losses = signalHistory.filter(s => s.status === "LOSS").length;
    const open = signalHistory.filter(s => s.status === "OPEN").length;
    const evaluated = wins + losses;
    const rate = evaluated ? Math.round(wins / evaluated * 100) : 0;

    addText(engine, `Signály: ${signalHistory.length}`);
    addText(engine, `Vyhodnotené: ${evaluated} | Otvorené: ${open}`);
    addText(engine, `Úspešné: ${wins} | Neúspešné: ${losses}`);
    addText(engine, `Úspešnosť: ${evaluated ? rate + "%" : "Zatiaľ bez vzorky"}`);
    addText(engine, "Vyhodnotenie sleduje gól označeného tímu do 10 minút od signálu. Nie je to BTTS ani ROI.");
  }

  async function scan() {
    if (scanning) return;
    scanning = true;

    try {
      const response = await fetch(API);
      if (!response.ok) throw new Error("HTTP " + response.status);

      const data = await response.json();
      const live = (data.matches || []).filter(
        m => String(m.status).toLowerCase() === "live"
      );

      matchesEl.replaceChildren();

      live.forEach(match => {
        const button = document.createElement("button");
        button.textContent =
          `${match.home} ${match.home_score ?? "-"} : ${match.away_score ?? "-"} ${match.away} · ${match.status_text || "LIVE"}`;

        button.style.cssText =
          "display:block;width:100%;padding:13px;margin:8px 0;background:#26364b;color:white;border:0;border-radius:9px;text-align:left";

        matchesEl.appendChild(button);
      });

      const results = await Promise.all(
        live.map(async match => {
          try {
            return { match: await getDetails(match) };
          } catch (e) {
            return { match, error: e.message };
          }
        })
      );

      render(results);
      signalEl.textContent =
        "Aktualizované: " + new Date().toLocaleTimeString("sk-SK");

    } catch (e) {
      signalEl.textContent = "Chyba načítania: " + e.message;
    } finally {
      scanning = false;
    }
  }

  scan();
  setInterval(scan, 60000);
})();

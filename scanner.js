(() => {
  const API = "https://sportscore.com/api/widget/matches/?sport=football&limit=50";
  const MATCH_API = "https://sportscore.com/api/widget/match/?sport=football&slug=";
  const STORAGE_KEY = "live_edge_history_v2";

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

  try {
    history = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    history = {};
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (e) {
      console.warn("Históriu sa nepodarilo uložiť", e);
    }
  }

  function slugFromUrl(url) {
    const parts = (url || "").split("/").filter(Boolean);
    return parts.length >= 4 ? parts[2] : "";
  }

  function statValue(stats, keyword) {
    const item = (stats || []).find(s =>
      String(s.label).toLowerCase().includes(keyword)
    );

    if (!item) return null;

    const home = Number(item.home);
    const away = Number(item.away);

    if (!Number.isFinite(home) || !Number.isFinite(away)) return null;

    return { home, away };
  }

  function calculatePressure(stats) {
    const measures = [
      { key: "possession", weight: 0.15 },
      { key: "shots on target", weight: 0.35 },
      { key: "dangerous attacks", weight: 0.50 }
    ];

    let home = 0;
    let away = 0;
    let weight = 0;

    measures.forEach(m => {
      const v = statValue(stats, m.key);
      if (!v) return;

      const total = v.home + v.away;
      const h = total ? v.home / total : 0.5;

      home += h * m.weight;
      away += (1 - h) * m.weight;
      weight += m.weight;
    });

    if (!weight) return null;

    return {
      home: Math.round(home / weight * 100),
      away: Math.round(away / weight * 100)
    };
  }

  function momentum(id, stats) {
    const now = Date.now();

    if (!history[id]) history[id] = [];

    const shots = statValue(stats, "shots on target");
    const attacks = statValue(stats, "dangerous attacks");

    const current = {
      time: now,
      hs: shots?.home ?? null,
      as: shots?.away ?? null,
      ha: attacks?.home ?? null,
      aa: attacks?.away ?? null
    };

    const records = history[id];

    // Záznam ukladáme iba pri novej zmene alebo po minúte.
    const last = records[records.length - 1];

    if (!last || now - last.time >= 60000) {
      records.push(current);
    }

    // Uchovávame maximálne 24 hodín.
    history[id] = records.filter(r => now - r.time <= 86400000).slice(-150);

    const old = [...history[id]].reverse().find(
      r => now - r.time >= 5 * 60000
    );

    saveHistory();

    if (!old) {
      return {
        ready: false,
        text: "Zbieram dáta – potrebných je 5 minút."
      };
    }

    let home = 0;
    let away = 0;
    let count = 0;

    if (shots && old.hs !== null && old.as !== null) {
      home += Math.max(0, shots.home - old.hs) * 2;
      away += Math.max(0, shots.away - old.as) * 2;
      count++;
    }

    if (attacks && old.ha !== null && old.aa !== null) {
      home += Math.max(0, attacks.home - old.ha);
      away += Math.max(0, attacks.away - old.aa);
      count++;
    }

    if (!count) {
      return { ready: false, text: "Nedostatok historických štatistík." };
    }

    const diff = home - away;

    let text = "Vyrovnané momentum";

    if (diff >= 2) text = "Rastúce momentum domácich";
    if (diff <= -2) text = "Rastúce momentum hostí";

    if (home === 0 && away === 0) {
      text = "Bez zaznamenanej zmeny";
    }

    return {
      ready: true,
      home,
      away,
      diff,
      text
    };
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
    addText(engine, "AI PRESSURE + MOMENTUM ENGINE v2", "18px");

    if (!results.length) {
      addText(engine, "Žiadne dostupné LIVE zápasy.");
      return;
    }

    results.forEach(result => {
      const match = result.match;
      const stats = match.stats || [];
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

      const pressure = calculatePressure(stats);
      const id = match.tracker?.id || match.url;
      const mom = momentum(id, stats);

      addText(card, `Minúta: ${match.live_minute || match.status_text || "LIVE"}`);

      if (pressure) {
        addText(card, `Tlak domácich: ${pressure.home}/100`);
        addText(card, `Tlak hostí: ${pressure.away}/100`);
      } else {
        addText(card, "Pressure Score: nedostatok údajov");
      }

      const s = statValue(stats, "shots on target");
      const a = statValue(stats, "dangerous attacks");
      const p = statValue(stats, "possession");

      if (p) addText(card, `Držanie lopty: ${p.home} – ${p.away}`);
      if (s) addText(card, `Strely na bránu: ${s.home} – ${s.away}`);
      if (a) addText(card, `Nebezpečné útoky: ${a.home} – ${a.away}`);

      addText(card, `Momentum: ${mom.text}`);

      if (mom.ready) {
        addText(card, `Zmena za 5+ minút – domáci: ${mom.home}, hostia: ${mom.away}`);
      }

      let signal = "NO BET – bez potvrdeného momenta";

      if (pressure && mom.ready) {
        if (pressure.home >= 65 && mom.diff >= 2) {
          signal = "TLAK DOMÁCICH – sledovať";
        } else if (pressure.away >= 65 && mom.diff <= -2) {
          signal = "TLAK HOSTÍ – sledovať";
        }
      }

      addText(card, `LIVE stav: ${signal}`, "15px");
      addText(card, "Heuristické hodnotenie, nie overená predikcia zisku.", "12px");

      engine.appendChild(card);
    });
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

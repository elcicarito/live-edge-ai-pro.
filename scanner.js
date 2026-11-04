(() => {
  const API = "https://sportscore.com/api/widget/matches/?sport=football&limit=50";
  const MATCH_API = "https://sportscore.com/api/widget/match/?sport=football&slug=";

  const matchesEl = document.getElementById("matches");
  const signalEl = document.getElementById("signal");

  if (!matchesEl || !signalEl) {
    console.error("LIVE EDGE: Chýbajú HTML elementy.");
    return;
  }

  // Vytvorenie panelu AI Engine
  let engine = document.getElementById("pressure-engine");

  if (!engine) {
    engine = document.createElement("div");
    engine.id = "pressure-engine";
    signalEl.insertAdjacentElement("afterend", engine);
  }

  engine.style.cssText =
    "margin-top:15px;padding:14px;background:#172438;color:white;border-radius:12px;";

  const history = new Map();
  let scanning = false;

  function slugFromUrl(url) {
    const parts = (url || "").split("/").filter(Boolean);
    return parts.length >= 4 ? parts[2] : "";
  }

  function statValue(stats, keyword) {
    const item = stats.find(s =>
      String(s.label).toLowerCase().includes(keyword)
    );

    if (!item) return null;

    const value = Number(item.home);
    const away = Number(item.away);

    if (!Number.isFinite(value) || !Number.isFinite(away)) {
      return null;
    }

    return { home: value, away };
  }

  function share(a, b) {
    const total = a + b;
    return total > 0 ? a / total : 0.5;
  }

  function calculatePressure(stats) {
    const measures = [
      { key: "possession", weight: 0.15 },
      { key: "shots on target", weight: 0.35 },
      { key: "dangerous attacks", weight: 0.50 }
    ];

    let home = 0;
    let away = 0;
    let totalWeight = 0;

    for (const measure of measures) {
      const values = statValue(stats, measure.key);
      if (!values) continue;

      home += share(values.home, values.away) * measure.weight;
      away += share(values.away, values.home) * measure.weight;
      totalWeight += measure.weight;
    }

    if (!totalWeight) return null;

    return {
      home: Math.round(home / totalWeight * 100),
      away: Math.round(away / totalWeight * 100)
    };
  }

  function getMomentum(id, stats) {
    const shots = statValue(stats, "shots on target");
    const attacks = statValue(stats, "dangerous attacks");

    if (!history.has(id)) history.set(id, []);

    const records = history.get(id);
    const now = Date.now();

    records.push({
      time: now,
      homeShots: shots?.home ?? null,
      awayShots: shots?.away ?? null,
      homeAttacks: attacks?.home ?? null,
      awayAttacks: attacks?.away ?? null
    });

    // Uchovávame posledných 10 meraní
    while (records.length > 10) records.shift();

    // Hľadáme meranie staré aspoň 4 minúty
    const old = [...records].reverse().find(
      r => now - r.time >= 4 * 60 * 1000
    );

    if (!old) return {
      ready: false,
      text: "Zbieram dáta – čakaj približne 5 minút."
    };

    let homeChange = 0;
    let awayChange = 0;
    let available = 0;

    if (shots && old.homeShots !== null) {
      homeChange += Math.max(0, shots.home - old.homeShots) * 2;
      awayChange += Math.max(0, shots.away - old.awayShots) * 2;
      available++;
    }

    if (attacks && old.homeAttacks !== null) {
      homeChange += Math.max(0, attacks.home - old.homeAttacks);
      awayChange += Math.max(0, attacks.away - old.awayAttacks);
      available++;
    }

    if (!available) {
      return { ready: false, text: "Momentum nemá dostatok údajov." };
    }

    const difference = homeChange - awayChange;

    let text = "Vyrovnané momentum";

    if (difference >= 2) text = "Momentum domácich";
    if (difference <= -2) text = "Momentum hostí";

    return {
      ready: true,
      difference,
      text
    };
  }

  async function getDetails(match) {
    const slug = slugFromUrl(match.url);

    if (!slug) throw new Error("Chýba identifikátor zápasu.");

    const response = await fetch(
      MATCH_API + encodeURIComponent(slug)
    );

    if (!response.ok) throw new Error("Detail HTTP " + response.status);

    const data = await response.json();

    return data.match || data;
  }

  function addText(parent, text, size = "14px") {
    const p = document.createElement("p");
    p.textContent = text;
    p.style.cssText = `margin:7px 0;font-size:${size};`;
    parent.appendChild(p);
  }

  function renderEngine(results) {
    engine.replaceChildren();

    addText(engine, "AI PRESSURE ENGINE v1", "18px");

    if (!results.length) {
      addText(engine, "Momentálne nie sú dostupné LIVE zápasy.");
      return;
    }

    results.forEach(result => {
      const card = document.createElement("div");
      card.style.cssText =
        "padding:12px;margin-top:12px;background:#26364b;border-radius:9px;";

      const match = result.match;
      const stats = match.stats || [];
      const pressure = calculatePressure(stats);

      addText(
        card,
        `${match.home} ${match.home_score ?? "-"} : ${match.away_score ?? "-"} ${match.away}`,
        "15px"
      );

      addText(card, `Minúta: ${match.live_minute || match.status_text || "LIVE"}`);

      if (!pressure) {
        addText(card, "Pressure Score: nedostatok štatistík");
        engine.appendChild(card);
        return;
      }

      addText(card, `Tlak domácich: ${pressure.home}/100`);
      addText(card, `Tlak hostí: ${pressure.away}/100`);

      for (const key of [
        "possession",
        "shots on target",
        "dangerous attacks"
      ]) {
        const value = statValue(stats, key);
        if (!value) continue;

        const label = key === "possession"
          ? "Držanie lopty"
          : key === "shots on target"
            ? "Strely na bránu"
            : "Nebezpečné útoky";

        addText(card, `${label}: ${value.home} – ${value.away}`);
      }

      const momentum = getMomentum(
        match.tracker?.id || match.url,
        stats
      );

      addText(card, `Momentum: ${momentum.text}`);

      let signal = "NO BET – zatiaľ bez potvrdeného tlaku";

      if (momentum.ready && pressure.home >= 65 &&
          momentum.difference >= 2) {
        signal = "TLAK DOMÁCICH – sledovať";
      } else if (momentum.ready && pressure.away >= 65 &&
                 momentum.difference <= -2) {
        signal = "TLAK HOSTÍ – sledovať";
      } else if (!momentum.ready) {
        signal = "NO BET – čakám na Momentum";
      }

      addText(card, `LIVE stav: ${signal}`, "15px");
      addText(card, "Upozornenie: bez overených kurzov nejde o stávkový tip.", "12px");

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

      if (!live.length) {
        addText(matchesEl, "Momentálne nie sú dostupné LIVE zápasy.");
      }

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
          } catch (error) {
            return { match, error: error.message };
          }
        })
      );

      const valid = results.filter(r => !r.error);
      renderEngine(valid);

      signalEl.textContent = results.some(r => r.error)
        ? "Niektoré detaily zápasov sa nepodarilo načítať."
        : `Aktualizované: ${new Date().toLocaleTimeString("sk-SK")}`;

      results.filter(r => r.error).forEach(r => {
        addText(engine, `${r.match.home} – chyba: ${r.error}`);
      });

    } catch (error) {
      signalEl.textContent = "Chyba načítania: " + error.message;
    } finally {
      scanning = false;
    }
  }

  scan();
  setInterval(scan, 60000);
})();

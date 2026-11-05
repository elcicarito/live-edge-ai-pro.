(() => {
  const DATA_URL = "./data/basketball-current.json";
  const root = document.getElementById("basketball-view");
  const list = document.getElementById("basketball-matches");
  const meta = document.getElementById("basketball-meta");
  if (!root || !list || !meta) return;

  const textOf = (...values) => {
    for (const value of values) {
      if (value === undefined || value === null || value === "") continue;
      if (typeof value === "object") {
        if (value.name) return String(value.name);
        if (value.title) return String(value.title);
        if (value.short_name) return String(value.short_name);
      } else {
        return String(value);
      }
    }
    return "";
  };

  const statusOf = match => {
    const status = match?.status;
    if (typeof status === "string") return status;
    if (status && typeof status === "object") {
      return status.type || status.name || status.short || status.description || "";
    }
    return match?.status_text || match?.statusText || "";
  };

  const teamName = (match, side) => {
    const team = match?.teams?.[side] || match?.[side + "_team"] || match?.[side + "Team"];
    return textOf(team?.name, team?.short_name, team, match?.[side], match?.[side + "_name"]) || (side === "home" ? "Domáci" : "Hostia");
  };

  const scoreOf = (match, side) => {
    const score = match?.score || match?.scores || {};
    const teamScore = score?.[side];
    return textOf(
      typeof teamScore === "object" ? teamScore.current ?? teamScore.total ?? teamScore.points : teamScore,
      match?.[side + "_score"],
      match?.[side + "Score"],
      match?.[side + "_points"]
    ) || "–";
  };

  const isLive = match => {
    const s = String(statusOf(match)).toLowerCase().replace(/[\\s_-]+/g, "");
    return ["live","inplay","inprogress","playing","q1","q2","q3","q4","ot","overtime","halftime","break","period1","period2","period3","period4"].includes(s) || s.includes("inprogress") || s.includes("live");
  };

  function render(data) {
    if (!data || data.sport !== "basketball") {
      meta.textContent = "Basketbalové dáta zatiaľ nie sú dostupné.";
      list.textContent = "Čakám na prvý úspešný zber basketbalu.";
      return;
    }

    const collected = Date.parse(data.collected_at || "");
    const ageSeconds = Number.isFinite(collected) ? Math.max(0, Math.round((Date.now() - collected) / 1000)) : null;
    const live = Array.isArray(data.live_matches) ? data.live_matches : (Array.isArray(data.matches) ? data.matches.filter(isLive) : []);
    const allCount = Number(data.fixture_count ?? data.matches?.length ?? 0);

    meta.textContent = "Zdroj: SportScore · Posledný zber: " +
      (data.collected_at ? new Date(data.collected_at).toLocaleString("sk-SK") : "neznámy") +
      " · Vek dát: " + (ageSeconds === null ? "neznámy" : ageSeconds + " s") +
      " · LIVE zápasy: " + live.length + " · Záznamy API: " + allCount;

    list.innerHTML = "";
    if (!live.length) {
      const note = document.createElement("p");
      note.textContent = allCount
        ? "API vrátilo " + allCount + " basketbalových záznamov, ale ich stav zatiaľ neviem bezpečne označiť ako LIVE. Overujeme formát dát."
        : "Momentálne API nevrátilo žiadny basketbalový LIVE zápas.";
      list.appendChild(note);
      return;
    }

    live.forEach(match => {
      const card = document.createElement("div");
      card.style.cssText = "background:#101b2b;border:1px solid #2d435c;border-radius:12px;padding:14px;margin:10px 0";
      const league = textOf(match?.competition?.name, match?.league?.name, match?.tournament?.name, match?.competition, match?.league);
      const status = textOf(statusOf(match)) || "LIVE";
      const period = textOf(match?.period?.name, match?.period, match?.quarter, match?.period_name, match?.status_text);
      const clock = textOf(match?.clock, match?.time_remaining, match?.remaining_time, match?.timer);
      const header = document.createElement("div");
      header.style.cssText = "color:#39e6a5;font-size:12px;font-weight:bold;margin-bottom:10px";
      header.textContent = [league, status, period, clock].filter(Boolean).join(" · ");
      const row = document.createElement("div");
      row.style.cssText = "display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;margin:6px 0";
      const names = document.createElement("div");
      names.style.cssText = "font-weight:700;line-height:1.5";
      names.textContent = teamName(match, "home") + "\n" + teamName(match, "away");
      names.style.whiteSpace = "pre-line";
      const scores = document.createElement("div");
      scores.style.cssText = "font-size:20px;font-weight:800;text-align:right;line-height:1.5;font-variant-numeric:tabular-nums";
      scores.textContent = scoreOf(match, "home") + "\n" + scoreOf(match, "away");
      scores.style.whiteSpace = "pre-line";
      row.append(names, scores);
      card.append(header, row);
      list.appendChild(card);
    });
  }

  async function load() {
    try {
      const response = await fetch(DATA_URL + "?t=" + Date.now(), {cache:"no-store"});
      if (!response.ok) throw new Error("HTTP " + response.status);
      render(await response.json());
    } catch (error) {
      meta.textContent = "Basketbalový zberač čaká na prvé dáta.";
      list.textContent = "Zatiaľ sa nepodarilo načítať basketbalové dáta: " + error.message;
    }
  }

  load();
  setInterval(load, 10000);
})();
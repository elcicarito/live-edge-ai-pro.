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
        const nested = value.name || value.title || value.short_name;
        if (nested) return String(nested);
        continue;
      }
      return String(value);
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

  const isLive = match => {
    const s = String(statusOf(match)).toLowerCase().replace(/[\\s_-]+/g, "");
    return ["live","inplay","inprogress","playing","q1","q2","q3","q4","ot","overtime","halftime","break","period1","period2","period3","period4"].includes(s) || s.includes("inprogress") || s.includes("live");
  };

  const teamName = (match, side) => {
    const team = match?.teams?.[side] || match?.[side + "_team"] || match?.[side + "Team"];
    return textOf(team?.name, team?.short_name, typeof team === "string" ? team : null, match?.[side], match?.[side + "_name"]) || (side === "home" ? "Domáci" : "Hostia");
  };

  const scoreOf = (match, side) => {
    const score = match?.score || match?.scores || {};
    const teamScore = score?.[side];
    return textOf(typeof teamScore === "object" ? teamScore.current ?? teamScore.total ?? teamScore.points : teamScore, match?.[side + "_score"], match?.[side + "Score"], match?.[side + "_points"]) || "–";
  };

  function render(data) {
    if (!data || data.sport !== "basketball") {
      meta.textContent = "Basketbalové dáta zatiaľ nie sú dostupné.";
      list.textContent = "Zatiaľ sa nepodarilo načítať prvý zber. Skús obnoviť stránku o chvíľu.";
      return;
    }

    const collected = Date.parse(data.collected_at || "");
    const ageSeconds = Number.isFinite(collected) ? Math.max(0, Math.round((Date.now() - collected) / 1000)) : null;
    const all = Array.isArray(data.matches) ? data.matches : [];
    const live = Array.isArray(data.live_matches) ? data.live_matches : all.filter(isLive);
    const allCount = Number(data.fixture_count ?? all.length ?? 0);
    const finishedCount = all.filter(m => String(statusOf(m)).toLowerCase().includes("finish")).length;
    const ageText = ageSeconds === null ? "neznámy" : ageSeconds < 60 ? ageSeconds + " s" : Math.floor(ageSeconds / 60) + " min";
    meta.textContent = "Zdroj: SportScore · Posledný zber: " +
      (data.collected_at ? new Date(data.collected_at).toLocaleString("sk-SK") : "neznámy") +
      " · Vek dát: " + ageText + " · LIVE: " + live.length + " · Záznamy API: " + allCount;

    list.replaceChildren();
    if (!live.length) {
      const note = document.createElement("div");
      note.style.cssText = "padding:14px;background:#101b2b;border:1px solid #35465e;border-radius:10px;line-height:1.6";
      const heading = document.createElement("strong");
      heading.textContent = "Momentálne sa nenašiel žiadny LIVE basketbalový zápas.";
      const detail = document.createElement("p");
      detail.style.cssText = "margin:8px 0 0;color:#c5d2e2";
      detail.textContent = allCount
        ? "Zberač načítal " + allCount + " zápasov; " + finishedCount + " z nich má stav Finished. Nezobrazujeme ich ako LIVE, aby sa nemýlili ukončené zápasy s prebiehajúcimi."
        : "Zdroj momentálne neposlal žiadne zápasy.";
      const freshness = document.createElement("p");
      freshness.style.cssText = "margin:8px 0 0;color:#9baabe;font-size:12px";
      freshness.textContent = ageSeconds !== null && ageSeconds > 900
        ? "Pozor: posledný úspešný zber je starší ako 15 minút."
        : "Sekcia sa automaticky obnovuje každých 10 sekúnd; zber dát prebieha samostatne.";
      note.append(heading, detail, freshness);
      list.appendChild(note);
      return;
    }

    live.forEach(match => {
      const card = document.createElement("div");
      card.style.cssText = "background:#101b2b;border:1px solid #2d435c;border-radius:12px;padding:14px;margin:10px 0";
      const league = textOf(match?.competition?.name, match?.league?.name, match?.tournament?.name, typeof match?.competition === "string" ? match.competition : null, typeof match?.league === "string" ? match.league : null);
      const status = textOf(statusOf(match)) || "LIVE";
      const period = textOf(match?.period?.name, match?.period, match?.quarter, match?.period_name, match?.status_text);
      const clock = textOf(match?.clock, match?.time_remaining, match?.remaining_time, match?.timer);
      const header = document.createElement("div");
      header.style.cssText = "color:#39e6a5;font-size:12px;font-weight:bold;margin-bottom:10px";
      header.textContent = [league, status, period, clock].filter(Boolean).join(" · ");
      const row = document.createElement("div");
      row.style.cssText = "display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;margin:6px 0";
      const names = document.createElement("div");
      names.style.cssText = "font-weight:700;line-height:1.5;white-space:pre-line";
      names.textContent = teamName(match, "home") + "\\n" + teamName(match, "away");
      const scores = document.createElement("div");
      scores.style.cssText = "font-size:20px;font-weight:800;text-align:right;line-height:1.5;font-variant-numeric:tabular-nums;white-space:pre-line";
      scores.textContent = scoreOf(match, "home") + "\\n" + scoreOf(match, "away");
      row.append(names, scores);
      card.append(header, row);
      list.appendChild(card);
    });
  }

  async function load() {
    try {
      const response = await fetch(DATA_URL + "?v=2&t=" + Date.now(), {cache:"no-store"});
      if (!response.ok) throw new Error("HTTP " + response.status);
      render(await response.json());
    } catch (error) {
      meta.textContent = "Basketbalové dáta sa nepodarilo načítať.";
      list.textContent = "Chyba načítania: " + error.message + ". Skús obnoviť stránku.";
    }
  }

  load();
  setInterval(load, 10000);
})();

(() => {
  const API = "https://sportscore.com/api/v1/fixtures/?sport=football&status=live&limit=200";
  const MATCH_API = "https://sportscore.com/api/widget/match/?sport=football&slug=";

  const matchesEl = document.getElementById("matches");
  const signalEl = document.getElementById("signal");

  let selectedMatch = null;

  function getMatches(data) {
    if (Array.isArray(data)) return data;
    for (const key of ["matches", "fixtures", "data", "results"]) {
      if (Array.isArray(data?.[key])) return data[key];
    }
    return [];
  }

  function getName(team) {
    if (typeof team === "string") return team;
    return team?.name || team?.title || "Neznámy tím";
  }

  function getScore(match) {
    const home = match.home_score ?? match.homeScore ?? match.score?.home ?? match.home?.score ?? "?";
    const away = match.away_score ?? match.awayScore ?? match.score?.away ?? match.away?.score ?? "?";
    return `${home} : ${away}`;
  }

  function getSlug(match) {
    return match.slug || match.match_slug || match.url_slug || "";
  }

  function getMinute(match) {
    return match.minute ?? match.elapsed ?? match.time?.elapsed ?? match.status?.minute ?? "LIVE";
  }

  function renderMatches(matches) {
    if (!matchesEl) return;

    if (!matches.length) {
      matchesEl.textContent = "Momentálne sa nenašli dostupné LIVE zápasy.";
      return;
    }

    matchesEl.replaceChildren();

    matches.forEach((match, index) => {
      const home = getName(match.home || match.home_team);
      const away = getName(match.away || match.away_team);
      const button = document.createElement("button");

      button.textContent = `${home} ${getScore(match)} ${away} · ${getMinute(match)}'`;
      button.style.cssText = "display:block;margin:8px 0;padding:12px;background:#26364b;color:white;border:0;border-radius:8px;width:100%;text-align:left";

      button.addEventListener("click", () => {
        selectedMatch = match;
        loadMatchDetails(match);
      });

      matchesEl.appendChild(button);
    });
  }

  function findStats(data) {
    if (!data || typeof data !== "object") return {};
    if (data.stats && !Array.isArray(data.stats)) return data.stats;
    if (data.statistics && !Array.isArray(data.statistics)) return data.statistics;
    if (data.match?.stats) return data.match.stats;
    if (data.match?.statistics) return data.match.statistics;
    return {};
  }

  function findNumber(stats, terms) {
    const entries = Object.entries(stats || {});
    for (const [key, value] of entries) {
      const name = key.toLowerCase().replace(/[_\s-]/g, "");
      if (terms.some(term => name.includes(term)) && typeof value === "number") {
        return value;
      }
    }
    return null;
  }

  function pressureScore(stats) {
    const attacksHome = findNumber(stats, ["dangerousattackshome", "home_dangerous_attacks"]);
    const attacksAway = findNumber(stats, ["dangerousattacksaway", "away_dangerous_attacks"]);
    const shotsHome = findNumber(stats, ["shotsongoalhome", "home_shots_on_target"]);
    const shotsAway = findNumber(stats, ["shotsongoalaway", "away_shots_on_target"]);

    if ([attacksHome, attacksAway, shotsHome, shotsAway].every(v => v === null)) {
      return "Štatistiky tlaku zatiaľ nie sú dostupné.";
    }

    const home = Math.min(100, Math.round(
      (attacksHome || 0) * 0.35 + (shotsHome || 0) * 5
    ));
    const away = Math.min(100, Math.round(
      (attacksAway || 0) * 0.35 + (shotsAway || 0) * 5
    ));

    return `Domáci: ${home}/100 · Hostia: ${away}/100. Experimentálne skóre, nie pravdepodobnosť gólu.`;
  }

  async function loadMatchDetails(match) {
    const slug = getSlug(match);

    if (!slug) {
      signalEl.textContent = "Zápas nemá dostupný identifikátor na načítanie detailov.";
      return;
    }

    signalEl.textContent = "Načítavam štatistiky zápasu…";

    try {
      const response = await fetch(MATCH_API + encodeURIComponent(slug));
      if (!response.ok) throw new Error("HTTP " + response.status);

      const data = await response.json();
      const stats = findStats(data);

      signalEl.textContent = pressureScore(stats);
    } catch (error) {
      signalEl.textContent = "Štatistiky sa nepodarilo načítať. Skús neskôr.";
      console.error("LIVE EDGE detail error:", error);
    }
  }

  async function scan() {
    if (!matchesEl) return;

    matchesEl.textContent = "Načítavam LIVE zápasy…";

    try {
      const response = await fetch(API);
      if (!response.ok) throw new Error("HTTP " + response.status);

      const data = await response.json();
      renderMatches(getMatches(data));
    } catch (error) {
      matchesEl.textContent = "Nepodarilo sa načítať LIVE zápasy. Skontroluj pripojenie alebo dostupnosť zdroja.";
      console.error("LIVE EDGE scanner error:", error);
    }
  }

  window.LIVE_EDGE_SCAN = scan;
  scan();
  setInterval(scan, 60000);
})();

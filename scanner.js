(() => {
  const API =
    "https://sportscore.com/api/widget/matches/?sport=football&limit=50";

  const MATCH_API =
    "https://sportscore.com/api/widget/match/?sport=football&slug=";

  const matchesEl = document.getElementById("matches");
  const signalEl = document.getElementById("signal");

  function getMinute(match) {
    return match.minute ??
      match.elapsed ??
      match.status_text ??
      "LIVE";
  }

  function getSlug(match) {
    const parts = (match.url || "").split("/").filter(Boolean);
    return parts.length >= 3 ? parts[2] : "";
  }

  function renderMatches(matches) {
    matchesEl.replaceChildren();

    const live = matches.filter(
      match => String(match.status).toLowerCase() === "live"
    );

    if (!live.length) {
      matchesEl.textContent =
        "Momentálne nie sú dostupné LIVE zápasy.";
      return;
    }

    live.forEach(match => {
      const button = document.createElement("button");

      button.textContent =
        `${match.home} ${match.home_score ?? "-"} : ${match.away_score ?? "-"} ${match.away} · ${getMinute(match)}`;

      button.style.cssText =
        "display:block;width:100%;padding:13px;margin:8px 0;background:#26364b;color:white;border:0;border-radius:9px;text-align:left";

      button.addEventListener("click", () => loadDetails(match));
      matchesEl.appendChild(button);
    });
  }

  async function loadDetails(match) {
    const slug = getSlug(match);

    if (!slug) {
      signalEl.textContent = "Identifikátor zápasu nie je dostupný.";
      return;
    }

    signalEl.textContent = "Načítavam štatistiky zápasu…";

    try {
      const response = await fetch(
        MATCH_API + encodeURIComponent(slug)
      );

      if (!response.ok) throw new Error("HTTP " + response.status);

      const data = await response.json();

      signalEl.textContent =
        "Detail zápasu načítaný. Štruktúru štatistík ešte overujeme.";

      console.log("LIVE EDGE MATCH DATA:", data);
    } catch (error) {
      signalEl.textContent = "Detail sa nepodarilo načítať.";
      console.error(error);
    }
  }

  async function scan() {
    matchesEl.textContent = "Načítavam živé zápasy…";

    try {
      const response = await fetch(API);

      if (!response.ok) throw new Error("HTTP " + response.status);

      const data = await response.json();
      renderMatches(Array.isArray(data.matches) ? data.matches : []);
    } catch (error) {
      matchesEl.textContent =
        "Chyba načítania SportScore. Skús obnoviť aplikáciu.";
      console.error(error);
    }
  }

  window.LIVE_EDGE_SCAN = scan;

  scan();
  setInterval(scan, 60000);
})();

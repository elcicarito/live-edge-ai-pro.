"use strict";
(() => {
  const ROOT = "https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./";
  const URLS = {
    btts: ROOT + "live-data-v2/data/flashscore-btts-signal-archive.json",
    model: ROOT + "live-data-v2/data/ai-edge-live-model.json",
    late: ROOT + "live-data-v2/data/ai-edge-live-late-ft-model.json",
    corners: ROOT + "live-data-v2/data/ai-edge-live-corners-under-model.json",
    cards: ROOT + "live-data-v2/data/ai-edge-live-cards-under-model.json",
    ledger: ROOT + "live-data-v2/data/ai-edge-prediction-live.json"
  };
  const target = document.getElementById("football-model-performance-center-content");
  if (!target) return;

  const number = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString("sk-SK") : "—";
  const percent = value => Number.isFinite(Number(value)) ? (Number(value) * 100).toFixed(1) + " %" : "—";
  const time = value => {
    const date = new Date(value || "");
    return Number.isNaN(date.getTime()) ? "čas nedostupný" : date.toLocaleString("sk-SK");
  };
  async function read(url) {
    const response = await fetch(url + "?t=" + Date.now(), { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }
  function addCard(grid, title, status, detail, tone) {
    const card = document.createElement("div");
    card.style.cssText = "min-width:0;padding:12px;border:1px solid #344b65;border-radius:10px;background:#101b2b;";
    const heading = document.createElement("div");
    heading.textContent = title;
    heading.style.cssText = "font-size:10px;font-weight:900;letter-spacing:.35px;color:#aebed0;margin-bottom:7px;";
    const value = document.createElement("div");
    value.textContent = status;
    value.style.cssText = "font-size:17px;font-weight:900;line-height:1.25;color:" + (tone || "#e2e8f0") + ";overflow-wrap:anywhere;";
    const note = document.createElement("div");
    note.textContent = detail;
    note.style.cssText = "font-size:10px;line-height:1.5;color:#94a3b8;margin-top:6px;overflow-wrap:anywhere;";
    card.append(heading, value, note);
    grid.appendChild(card);
  }
  function signalStats(archive) {
    const rows = Array.isArray(archive?.signals) ? archive.signals : [];
    const counts = { WIN: 0, LOSS: 0, OPEN: 0, UNRESOLVED: 0 };
    rows.forEach(row => { if (Object.prototype.hasOwnProperty.call(counts, row?.status)) counts[row.status]++; });
    const byMatch = new Map();
    rows.forEach((row, index) => {
      const id = row?.matchId == null || String(row.matchId).trim() === "" ? "missing-" + index : String(row.matchId);
      const old = byMatch.get(id);
      const stamp = Date.parse(row?.createdAt || "");
      const oldStamp = Date.parse(old?.createdAt || "");
      if (!old || (Number.isFinite(stamp) && (!Number.isFinite(oldStamp) || stamp < oldStamp))) byMatch.set(id, row);
    });
    const first = [...byMatch.values()];
    const unique = { WIN: 0, LOSS: 0, OPEN: 0, UNRESOLVED: 0 };
    first.forEach(row => { if (Object.prototype.hasOwnProperty.call(unique, row?.status)) unique[row.status]++; });
    const decided = counts.WIN + counts.LOSS;
    const uniqueDecided = unique.WIN + unique.LOSS;
    return {
      total: rows.length, counts, uniqueMatches: byMatch.size, unique,
      rate: decided ? Math.round(counts.WIN / decided * 100) + " %" : "—",
      uniqueRate: uniqueDecided ? Math.round(unique.WIN / uniqueDecided * 100) + " %" : "—"
    };
  }
  function renderModel(grid, model, horizon) {
    const item = model?.models?.[String(horizon)];
    if (!item) {
      addCard(grid, "AI EDGE · " + horizon + " MIN", "DÁTA NEDOSTUPNÉ", "Modelový súbor neobsahuje tento horizont.", "#fbbf24");
      return;
    }
    const counts = item.counts || {};
    const metrics = item.metrics || {};
    const status = item.status === "SHADOW_VALIDATED" ? "SHADOW VALIDATED" :
      item.status === "NOT_VALIDATED" ? "NEVALIDOVANÝ" : "ZBIERA VZORKY";
    const tone = item.status === "SHADOW_VALIDATED" ? "#60a5fa" :
      item.status === "NOT_VALIDATED" ? "#fbbf24" : "#cbd5e1";
    const policy = model.validation_policy || {};
    const calibration = metrics.calibration || {};
    const detail = "Tréning: " + number(counts.train) + " vzoriek / " + number(counts.train_matches) + " zápasov · validácia: " +
      number(counts.validation) + " vzoriek / " + number(counts.validation_matches) + " zápasov. " +
      "Presnosť: " + percent(metrics.accuracy) + " · Brier: " + number(metrics.brier) +
      " (základ " + number(metrics.baseline_brier) + ") · log-loss: " + number(metrics.log_loss) +
      " (základ " + number(metrics.baseline_log_loss) + "). " +
      "Zlepšenie: log-loss " + percent(metrics.relative_log_loss_gain) + " · Brier " + percent(metrics.relative_brier_gain) +
      ". Kalibrácia: ECE " + number(calibration.expected_calibration_error) + " · obsadené pásma " + number(calibration.populated_bins) +
      " · najväčšia odchýlka " + number(calibration.maximum_calibration_error) +
      ". Požiadavka: min. " + number(policy.min_validation_matches || 50) + " validačných zápasov.";
    addCard(grid, "AI EDGE · " + horizon + " MIN", status, detail, tone);
  }
  function renderLedgerTarget(grid, ledger, key) {
    const item = ledger?.by_target?.[key];
    if (!item) {
      addCard(grid, "PREDIKCIA · " + key, "ZÁZNAMY NEDOSTUPNÉ", "Pre tento typ predikcie nie sú dostupné súhrnné výsledky.", "#fbbf24");
      return;
    }
    const decided = Number(item.decided || 0);
    const rate = decided ? percent(item.accuracy) : "—";
    const match = item.match_level || {};
    const matchDecided = Number(match.decided || 0);
    const matchRate = matchDecided ? percent(match.accuracy) : "—";
    addCard(grid, item.label || ("PREDIKCIA · " + key),
      "ZÁPASY " + matchRate,
      "Unikátne zápasy: " + number(match.total) + " · HIT " + number(match.HIT) +
      " / MISS " + number(match.MISS) + " · OPEN " + number(match.OPEN) +
      " · nevyhodnotiteľné " + number(match.UNRESOLVED) +
      ". Predikčné záznamy: " + rate + " · HIT " + number(item.HIT) +
      " / MISS " + number(item.MISS) + " · vyhodnotené " + number(decided) +
      " / spolu " + number(item.total) +
      ". Zápasová metrika používa iba prvú predikciu každého zápasu pre daný cieľ.",
      "#60a5fa");
  }
  function renderLate(grid, late) {
    if (!late) {
      addCard(grid, "GÓL 70–85′ → KONIEC", "DÁTA NEDOSTUPNÉ", "Samostatný tréningový súbor sa nepodarilo načítať.", "#fbbf24");
      return;
    }
    const counts = late.model?.counts || {};
    const status = late.model?.status === "SHADOW_VALIDATED" ? "SHADOW VALIDATED" :
      late.model?.status === "NOT_VALIDATED" ? "NEVALIDOVANÝ" : "WARMUP · ZBER DÁT";
    const tone = late.model?.status === "SHADOW_VALIDATED" ? "#60a5fa" : "#fbbf24";
    const detail = "Označené zápasy: " + number(late.total_labeled_matches) +
      " · tréning: " + number(counts.train_matches) + " zápasov / " + number(counts.train) + " vzoriek" +
      " · validácia: " + number(counts.validation_matches) + " zápasov / " + number(counts.validation) + " vzoriek" +
      " · kladné výsledky: " + number((counts.train_positive || 0) + (counts.validation_positive || 0)) +
      " · záporné: " + number((counts.train_negative || 0) + (counts.validation_negative || 0)) +
      ". Cieľ: aspoň jeden gól po 5-minútovom oneskorení do konca riadneho času.";
    addCard(grid, "GÓL 70–85′ → KONIEC", status, detail, tone);
  }
  function renderThresholdModel(grid, model, title) {
    if (!model) {
      addCard(grid, title, "DÁTA NEDOSTUPNÉ", "Samostatný modelový súbor sa nepodarilo načítať.", "#fbbf24");
      return;
    }
    const policy = model.validation_policy || {};
    const totalMatches = number(model.total_labeled_matches);
    const totalSamples = number(model.total_labeled_samples);
    addCard(grid, title + " · CELKOM",
      model.status === "SHADOW_VALIDATION_AVAILABLE" ? "VALIDÁCIA DOSTUPNÁ" : "ZBER VZORIEK",
      totalSamples + " vzoriek naprieč hranicami · " + totalMatches + " unikátnych zápasov. Každá hranica sa vyhodnocuje samostatne; vzorky nie sú unikátne zápasy.",
      model.status === "SHADOW_VALIDATION_AVAILABLE" ? "#60a5fa" : "#cbd5e1");
    (model.lines || []).forEach(line => {
      const item = model.models?.[line.key] || {};
      const counts = item.counts || {};
      const validated = item.status === "SHADOW_VALIDATED";
      const status = validated ? "SHADOW VALIDATED" :
        item.status === "NOT_VALIDATED" ? "NEVALIDOVANÝ" : "WARMUP";
      const detail = "Tréning: " + number(counts.train) + " vzoriek / " + number(counts.train_matches) +
        " zápasov · validácia: " + number(counts.validation) + " / " + number(counts.validation_matches) +
        " zápasov. Cieľ validácie: " + number(policy.min_validation_samples || 300) +
        " vzoriek / " + number(policy.min_validation_matches || 50) + " zápasov.";
      addCard(grid, title + " · " + line.side + " " + line.line, status, detail,
        validated ? "#60a5fa" : item.status === "NOT_VALIDATED" ? "#fbbf24" : "#cbd5e1");
    });
  }
  function render(data) {
    target.innerHTML = "";
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;";
    target.appendChild(grid);

    const btts = data.btts;
    if (btts) {
      const s = signalStats(btts);
      addCard(grid, "BTTS · FLASHSCORE", s.rate,
        s.counts.WIN + " WIN / " + s.counts.LOSS + " LOSS · " + s.counts.OPEN + " OPEN · " +
        s.counts.UNRESOLVED + " nevyhodnotiteľné · " + s.total + " signálov. " +
        "Prvý signál v zápase: " + s.uniqueRate + " · " + s.uniqueMatches + " unikátnych zápasov.",
        "#60a5fa");
    } else {
      addCard(grid, "BTTS · FLASHSCORE", "ARCHÍV NEDOSTUPNÝ", "Výsledky sa zobrazia po načítaní BTTS archívu.", "#fbbf24");
    }

    const model = data.model;
    renderModel(grid, model, 15);
    renderModel(grid, model, 25);
    ["15", "25", "MODEL_15", "MODEL_25", "MODEL_FT", "FT", "NEXT_TEAM", "BTTS", "RESULT_1X2"].forEach(key => renderLedgerTarget(grid, data.ledger, key));
    renderLate(grid, data.late);
    renderThresholdModel(grid, data.corners, "AI CORNERS · CELKOVÉ ROHY");
    renderThresholdModel(grid, data.cards, "AI CARDS · ŽLTÉ KARTY");

    addCard(grid, "ZELENÝ SIGNÁL · STARŠÍ ENGINE", "VYPNUTÝ",
      "Legacy zelený engine je v aktuálnej Flashscore-only verzii vypnutý. Jeho staré záznamy sa nemiešajú s novými výsledkami.",
      "#94a3b8");
    addCard(grid, "PRESSURE / MOMENTUM", "ANALYTIKA",
      "Meria tlak a tempo zápasu. Nie je to samostatný stávkový signál a nepriraďuje sa mu WIN/LOSS.",
      "#94a3b8");

    const note = document.createElement("p");
    note.textContent = "Aktualizácia dát: BTTS " + time(btts?.updated_at) +
      " · AI EDGE " + time(model?.updated_at) + " · neskorý gól " + time(data.late?.updated_at) +
      ". SHADOW VALIDATED znamená splnenie interných validačných kritérií, nie preukázanú ziskovosť ani potvrdenú stávkovú výhodu. WIN rate nie je ROI.";
    note.style.cssText = "font-size:10px;line-height:1.55;color:#aebed0;margin:10px 1px 2px;";
    target.appendChild(note);
  }
  async function refresh() {
    const results = await Promise.allSettled([read(URLS.btts), read(URLS.model), read(URLS.late), read(URLS.corners), read(URLS.cards), read(URLS.ledger)]);
    const data = {
      btts: results[0].status === "fulfilled" ? results[0].value : null,
      model: results[1].status === "fulfilled" ? results[1].value : null,
      late: results[2].status === "fulfilled" ? results[2].value : null,
      corners: results[3].status === "fulfilled" ? results[3].value : null,
      cards: results[4].status === "fulfilled" ? results[4].value : null,
      ledger: results[5].status === "fulfilled" ? results[5].value : null
    };
    render(data);
    const errors = results.map((result, index) => result.status === "rejected" ? ["BTTS", "AI EDGE", "neskorý gól", "rohy", "žlté karty", "predikčný denník"][index] + ": " + (result.reason?.message || "chyba") : null).filter(Boolean);
    if (errors.length) {
      const warning = document.createElement("p");
      warning.textContent = "Niektoré zdroje sú dočasne nedostupné: " + errors.join(" · ");
      warning.style.cssText = "font-size:10px;color:#fbbf24;line-height:1.5;";
      target.appendChild(warning);
    }
  }
  refresh().catch(error => {
    target.textContent = "Performance Center sa nepodarilo načítať: " + (error?.message || "neznáma chyba");
  });
  window.setInterval(() => refresh().catch(() => {}), 60000);
})();
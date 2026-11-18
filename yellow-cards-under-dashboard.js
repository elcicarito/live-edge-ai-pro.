"use strict";
(() => {
  const MODEL_URL = "https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./live-data-v2/data/ai-edge-live-cards-under-model.json";
  const root = document.getElementById("yellow-cards-under-lab");
  const overview = document.getElementById("yellow-cards-under-overview");
  const meta = document.getElementById("yellow-cards-under-meta");
  if (!root || !overview || !meta) return;

  const lines = [
    ["UNDER_3_5", "UNDER 3.5"], ["UNDER_4_5", "UNDER 4.5"],
    ["UNDER_5_5", "UNDER 5.5"], ["OVER_2_5", "OVER 2.5"],
    ["OVER_3_5", "OVER 3.5"], ["OVER_4_5", "OVER 4.5"]
  ];
  const esc = value => String(value ?? "—").replace(/[&<>"']/g, ch =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const number = value => Number(value || 0).toLocaleString("sk-SK");
  const pct = value => Number.isFinite(Number(value)) ? (Number(value) * 100).toFixed(1) + " %" : "—";

  function stateOf(model) {
    if (model?.status === "SHADOW_VALIDATED") return ["SHADOW VALIDOVANÝ", "ready"];
    if (model?.status === "NOT_VALIDATED") return ["NEPREŠIEL VALIDÁCIOU", "fail"];
    if (model?.status === "WARMUP") return ["ZBIERA VZORKY", "warmup"];
    return ["ČAKÁ NA DÁTA", ""];
  }
  function render(model) {
    if (model?.source !== "Flashscore" || model?.mode !== "FORWARD_ONLY_LIVE_CARDS_SHADOW") {
      throw new Error("Neplatný formát alebo zdroj modelu.");
    }
    const policy = model.validation_policy || {};
    const minTrain = Number(policy.min_train_samples || 500);
    const minValidation = Number(policy.min_validation_samples || 300);
    const minTrainMatches = Number(policy.min_train_matches || 100);
    const minValidationMatches = Number(policy.min_validation_matches || 50);
    const modelRows = lines.map(([key]) => model.models?.[key]?.counts || {});
    const minCount = field => Math.min(...modelRows.map(row => Number(row[field] || 0)));
    const readyCount = lines.filter(([key]) => model.models?.[key]?.status === "SHADOW_VALIDATED").length;
    const sampleTrain = minCount("train");
    const sampleValidation = minCount("validation");
    const matchesTrain = minCount("train_matches");
    const matchesValidation = minCount("validation_matches");
    const sampleReady = Math.min(100, 100 * Math.min(sampleTrain / minTrain, sampleValidation / minValidation));
    const matchReady = Math.min(100, 100 * Math.min(matchesTrain / minTrainMatches, matchesValidation / minValidationMatches));
    const summary = "<section class='cards-readiness'>" +
      "<div class='cards-readiness-top'><div><small>CELKOVÁ PRIPRAVENOSŤ MODELU</small><strong>" +
      readyCount + "/6 hraníc validovaných</strong></div><span>" +
      (readyCount === 6 ? "VALIDÁCIA SPLNENÁ" : "ZBER A VALIDÁCIA") + "</span></div>" +
      "<div class='cards-readiness-grid'>" +
      "<div><b>" + number(sampleTrain) + "/" + minTrain + "</b><small>tréningové vzorky na hranicu</small></div>" +
      "<div><b>" + number(sampleValidation) + "/" + minValidation + "</b><small>validačné vzorky na hranicu</small></div>" +
      "<div><b>" + number(matchesTrain) + "/" + minTrainMatches + "</b><small>tréningové zápasy na hranicu</small></div>" +
      "<div><b>" + number(matchesValidation) + "/" + minValidationMatches + "</b><small>validačné zápasy na hranicu</small></div>" +
      "</div><div class='cards-progress'><i style='width:" + sampleReady.toFixed(1) + "%'></i></div>" +
      "<div class='cards-progress-label'><span>Pokrytie vzorkami</span><span>" + sampleReady.toFixed(0) + " %</span></div>" +
      "<div class='cards-progress'><i style='width:" + matchReady.toFixed(1) + "%'></i></div>" +
      "<div class='cards-progress-label'><span>Pokrytie nezávislými zápasmi</span><span>" + matchReady.toFixed(0) + " %</span></div>" +
      "<p>Pripravenosť sa počíta podľa najslabšie pokrytej hranice, nie súčtom opakovaných vzoriek.</p></section>";
    overview.innerHTML = summary + lines.map(([key, label]) => {
      const trained = model.models?.[key] || {};
      const counts = trained.counts || {};
      const [state, stateClass] = stateOf(trained);
      const sampleProgress = Math.min(100, 100 * Math.min(
        Number(counts.train || 0) / minTrain, Number(counts.validation || 0) / minValidation
      ));
      const matchProgress = Math.min(100, 100 * Math.min(
        Number(counts.train_matches || 0) / minTrainMatches,
        Number(counts.validation_matches || 0) / minValidationMatches
      ));
      const metrics = trained.metrics;
      const performance = metrics ? "<div class='cards-line-performance'><b>Log-loss</b> " +
        esc(Number(metrics.log_loss).toFixed(3)) + " · <b>Brier</b> " +
        esc(Number(metrics.brier).toFixed(3)) + " · <b>Kalibrácia ECE</b> " +
        esc(pct(metrics.calibration?.expected_calibration_error)) + "</div>" : "";
      return "<article class='cards-line-card'>" +
        "<div class='cards-line-top'><b>" + label + "</b><span class='cards-line-state " + stateClass + "'>" + state + "</span></div>" +
        "<div class='cards-line-stats'>" +
          "<div><strong>" + number(counts.train) + "</strong><small>tréningové vzorky</small></div>" +
          "<div><strong>" + number(counts.validation) + "</strong><small>validačné vzorky</small></div>" +
          "<div><strong>" + number(counts.train_matches) + "</strong><small>tréningové zápasy</small></div>" +
          "<div><strong>" + number(counts.validation_matches) + "</strong><small>validačné zápasy</small></div>" +
        "</div>" +
        "<div class='cards-progress'><i style='width:" + sampleProgress.toFixed(1) + "%'></i></div>" +
        "<div class='cards-progress-label'><span>Vzorky · tréning " + number(counts.train) + "/" + minTrain +
          "</span><span>validácia " + number(counts.validation) + "/" + minValidation + "</span></div>" +
        "<div class='cards-progress'><i style='width:" + matchProgress.toFixed(1) + "%'></i></div>" +
        "<div class='cards-progress-label'><span>Nezávislé zápasy</span><span>" + matchProgress.toFixed(0) + " % minima</span></div>" +
        performance + "</article>";
    }).join("");
    const updated = new Date(model.updated_at || "");
    const updatedText = Number.isNaN(updated.getTime()) ? "čas reportu neznámy" : updated.toLocaleString("sk-SK");
    const excluded = model.excluded || {};
    const excludedTotal = Object.values(excluded).reduce((sum, value) => sum + Number(value || 0), 0);
    meta.innerHTML = "<b>Report:</b> " + esc(updatedText) +
      " · <b>Vzorky:</b> " + number(model.total_labeled_samples) +
      " · <b>Nezávislé zápasy:</b> " + number(model.total_labeled_matches) +
      " · <b>Validované hranice:</b> " + number(model.validated_lines) + "/6" +
      " · <b>Vyradené prípady:</b> " + number(excludedTotal) +
      "<p>Model používa iba nové Flashscore merania od aktivácie tréningu, päťminútové oneskorenie a potvrdené konečné počty žltých kariet. Predĺženie a penalty sú vylúčené. SHADOW validácia nie je potvrdený tip ani garancia.</p>";
  }
  async function load() {
    try {
      const response = await fetch(MODEL_URL + "?t=" + Date.now(), {cache:"no-store", headers:{Accept:"application/json"}});
      if (response.status === 404) {
        overview.innerHTML = "<div class='cards-line-card'>Model ešte nevytvoril report. Čakáme na ďalší úspešný Flashscore zber.</div>";
        meta.textContent = "Zdroj: Flashscore · režim SHADOW · report zatiaľ nie je dostupný.";
        return;
      }
      if (!response.ok) throw new Error("HTTP " + response.status);
      render(await response.json());
    } catch (error) {
      overview.innerHTML = "<div class='cards-line-card'>Report sa teraz nepodarilo načítať.</div>";
      meta.textContent = "Kontrola reportu zlyhala: " + error.message + ".";
    }
  }
  load();
  window.setInterval(load, 120000);
})();

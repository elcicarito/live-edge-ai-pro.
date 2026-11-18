"use strict";
(() => {
  const MODEL_URL = "https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./live-data-v2/data/ai-edge-live-corners-under-model.json";
  const overview = document.getElementById("corners-under-overview");
  const meta = document.getElementById("corners-under-meta");
  if (!overview || !meta) return;

  const esc = value => String(value ?? "—").replace(/[&<>"']/g, ch =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const number = value => Number(value || 0).toLocaleString("sk-SK");
  const pct = value => Number.isFinite(Number(value)) ? (Number(value) * 100).toFixed(1) + " %" : "—";
  const lines = [
    ["UNDER_8_5", "8.5"],
    ["UNDER_9_5", "9.5"],
    ["UNDER_10_5", "10.5"],
    ["UNDER_11_5", "11.5"]
  ];

  function stateOf(model) {
    if (model?.status === "SHADOW_VALIDATED") return ["SHADOW VALIDOVANÝ", "ready"];
    if (model?.status === "NOT_VALIDATED") return ["NEPREŠIEL VALIDÁCIOU", "fail"];
    return ["ZBIERA VZORKY", ""];
  }

  function render(model) {
    if (model.source !== "Flashscore" || model.mode !== "FORWARD_ONLY_LIVE_CORNERS_UNDER_SHADOW") {
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
      "<div class='cards-readiness-top'><div><small>CELKOVÁ PRIPRAVENOSŤ MODELU ROHOV</small><strong>" +
      readyCount + "/4 hraníc validovaných</strong></div><span>" +
      (readyCount === 4 ? "VALIDÁCIA SPLNENÁ" : "ZBER A VALIDÁCIA") + "</span></div>" +
      "<div class='cards-readiness-grid'>" +
      "<div><b>" + number(sampleTrain) + "/" + minTrain + "</b><small>tréningové vzorky na hranicu</small></div>" +
      "<div><b>" + number(sampleValidation) + "/" + minValidation + "</b><small>validačné vzorky na hranicu</small></div>" +
      "<div><b>" + number(matchesTrain) + "/" + minTrainMatches + "</b><small>tréningové zápasy na hranicu</small></div>" +
      "<div><b>" + number(matchesValidation) + "/" + minValidationMatches + "</b><small>validačné zápasy na hranicu</small></div>" +
      "</div><div class='cards-progress'><i style='width:" + sampleReady.toFixed(1) + "%'></i></div>" +
      "<div class='cards-progress-label'><span>Pokrytie vzorkami</span><span>" + sampleReady.toFixed(0) + " %</span></div>" +
      "<div class='cards-progress'><i style='width:" + matchReady.toFixed(1) + "%'></i></div>" +
      "<div class='cards-progress-label'><span>Pokrytie nezávislými zápasmi</span><span>" + matchReady.toFixed(0) + " %</span></div>" +
      "<p>Pripravenosť vychádza z najslabšie pokrytej hranice. Zobrazené percentá vyjadrujú iba množstvo dát, nie úspešnosť modelu.</p></section>";
    overview.innerHTML = summary + lines.map(([key, label]) => {
      const summary = model.dataset_summary?.[key] || {};
      const trained = model.models?.[key] || {};
      const counts = trained.counts || {};
      const metrics = trained.metrics || {};
      const [state, stateClass] = stateOf(trained);
      const minTrain = Number(policy.min_train_samples || 500);
      const minValidation = Number(policy.min_validation_samples || 300);
      const minTrainMatches = Number(policy.min_train_matches || 100);
      const minValidationMatches = Number(policy.min_validation_matches || 50);
      const sampleProgress = Math.min(100, 100 * Math.min(
        Number(counts.train || 0) / minTrain,
        Number(counts.validation || 0) / minValidation
      ));
      const matchProgress = Math.min(100, 100 * Math.min(
        Number(counts.train_matches || 0) / minTrainMatches,
        Number(counts.validation_matches || 0) / minValidationMatches
      ));
      const performance = metrics.log_loss !== undefined
        ? "<div class='corners-lab-foot'><strong>Log-loss</strong> " + Number(metrics.log_loss).toFixed(3) +
          " · <strong>Brier</strong> " + Number(metrics.brier).toFixed(3) +
          " · <strong>Kalibrácia ECE</strong> " + pct(metrics.calibration?.expected_calibration_error) + "</div>"
        : "";
      return "<article class='corners-line-card'>" +
        "<div class='corners-line-top'><span class='corners-line-name'>UNDER " + label + "</span><span class='corners-line-state " + stateClass + "'>" + state + "</span></div>" +
        "<div class='corners-line-stats'>" +
          "<div class='corners-line-stat'><b>" + number(summary.matches) + "</b><span>nezávislé zápasy</span></div>" +
          "<div class='corners-line-stat'><b>" + number(summary.samples) + "</b><span>LIVE vzorky</span></div>" +
          "<div class='corners-line-stat'><b>" + number(summary.train_matches) + "</b><span>tréningové zápasy</span></div>" +
          "<div class='corners-line-stat'><b>" + number(summary.validation_matches) + "</b><span>validačné zápasy</span></div>" +
        "</div>" +
        "<div class='corners-progress'><i style='width:" + sampleProgress.toFixed(1) + "%'></i></div>" +
        "<div class='corners-progress-label'><span>Vzorky · tréning " + number(counts.train) + "/" + minTrain + "</span><span>validácia " + number(counts.validation) + "/" + minValidation + "</span></div>" +
        "<div class='corners-progress'><i style='width:" + matchProgress.toFixed(1) + "%'></i></div>" +
        "<div class='corners-progress-label'><span>Nezávislé zápasy</span><span>" + matchProgress.toFixed(0) + " % minima</span></div>" +
        performance +
      "</article>";
    }).join("");

    const updated = new Date(model.updated_at || "");
    const updatedText = Number.isNaN(updated.getTime()) ? "čas reportu neznámy" : updated.toLocaleString("sk-SK");
    const excluded = model.excluded || {};
    const excludedTotal = Object.values(excluded).reduce((sum, value) => sum + Number(value || 0), 0);
    meta.innerHTML = "<strong>Report:</strong> " + esc(updatedText) +
      " · <strong>Označené vzorky:</strong> " + number(model.total_labeled_samples) +
      " · <strong>Validované hranice:</strong> " + number(model.validated_lines) + "/4" +
      " · <strong>Vyradené prípady:</strong> " + number(excludedTotal) +
      "<br>Vzorky vznikajú iba z nových Flashscore meraní od aktivácie tréningu. SHADOW validácia nie je potvrdený tip ani garancia výsledku.";
  }

  async function load() {
    try {
      const response = await fetch(MODEL_URL + "?t=" + Date.now(), { cache: "no-store", headers: { Accept: "application/json" } });
      if (response.status === 404) {
        overview.innerHTML = "<div class='corners-line-card'>Model ešte nevytvoril prvý report. Počkáme na ďalší úspešný LIVE zber.</div>";
        meta.textContent = "Zdroj: Flashscore · režim SHADOW · zatiaľ bez zverejneného reportu.";
        return;
      }
      if (!response.ok) throw new Error("HTTP " + response.status);
      render(await response.json());
    } catch (error) {
      overview.innerHTML = "<div class='corners-line-card'>Report sa teraz nepodarilo načítať.</div>";
      meta.textContent = "Kontrola dát zlyhala: " + error.message + ". Samotný zber a tréning tým nie sú potvrdené ani zmenené.";
    }
  }
  load();
  window.setInterval(load, 120000);
})();

"use strict";
(() => {
  const BASE = "https://raw.githubusercontent.com/elcicarito/live-edge-ai-pro./live-data-v2/data/";
  const API = "https://api.github.com/repos/elcicarito/live-edge-ai-pro./actions/workflows/ai-edge-selector-dataset.yml/runs?per_page=1";
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "—").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[ch]);
  const fmt = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString("sk-SK") : "—";
  const date = value => {
    const d = new Date(value || "");
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("sk-SK");
  };
  async function json(url) {
    const response = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }
  function metric(value, label, note = "") {
    return '<div class="ai-edge-metric"><strong>' + esc(value) + '</strong><span>' +
      esc(label) + '</span>' + (note ? '<small>' + esc(note) + '</small>' : '') + '</div>';
  }
  function setState(label, detail, kind = "muted") {
    const node = $("ai-edge-state");
    if (!node) return;
    node.className = "ai-edge-state " + kind;
    node.textContent = label + (detail ? " · " + detail : "");
  }
  async function refresh() {
    const refreshNode = $("ai-edge-updated");
    try {
      const [status, quality] = await Promise.all([
        json(BASE + "flashscore-live-observations-status.json"),
        json(BASE + "flashscore-archive-quality.json")
      ]);
      if (status.source !== "Flashscore" || quality.source !== "Flashscore") {
        throw new Error("Zdroj dát nie je potvrdený Flashscore");
      }
      const counts = status.counts || {};
      const labels = status.label_counts || {};
      const matches = status.label_match_quality || {};
      const summary = quality.summary || {};
      const coverage = Number(matches.confirmed_matches_with_stats_coverage);
      $("ai-edge-metrics").innerHTML = [
        metric(fmt(summary.archived_matches), "Archivované zápasy"),
        metric(fmt(counts.valid_observations), "Flashscore snímky"),
        metric(fmt(labels.confirmed), "Potvrdené označenia"),
        metric(Number.isFinite(coverage) ? (coverage * 100).toFixed(1) + "%" : "—", "Zápasy so štatistikami")
      ].join("");
      $("ai-edge-data-meta").innerHTML =
        '<div><span>Posledný dátový report</span><b>' + esc(date(status.generated_at)) + '</b></div>' +
        '<div><span>Potvrdené zápasy</span><b>' + esc(fmt(matches.confirmed_matches)) + '</b></div>' +
        '<div><span>Snímky so štatistikami</span><b>' + esc(fmt(counts.snapshots_with_stats)) + '</b></div>' +
        '<div><span>Interval zberu · medián</span><b>' + esc(quality.cadence_minutes?.median ?? "—") + ' min</b></div>';
      const ready = status.training_ready === true;
      setState(ready ? "DÁTA PRIPRAVENÉ NA POSÚDENIE" : "SHADOW MODE · ZBER A OVEROVANIE", 
        "Flashscore only · predpokladané oneskorenie 5 min", ready ? "good" : "warn");
      $("ai-edge-warning").textContent =
        "Model zatiaľ nie je natrénovaný. Úspešnosť, pravdepodobnosti ani stávkové odporúčania sa nezobrazujú. Päť minút je konzervatívny predpoklad oneskorenia, nie nameraná latencia každého zápasu.";
      refreshNode.textContent = "Aktualizované: " + date(status.generated_at);
      try {
        const runs = await json(API);
        const run = runs.workflow_runs?.[0];
        $("ai-edge-audit-status").textContent = run
          ? "Audit workflow: " + run.status.toUpperCase() + (run.conclusion ? " · " + run.conclusion.toUpperCase() : "")
          : "Audit workflow: zatiaľ bez behu";
        $("ai-edge-audit-link").href = run?.html_url || "https://github.com/elcicarito/live-edge-ai-pro./actions/workflows/ai-edge-selector-dataset.yml";
      } catch (_) {
        $("ai-edge-audit-status").textContent = "Stav GitHub auditu momentálne nedostupný";
        $("ai-edge-audit-link").href = "https://github.com/elcicarito/live-edge-ai-pro./actions/workflows/ai-edge-selector-dataset.yml";
      }
    } catch (error) {
      setState("DÁTOVÝ REPORT NEDOSTUPNÝ", error.message, "bad");
      $("ai-edge-warning").textContent = "Nepodarilo sa načítať Flashscore audit. Zobrazené predikcie sú vypnuté; skontroluj pripojenie alebo stav archívu.";
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("ai-edge-selector-panel")) return;
    refresh();
    window.setInterval(refresh, 60000);
  });
})();

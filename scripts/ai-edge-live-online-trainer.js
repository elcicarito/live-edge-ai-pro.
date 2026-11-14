"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const DATA = path.resolve(__dirname, "..", "data");
const MODEL_FILE = "ai-edge-live-model.json";
const LAG_MINUTES = 5;
const HORIZONS = [15, 25];
const MIN_TRAIN = 500;
const MIN_VALIDATION = 300;
const MIN_TRAIN_MATCHES = 100;
const MIN_VALIDATION_MATCHES = 50;
const MIN_RELATIVE_LOG_LOSS_GAIN = 0.01;
const MIN_RELATIVE_BRIER_GAIN = 0.005;
const FEATURE_NAMES = [
  "minute", "total_goals", "xg_total", "xg_difference", "sot_total",
  "sot_difference", "shots_total", "shots_difference", "corners_total",
  "big_chances_total", "xgot_total", "red_cards_total",
  "possession_difference", "recent_sot_delta", "recent_shot_delta",
  "recent_corner_delta"
];

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(",", ".").replace("%", ""));
  return Number.isFinite(n) ? n : null;
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}
function writeJson(file, value) {
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temp, file);
}
function isoWeekKey(value) {
  const date = new Date(value);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return date.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
}
function readTimeline(dataDir, startedAt = 0) {
  const index = readJson(path.join(dataDir, "flashscore-timeline-index.json"), null);
  if (!index || index.source !== "Flashscore" || !Array.isArray(index.weeks)) return [];
  const rows = [];
  const firstEligibleWeek = isoWeekKey(startedAt);
  for (const item of index.weeks) {
    const week = typeof item === "string" ? item : item?.week;
    if (typeof week === "string" && week < firstEligibleWeek) continue;
    const name = typeof item === "string" ? item : item?.file;
    if (typeof name !== "string" || !/^flashscore-match-timeline-\d{4}-W\d{2}\.jsonl\.gz$/.test(name)) continue;
    const file = path.join(dataDir, name);
    if (!fs.existsSync(file)) continue;
    const raw = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* skip malformed archive line */ }
    }
  }
  return rows;
}
function statValue(stats, pattern) {
  const item = (Array.isArray(stats) ? stats : []).find(s =>
    pattern.test(String(s?.label || s?.name || "")) &&
    (!s?.period || String(s.period).toLowerCase() === "match")
  );
  if (!item) return null;
  const home = finite(item.home_numeric ?? item.home);
  const away = finite(item.away_numeric ?? item.away);
  return home === null || away === null ? null : { home, away };
}
const STAT_PATTERNS = {
  xg: /expected goals\s*\(xg\)|^expected goals$|^xg$/i,
  sot: /shots on target/i,
  shots: /^total shots$/i,
  corners: /corner kicks|^corners$/i,
  possession: /ball possession|^possession$/i,
  big: /big chances/i,
  xgot: /xg on target|xgot/i,
  red: /red cards/i
};
function scoreOf(row) {
  const h = finite(row?.snapshot?.home_score), a = finite(row?.snapshot?.away_score);
  return h === null || a === null || h < 0 || a < 0 ? null : [h, a];
}
function minuteOf(row) { return finite(row?.snapshot?.live_minute); }
function validStage(stage) {
  return !/(half.?time|\bht\b|finished|full.?time|\bft\b|after extra time|penalt|abandoned|cancelled|postponed|suspended)/i.test(String(stage || ""));
}
function stableValidationMatch(matchId) {
  let hash = 2166136261;
  for (const char of String(matchId)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash % 5 === 0;
}
function featureVector(row, previous) {
  const snapshot = row.snapshot || {};
  const stats = snapshot.stats || [];
  const xg = statValue(stats, STAT_PATTERNS.xg);
  const sot = statValue(stats, STAT_PATTERNS.sot);
  const shots = statValue(stats, STAT_PATTERNS.shots);
  const corners = statValue(stats, STAT_PATTERNS.corners);
  const big = statValue(stats, STAT_PATTERNS.big);
  const xgot = statValue(stats, STAT_PATTERNS.xgot);
  const red = statValue(stats, STAT_PATTERNS.red);
  const possession = statValue(stats, STAT_PATTERNS.possession);
  const score = scoreOf(row);
  const minute = minuteOf(row);
  if (!score || minute === null || !sot || !shots) return null;
  const oldStats = previous?.snapshot?.stats || [];
  const oldSot = statValue(oldStats, STAT_PATTERNS.sot);
  const oldShots = statValue(oldStats, STAT_PATTERNS.shots);
  const oldCorners = statValue(oldStats, STAT_PATTERNS.corners);
  const delta = (now, old) => now && old ? Math.max(0, now.home - old.home) + Math.max(0, now.away - old.away) : 0;
  return [
    Math.min(1.2, minute / 90),
    Math.min(1, (score[0] + score[1]) / 5),
    Math.min(1, ((xg?.home || 0) + (xg?.away || 0)) / 4),
    Math.max(-1, Math.min(1, ((xg?.home || 0) - (xg?.away || 0)) / 3)),
    Math.min(1, (sot.home + sot.away) / 12),
    Math.max(-1, Math.min(1, (sot.home - sot.away) / 10)),
    Math.min(1, (shots.home + shots.away) / 30),
    Math.max(-1, Math.min(1, (shots.home - shots.away) / 20)),
    Math.min(1, ((corners?.home || 0) + (corners?.away || 0)) / 16),
    Math.min(1, ((big?.home || 0) + (big?.away || 0)) / 8),
    Math.min(1, ((xgot?.home || 0) + (xgot?.away || 0)) / 5),
    Math.min(1, ((red?.home || 0) + (red?.away || 0)) / 2),
    Math.min(1, Math.abs((possession?.home || 50) - (possession?.away || 50)) / 100),
    Math.min(1, delta(sot, oldSot) / 4),
    Math.min(1, delta(shots, oldShots) / 8),
    Math.min(1, delta(corners, oldCorners) / 4)
  ];
}
function goalTransitions(rows) {
  const transitions = [];
  for (let i = 1; i < rows.length; i++) {
    const before = scoreOf(rows[i - 1]), after = scoreOf(rows[i]);
    const from = minuteOf(rows[i - 1]), to = minuteOf(rows[i]);
    if (!before || !after || from === null || to === null) continue;
    if (after[0] < before[0] || after[1] < before[1]) return { transitions: [], invalid: true };
    if (after[0] + after[1] > before[0] + before[1]) transitions.push({ from, to });
  }
  return { transitions, invalid: false };
}
function labelFor(sampleRow, rows, transitions, outcome, horizon) {
  const minute = minuteOf(sampleRow);
  if (minute === null) return null;
  const start = minute + LAG_MINUTES;
  const end = start + horizon;
  for (const t of transitions) {
    if (t.from < start && t.to > minute && t.to <= start) return null;
    if (t.from < start && t.to > start) return null;
    if (t.from < end && t.to > end) return null;
  }
  if (transitions.some(t => t.from >= start && t.to <= end)) return 1;
  const lastMinute = minuteOf(rows[rows.length - 1]);
  const finalText = String(outcome?.final_match?.status_text || "");
  const confirmedFinished = outcome?.source === "Flashscore" && outcome?.status === "CONFIRMED" &&
    outcome?.status_confirmation === "confirmed_finished" && outcome?.final_status === "FINISHED" &&
    !/penalt|after extra time|abandoned|cancelled|postponed/i.test(finalText);
  if (lastMinute !== null && lastMinute >= end) return 0;
  if (confirmedFinished && end <= 90 && lastMinute !== null && lastMinute >= 90) return 0;
  return null;
}
function sigmoid(z) { const x = Math.max(-20, Math.min(20, z)); return 1 / (1 + Math.exp(-x)); }
function rowWeights(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.match_id, (counts.get(row.match_id) || 0) + 1);
  return rows.map(row => 1 / (counts.get(row.match_id) || 1));
}
function logLoss(rows, weights, sampleWeights = rowWeights(rows)) {
  if (!rows.length) return null;
  let total = 0, weightTotal = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], weight = sampleWeights[i];
    const p = Math.max(1e-8, Math.min(1 - 1e-8, sigmoid(weights[0] + row.x.reduce((s, v, j) => s + v * weights[j + 1], 0))));
    total -= weight * (row.y * Math.log(p) + (1 - row.y) * Math.log(1 - p));
    weightTotal += weight;
  }
  return weightTotal ? total / weightTotal : null;
}

function fit(rows) {
  const weights = Array(FEATURE_NAMES.length + 1).fill(0);
  const prevalence = rows.reduce((sum, row) => sum + row.y, 0) / rows.length;
  weights[0] = Math.log(Math.max(0.01, prevalence) / Math.max(0.01, 1 - prevalence));
  const rate = 0.08, l2 = 0.002, epochs = 450;
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradients = Array(weights.length).fill(0);
    for (const row of rows) {
      const p = sigmoid(weights[0] + row.x.reduce((sum, v, i) => sum + v * weights[i + 1], 0));
      const error = p - row.y;
      gradients[0] += error;
      for (let i = 0; i < row.x.length; i++) gradients[i + 1] += error * row.x[i];
    }
    for (let i = 0; i < weights.length; i++) {
      const gradient = gradients[i] / rows.length + (i ? l2 * weights[i] : 0);
      weights[i] -= rate * gradient;
    }
  }
  return weights.map(value => Number(value.toFixed(8)));
}
function metrics(rows, weights) {
  if (!rows.length) return null;
  const sampleWeights = rowWeights(rows);
  let correct = 0, brier = 0, weightTotal = 0, positiveWeight = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], weight = sampleWeights[i];
    const p = sigmoid(weights[0] + row.x.reduce((sum, v, j) => sum + v * weights[j + 1], 0));
    if ((p >= 0.5 ? 1 : 0) === row.y) correct += weight;
    brier += weight * (p - row.y) ** 2;
    weightTotal += weight;
    positiveWeight += weight * row.y;
  }
  const prevalence = positiveWeight / weightTotal;
  const baseline = Math.max(1e-8, Math.min(1 - 1e-8, prevalence));
  const baselineLogLoss = -(prevalence * Math.log(baseline) + (1 - prevalence) * Math.log(1 - baseline));
  const baselineBrier = prevalence * (1 - prevalence);
  const modelLoss = logLoss(rows, weights, sampleWeights);
  const modelBrier = brier / weightTotal;
  return {
    count: rows.length,
    matches: new Set(rows.map(row => row.match_id)).size,
    accuracy: Number((correct / weightTotal).toFixed(4)),
    brier: Number(modelBrier.toFixed(4)),
    baseline_brier: Number(baselineBrier.toFixed(4)),
    log_loss: Number(modelLoss.toFixed(4)),
    baseline_log_loss: Number(baselineLogLoss.toFixed(4))
  };
}

function buildSamples(rows, outcomes, startedAt) {
  const grouped = new Map();
  for (const row of rows) {
    const id = String(row?.match_id || "");
    const time = Date.parse(row?.snapshot?.collected_at || "");
    if (!id || !Number.isFinite(time) || time < startedAt || !validStage(row?.snapshot?.stage)) continue;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(row);
  }
  const byHorizon = Object.fromEntries(HORIZONS.map(h => [h, []]));
  for (const [matchId, matchRows] of grouped) {
    matchRows.sort((a, b) => Date.parse(a.snapshot.collected_at) - Date.parse(b.snapshot.collected_at));
    const outcome = outcomes?.matches?.[matchId.replace(/^flashscore:/, "")];
    if (!outcome || outcome.source !== "Flashscore" || outcome.status !== "CONFIRMED" ||
        outcome.status_confirmation !== "confirmed_finished" || outcome.final_status !== "FINISHED") continue;
    const transitionResult = goalTransitions(matchRows);
    if (transitionResult.invalid) continue;
    for (let i = 0; i < matchRows.length; i++) {
      const row = matchRows[i];
      const minute = minuteOf(row);
      if (minute === null || minute < 1 || minute > 90 || !scoreOf(row)) continue;
      const x = featureVector(row, matchRows[i - 1]);
      if (!x) continue;
      for (const horizon of HORIZONS) {
        const y = labelFor(row, matchRows, transitionResult.transitions, outcome, horizon);
        if (y === null) continue;
        const sampleId = String(row.match_id) + "|" + String(row.snapshot.collected_at) + "|" + horizon;
        byHorizon[horizon].push({ id: sampleId, match_id: matchId, x, y, split: stableValidationMatch(matchId) ? "validation" : "train" });
      }
    }
  }
  return byHorizon;
}
function trainHorizon(samples) {
  const train = samples.filter(row => row.split === "train");
  const validation = samples.filter(row => row.split === "validation");
  const trainPos = train.filter(row => row.y === 1).length;
  const trainNeg = train.length - trainPos;
  const valPos = validation.filter(row => row.y === 1).length;
  const valNeg = validation.length - valPos;
  const trainMatches = new Set(train.map(row => row.match_id)).size;
  const validationMatches = new Set(validation.map(row => row.match_id)).size;
  const counts = { train: train.length, validation: validation.length, train_matches: trainMatches, validation_matches: validationMatches, train_positive: trainPos, train_negative: trainNeg, validation_positive: valPos, validation_negative: valNeg };
  if (train.length < MIN_TRAIN || validation.length < MIN_VALIDATION ||
      trainMatches < MIN_TRAIN_MATCHES || validationMatches < MIN_VALIDATION_MATCHES ||
      trainPos < 15 || trainNeg < 15 || valPos < 10 || valNeg < 10) {
    return { status: "WARMUP", counts, metrics: null, weights: null };
  }
  const weights = fit(train);
  const validationMetrics = metrics(validation, weights);
  const lossGain = 1 - validationMetrics.log_loss / validationMetrics.baseline_log_loss;
  const brierGain = 1 - validationMetrics.brier / validationMetrics.baseline_brier;
  const validated = lossGain >= MIN_RELATIVE_LOG_LOSS_GAIN && brierGain >= MIN_RELATIVE_BRIER_GAIN;
  return {
    status: validated ? "SHADOW_VALIDATED" : "NOT_VALIDATED",
    counts,
    metrics: { ...validationMetrics, relative_log_loss_gain: Number(lossGain.toFixed(4)), relative_brier_gain: Number(brierGain.toFixed(4)) },
    validation_policy: { min_train_matches: MIN_TRAIN_MATCHES, min_validation_matches: MIN_VALIDATION_MATCHES, min_relative_log_loss_gain: MIN_RELATIVE_LOG_LOSS_GAIN, min_relative_brier_gain: MIN_RELATIVE_BRIER_GAIN, metrics_weighted_per_match: true },
    weights: validated ? weights : null
  };
}
function run(dataDir = DATA, nowDate = new Date()) {
  const modelPath = path.join(dataDir, MODEL_FILE);
  const existing = readJson(modelPath, null);
  if (existing && (existing.source !== "Flashscore" || existing.mode !== "FORWARD_ONLY_LIVE_TRAINING")) {
    throw new Error("Neplatný LIVE model súbor; odmietam prepísať.");
  }
  const startedAt = existing ? Date.parse(existing.started_at) : nowDate.getTime();
  if (!Number.isFinite(startedAt)) throw new Error("Neplatný čas spustenia LIVE tréningu.");
  const timeline = readTimeline(dataDir, startedAt);
  const outcomes = readJson(path.join(dataDir, "flashscore-confirmed-outcomes.json"), { matches: {} });
  const samples = buildSamples(timeline, outcomes, startedAt);
  const models = {};
  for (const horizon of HORIZONS) models[String(horizon)] = trainHorizon(samples[horizon]);
  const total = HORIZONS.reduce((sum, horizon) => sum + samples[horizon].length, 0);
  const ready = HORIZONS.filter(h => models[String(h)].status === "SHADOW_VALIDATED").length;
  const output = {
    schema_version: 1,
    source: "Flashscore",
    mode: "FORWARD_ONLY_LIVE_TRAINING",
    started_at: new Date(startedAt).toISOString(),
    updated_at: nowDate.toISOString(),
    lag_minutes: LAG_MINUTES,
    horizons_minutes: HORIZONS,
    training_policy: "Only Flashscore snapshots collected at or after started_at are eligible. No historical backfill.",
    validation_policy: {
      min_train_samples: MIN_TRAIN,
      min_validation_samples: MIN_VALIDATION,
      min_train_matches: MIN_TRAIN_MATCHES,
      min_validation_matches: MIN_VALIDATION_MATCHES,
      min_relative_log_loss_gain: MIN_RELATIVE_LOG_LOSS_GAIN,
      min_relative_brier_gain: MIN_RELATIVE_BRIER_GAIN,
      metrics_weighted_per_match: true
    },
    prediction_policy: "Weights stay shadow-only; validation requires at least 50 independent validation matches and improvement in both match-weighted log loss and Brier score.",
    total_labeled_samples: total,
    validated_horizons: ready,
    status: ready ? "SHADOW_VALIDATION_AVAILABLE" : "COLLECTING_LIVE_TRAINING_DATA",
    models
  };
  writeJson(modelPath, output);
  return { started_at: output.started_at, total_labeled_samples: total, status: output.status, models };
}
if (require.main === module) {
  try { console.log("AI EDGE FORWARD-ONLY LIVE TRAINER", JSON.stringify(run())); }
  catch (error) { console.error("AI EDGE LIVE TRAINER FAILED:", error.message); process.exit(1); }
}
module.exports = { finite, isoWeekKey, readTimeline, statValue, featureVector, goalTransitions, labelFor, stableValidationMatch, buildSamples, fit, metrics, trainHorizon, run };

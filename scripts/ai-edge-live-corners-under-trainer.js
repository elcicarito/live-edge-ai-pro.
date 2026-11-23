"use strict";

// Independent forward-only Flashscore model for total match corners UNDER lines.
// Shadow only: no TOP opportunities or betting recommendations.
const fs = require("node:fs");
const path = require("node:path");
const base = require("./ai-edge-live-online-trainer");

const DATA = path.resolve(__dirname, "..", "data");
const MODEL_FILE = "ai-edge-live-corners-under-model.json";
const LAG_MINUTES = 5;
const MINUTE_FROM = 55;
const MINUTE_TO = 75;
const LINES = [
  { key: "UNDER_8_5", line: 8.5, positive: total => total <= 8 },
  { key: "UNDER_9_5", line: 9.5, positive: total => total <= 9 },
  { key: "UNDER_10_5", line: 10.5, positive: total => total <= 10 },
  { key: "UNDER_11_5", line: 11.5, positive: total => total <= 11 }
];
const PATTERNS = {
  corners: /corner kicks|^corners$|total corners/i,
  fouls: /^fouls$/i,
  shots: /^total shots$/i,
  sot: /shots on target/i,
  possession: /ball possession|^possession$/i,
  red: /red cards/i
};
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}
function writeJson(file, value) {
  const temporary = file + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temporary, file);
}
function confirmedRegularCorners(outcome) {
  const statusText = [outcome?.final_match?.status_text, outcome?.final_match?.stage, outcome?.final_match?.status]
    .filter(Boolean).join(" ");
  return outcome?.source === "Flashscore" &&
    outcome?.status === "CONFIRMED" &&
    outcome?.status_confirmation === "confirmed_finished" &&
    outcome?.final_status === "FINISHED" &&
    outcome?.corners_status === "CONFIRMED" &&
    Number.isInteger(outcome?.final_corners?.total_corners) &&
    !/extra.?time|\baet\b|penalt|abandoned|cancelled|postponed|suspended/i.test(statusText);
}
function minuteOf(row) { return base.finite(row?.snapshot?.live_minute); }
function cornerValue(row) { return base.statValue(row?.snapshot?.stats, PATTERNS.corners); }
function stageEligible(stage) {
  return !/(half.?time|\bht\b|finished|full.?time|\bft\b|extra.?time|\baet\b|penalt|abandoned|cancelled|postponed|suspended)/i.test(String(stage || ""));
}
function featureVector(row, previous) {
  const stats = row?.snapshot?.stats || [];
  const currentTime = Date.parse(row?.snapshot?.collected_at || "");
  const previousTime = Date.parse(previous?.snapshot?.collected_at || "");
  const comparisonMinutes = currentTime - previousTime;
  // Never treat an old archive row as a recent activity delta.
  const comparisonReady = Number.isFinite(comparisonMinutes) &&
    comparisonMinutes > 0 && comparisonMinutes <= 12 * 60000;
  const oldStats = comparisonReady ? (previous?.snapshot?.stats || []) : [];
  const corners = base.statValue(stats, PATTERNS.corners);
  const fouls = base.statValue(stats, PATTERNS.fouls);
  const shots = base.statValue(stats, PATTERNS.shots);
  const sot = base.statValue(stats, PATTERNS.sot);
  const possession = base.statValue(stats, PATTERNS.possession);
  const red = base.statValue(stats, PATTERNS.red);
  const oldCorners = base.statValue(oldStats, PATTERNS.corners);
  const oldShots = base.statValue(oldStats, PATTERNS.shots);
  const oldSot = base.statValue(oldStats, PATTERNS.sot);
  const homeScore = base.finite(row?.snapshot?.home_score);
  const awayScore = base.finite(row?.snapshot?.away_score);
  const minute = minuteOf(row);
  if (!corners || homeScore === null || awayScore === null || minute === null) return null;
  const total = value => value ? value.home + value.away : 0;
  const difference = value => value ? value.home - value.away : 0;
  const delta = (now, old) => now && old ? Math.max(0, total(now) - total(old)) : 0;
  return [
    Math.min(1, minute / 90),
    Math.min(1, total(corners) / 20),
    Math.max(-1, Math.min(1, difference(corners) / 10)),
    Math.max(-1, Math.min(1, (homeScore - awayScore) / 5)),
    Math.min(1, total(fouls) / 40),
    Math.max(-1, Math.min(1, difference(fouls) / 25)),
    Math.min(1, total(shots) / 35),
    Math.max(-1, Math.min(1, difference(shots) / 20)),
    Math.min(1, total(sot) / 14),
    Math.max(-1, Math.min(1, difference(sot) / 10)),
    Math.min(1, Math.abs(difference(possession)) / 100),
    Math.min(1, total(red) / 2),
    Math.min(1, delta(corners, oldCorners) / 4),
    Math.min(1, delta(shots, oldShots) / 10),
    Math.min(1, delta(sot, oldSot) / 5),
    Math.max(0, Math.min(1, (90 - minute) / 90)),
    comparisonReady ? 1 : 0
  ];
}
function hasCornerChangeInLag(rows, index, startMinute) {
  const before = cornerValue(rows[index]);
  const sampleMinute = minuteOf(rows[index]);
  if (!before || sampleMinute === null || !Number.isFinite(startMinute)) return true;
  let coveredThroughLag = false;
  for (let i = index + 1; i < rows.length; i++) {
    const from = minuteOf(rows[i - 1]);
    const to = minuteOf(rows[i]);
    if (to === null || to <= sampleMinute) continue;
    const after = cornerValue(rows[i]);
    if (from === null || !after) {
      if (from === null || from < startMinute) return true;
    } else {
      if (after.home < before.home || after.away < before.away) return true;
      if (from < startMinute && (after.home > before.home || after.away > before.away)) return true;
    }
    if (to >= startMinute) { coveredThroughLag = true; break; }
  }
  return !coveredThroughLag;
}
function buildSamples(rows, outcomes, startedAt) {
  const grouped = new Map();
  for (const row of rows) {
    const id = String(row?.match_id || "");
    const timestamp = Date.parse(row?.snapshot?.collected_at || "");
    if (!id || !Number.isFinite(timestamp) || timestamp < startedAt || !stageEligible(row?.snapshot?.stage)) continue;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(row);
  }
  const byLine = Object.fromEntries(LINES.map(line => [line.key, []]));
  const excluded = { missing_final_corners: 0, incomplete_timeline: 0, invalid_corner_sequence: 0, lag_ambiguous: 0 };
  for (const [matchId, matchRows] of grouped) {
    matchRows.sort((a, b) => Date.parse(a.snapshot.collected_at) - Date.parse(b.snapshot.collected_at));
    const outcome = outcomes?.matches?.[matchId.replace(/^flashscore:/, "")];
    if (!confirmedRegularCorners(outcome)) { excluded.missing_final_corners++; continue; }
    const lastMinute = minuteOf(matchRows[matchRows.length - 1]);
    if (lastMinute === null || lastMinute < 90) { excluded.incomplete_timeline++; continue; }
    const finalTotal = outcome.final_corners.total_corners;
    const finalObserved = cornerValue(matchRows[matchRows.length - 1]);
    const finalHome = outcome.final_corners.home_corners;
    const finalAway = outcome.final_corners.away_corners;
    if (!finalObserved || !Number.isInteger(finalHome) || !Number.isInteger(finalAway) ||
        finalHome + finalAway !== finalTotal ||
        finalObserved.home !== finalHome || finalObserved.away !== finalAway) {
      excluded.invalid_corner_sequence++;
      continue;
    }
    let invalidSequence = false;
    for (let i = 1; i < matchRows.length; i++) {
      const a = cornerValue(matchRows[i - 1]), b = cornerValue(matchRows[i]);
      if (a && b && (b.home < a.home || b.away < a.away)) invalidSequence = true;
    }
    if (invalidSequence) { excluded.invalid_corner_sequence++; continue; }
    const chosen = new Map();
    for (let i = 0; i < matchRows.length; i++) {
      const minute = minuteOf(matchRows[i]);
      if (minute === null || minute < MINUTE_FROM || minute > MINUTE_TO) continue;
      if (!featureVector(matchRows[i], matchRows[i - 1])) continue;
      chosen.set(Math.floor(minute / 5) * 5, i);
    }
    for (const [window, index] of chosen) {
      const row = matchRows[index], minute = minuteOf(row);
      if (hasCornerChangeInLag(matchRows, index, minute + LAG_MINUTES)) {
        excluded.lag_ambiguous++;
        continue;
      }
      const x = featureVector(row, matchRows[index - 1]);
      if (!x) continue;
      for (const line of LINES) {
        byLine[line.key].push({
          id: matchId + "|" + row.snapshot.collected_at + "|" + window + "|" + line.key,
          match_id: matchId, x, y: line.positive(finalTotal) ? 1 : 0,
          split: base.stableValidationMatch(matchId) ? "validation" : "train"
        });
      }
    }
  }
  return { byLine, excluded };
}
function summarizeSamples(samples) {
  const matches = new Map();
  for (const sample of samples) {
    const id = String(sample.match_id || "");
    if (!id) continue;
    if (!matches.has(id)) matches.set(id, { split: sample.split, y: sample.y });
  }
  const values = [...matches.values()];
  return {
    samples: samples.length,
    train_samples: samples.filter(sample => sample.split === "train").length,
    validation_samples: samples.filter(sample => sample.split === "validation").length,
    matches: values.length,
    train_matches: values.filter(match => match.split === "train").length,
    validation_matches: values.filter(match => match.split === "validation").length,
    positive_matches: values.filter(match => match.y === 1).length,
    negative_matches: values.filter(match => match.y === 0).length
  };
}
function trainLine(samples) {
  return base.trainCalibratedHorizon(samples);
}
async function run(dataDir = DATA, nowDate = new Date()) {
  const modelPath = path.join(dataDir, MODEL_FILE);
  const existing = readJson(modelPath, null);
  if (existing && (existing.source !== "Flashscore" || existing.mode !== "FORWARD_ONLY_LIVE_CORNERS_UNDER_SHADOW")) {
    throw new Error("Neplatný samostatný corners model; odmietam prepísať.");
  }
  const startedAt = existing ? Date.parse(existing.started_at) : nowDate.getTime();
  if (!Number.isFinite(startedAt)) throw new Error("Neplatný čas aktivácie corners tréningu.");
  const timeline = await base.readTimeline(dataDir, startedAt);
  const outcomes = readJson(path.join(dataDir, "flashscore-confirmed-outcomes.json"), { matches: {} });
  const built = buildSamples(timeline, outcomes, startedAt);
  const models = {};
  for (const line of LINES) models[line.key] = trainLine(built.byLine[line.key]);
  const ready = LINES.filter(line => models[line.key].status === "SHADOW_VALIDATED").length;
  const total = LINES.reduce((sum, line) => sum + built.byLine[line.key].length, 0);
  const datasetSummary = Object.fromEntries(LINES.map(line => [line.key, summarizeSamples(built.byLine[line.key])]));
  const output = {
    schema_version: 1, source: "Flashscore", mode: "FORWARD_ONLY_LIVE_CORNERS_UNDER_SHADOW",
    started_at: new Date(startedAt).toISOString(), updated_at: nowDate.toISOString(),
    target: "Final total match corners (home + away) UNDER during regular time including stoppage; extra time and penalties excluded.",
    lag_minutes: LAG_MINUTES, observation_minute_range: [MINUTE_FROM, MINUTE_TO],
    lines: LINES.map(({ key, line }) => ({ key, side: "UNDER", line })),
    training_policy: "Only snapshots captured at or after activation. One latest sample per five-minute decision window. Requires confirmed final Flashscore corners, a complete regular-time timeline, monotonic corner totals and full five-minute lag coverage. No historical backfill.",
    feature_policy: "Recent activity deltas are calculated only from the same match's previous snapshot when its timestamp is 1-12 minutes older; otherwise deltas are zero and the final feature marks comparison unavailable. This prevents stale snapshots from masquerading as current pace.",
    validation_policy: { min_train_samples: 500, min_validation_samples: 300, min_train_matches: 100, min_validation_matches: 50, min_calibration_matches: 30,
      min_relative_log_loss_gain: 0.01, min_relative_brier_gain: 0.005,
      min_effective_match_weight_per_calibration_bin: 8, max_absolute_calibration_error: 0.08, metrics_weighted_per_match: true },
    prediction_policy: "Shadow evaluation only. No TOP opportunities or betting recommendations are emitted.",
    total_labeled_samples: total, dataset_summary: datasetSummary,
    total_labeled_matches: new Set(LINES.flatMap(line => built.byLine[line.key].map(sample => sample.match_id))).size,
    excluded: built.excluded, validated_lines: ready,
    status: ready ? "SHADOW_VALIDATION_AVAILABLE" : "COLLECTING_OR_NOT_VALIDATED", models
  };
  writeJson(modelPath, output);
  return { started_at: output.started_at, total_labeled_samples: total, validated_lines: ready, status: output.status, excluded: output.excluded };
}
if (require.main === module) run().then(result => console.log("AI EDGE LIVE CORNERS UNDER SHADOW TRAINER", JSON.stringify(result)))
  .catch(error => { console.error("AI EDGE LIVE CORNERS TRAINER FAILED:", error.message); process.exit(1); });
module.exports = { LINES, confirmedRegularCorners, minuteOf, cornerValue, featureVector, hasCornerChangeInLag, buildSamples, summarizeSamples, trainLine, run };

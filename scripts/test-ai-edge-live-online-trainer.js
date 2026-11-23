"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { featureVector, goalTransitions, labelFor, buildSamples, trainHorizon, calibration, calibrationGate, metrics, fit, fitPlattCalibration, predictProbability, run, readTimeline } = require("./ai-edge-live-online-trainer");

const started = Date.parse("2026-11-12T21:00:00.000Z");
const stats = (minute, goal) => [
  { label: "Expected goals (xG)", period: "Match", home: 0.3 + minute / 100, away: 0.2, home_numeric: 0.3 + minute / 100, away_numeric: 0.2 },
  { label: "Shots on target", period: "Match", home: Math.floor(minute / 12) + (goal ? 1 : 0), away: Math.floor(minute / 18), home_numeric: Math.floor(minute / 12) + (goal ? 1 : 0), away_numeric: Math.floor(minute / 18) },
  { label: "Total shots", period: "Match", home: Math.floor(minute / 6) + (goal ? 1 : 0), away: Math.floor(minute / 9), home_numeric: Math.floor(minute / 6) + (goal ? 1 : 0), away_numeric: Math.floor(minute / 9) },
  { label: "Corner kicks", period: "Match", home: Math.floor(minute / 15), away: Math.floor(minute / 22) },
  { label: "Big chances", period: "Match", home: goal ? 2 : 0, away: 0 },
  { label: "Ball possession", period: "Match", home: 56, away: 44 }
];
function matchRows(id, positive, timeOffset = 0) {
  const rows = [];
  for (let minute = 10; minute <= 90; minute += 5) {
    const scored = positive && minute >= 50 ? 1 : 0;
    const snapshot = {
      collected_at: new Date(started + timeOffset + (Number(id.replace(/\D/g, "")) * 1000) + minute * 60000).toISOString(),
      live_minute: minute, stage: "2nd Half", home_score: scored, away_score: 0,
      stats: stats(minute, positive && minute >= 45)
    };
    rows.push({ match_id: id, home: "Home", away: "Away", snapshot });
  }
  return rows;
}
const tiny = matchRows("flashscore:tiny", true);
assert.ok(featureVector(tiny[1], tiny[0]), "live stats produce a feature vector");

const staleCurrent = {
  match_id: "flashscore:delta-check",
  snapshot: { collected_at: "2026-11-22T12:30:00.000Z", live_minute: 30, stage: "2nd Half", home_score: 0, away_score: 0, stats: stats(30, false) }
};
const stalePrevious = {
  match_id: "flashscore:delta-check",
  snapshot: { collected_at: "2026-11-22T12:15:00.000Z", live_minute: 15, stage: "1st Half", home_score: 0, away_score: 0, stats: stats(15, false) }
};
const staleDeltaVector = featureVector(staleCurrent, stalePrevious);
assert.equal(staleDeltaVector[13], 0, "stale prior SOT snapshot cannot create recent activity");
assert.equal(staleDeltaVector[14], 0, "stale prior shots snapshot cannot create recent activity");
assert.equal(staleDeltaVector[15], 0, "stale prior corners snapshot cannot create recent activity");
const recentPrevious = {
  match_id: "flashscore:delta-check",
  snapshot: { ...stalePrevious.snapshot, collected_at: "2026-11-22T12:25:00.000Z" }
};
const recentDeltaVector = featureVector(staleCurrent, recentPrevious);
assert.ok(recentDeltaVector[13] > 0, "recent prior SOT snapshot preserves valid activity delta");
assert.ok(recentDeltaVector[14] > 0, "recent prior shots snapshot preserves valid activity delta");
assert.ok(recentDeltaVector[15] > 0, "recent prior corners snapshot preserves valid activity delta");

const transitions = goalTransitions(tiny);
assert.equal(transitions.invalid, false);
assert.equal(transitions.transitions.length, 1);
const confirmed = { source: "Flashscore", status: "CONFIRMED", status_confirmation: "confirmed_finished", final_status: "FINISHED", final_match: { status_text: "Finished" } };
assert.equal(labelFor(tiny[4], tiny, transitions.transitions, confirmed, 15), 1, "goal after delay inside horizon is positive");
assert.equal(labelFor(tiny[7], tiny, transitions.transitions, confirmed, 15), null, "goal in delay is excluded");

const allRows = [];
const matches = {};
for (let i = 0; i < 100; i++) {
  const id = "flashscore:live-match-" + i, positive = i < 50;
  allRows.push(...matchRows(id, positive));
  matches[id.replace("flashscore:", "")] = { ...confirmed, home_score: positive ? 1 : 0, away_score: 0 };
}
const samples = buildSamples(allRows, { matches }, started);
assert.ok(samples[15].length > 0 && samples[25].length > 0, "both horizons build from post-start live captures");
assert.ok(samples[15].every(row => row.match_id.startsWith("flashscore:")));
const earlyValidation = trainHorizon(samples[15]);
assert.equal(earlyValidation.status, "WARMUP", "a small validation set must never be promoted");
assert.ok(earlyValidation.counts.validation_matches < 50, "fixture intentionally has fewer than 50 independent validation matches");
const weightedCheck = metrics([
  { match_id: "match-a", x: Array(16).fill(0), y: 1 },
  { match_id: "match-a", x: Array(16).fill(0), y: 1 },
  { match_id: "match-b", x: Array(16).fill(0), y: 0 }
], Array(17).fill(0));
assert.equal(weightedCheck.matches, 2, "validation reports independent match count");
assert.equal(weightedCheck.baseline_brier, 0.25, "baseline Brier score is match-weighted");
assert.equal(weightedCheck.calibration.expected_calibration_error, 0, "perfectly matched 50% predictions have zero ECE");
assert.equal(weightedCheck.calibration.populated_bins, 1, "calibration groups predictions into probability bins");
assert.equal(weightedCheck.calibration.bins[0].observed_rate, 0.5, "calibration observed rate uses equal match weighting");
const duplicatedMatchRows = [
  { match_id: "same-a", x: [1, ...Array(15).fill(0)], y: 1 },
  { match_id: "same-a", x: [1, ...Array(15).fill(0)], y: 1 },
  { match_id: "same-a", x: [1, ...Array(15).fill(0)], y: 1 },
  { match_id: "same-b", x: [0, ...Array(15).fill(0)], y: 0 }
];
const uniqueMatchRows = [
  { match_id: "same-a", x: [1, ...Array(15).fill(0)], y: 1 },
  { match_id: "same-b", x: [0, ...Array(15).fill(0)], y: 0 }
];
assert.deepEqual(fit(duplicatedMatchRows), fit(uniqueMatchRows),
  "training gives each match equal total weight regardless of snapshot count");
const calibrated = calibration([
  { match_id: "cal-a", x: Array(16).fill(0), y: 1 },
  { match_id: "cal-b", x: Array(16).fill(0), y: 0 }
], Array(17).fill(0));
assert.equal(calibrated.expected_calibration_error, 0, "calibration handles a balanced validation set");
assert.equal(calibrated.bins[0].mean_predicted, 0.5);


const reliableCalibrationPass = calibrationGate({ bins: [
  { matches_weight: 12, absolute_error: 0.04 },
  { matches_weight: 9, absolute_error: 0.08 },
  { matches_weight: 2, absolute_error: 0.35 }
] });
assert.equal(reliableCalibrationPass.passed, true, "two well-calibrated bins allow selective validation while weak bins abstain");
const reliableCalibrationFail = calibrationGate({ bins: [
  { matches_weight: 12, absolute_error: 0.04 },
  { matches_weight: 11, absolute_error: 0.167 }
] });
assert.equal(reliableCalibrationFail.passed, false, "one good bin is not enough for selective validation");
assert.equal(reliableCalibrationFail.failed_bins, 1);
const selectiveCalibration = calibrationGate({ bins: [
  { range: "50-60", matches_weight: 84, absolute_error: 0.0144 },
  { range: "60-70", matches_weight: 78, absolute_error: 0.0158 },
  { range: "70-80", matches_weight: 11, absolute_error: 0.1516 },
  { range: "80-90", matches_weight: 0.03, absolute_error: 0.1995 }
] });
assert.equal(selectiveCalibration.passed, true, "two calibrated 50-60 and 60-70 bands validate selectively despite a blocked 70-80 band");
assert.equal(selectiveCalibration.passing_bins, 2);
assert.equal(selectiveCalibration.failed_bins, 1);
assert.equal(calibrationGate({ bins: [{ matches_weight: 7.9, absolute_error: 0.01 }] }).passed, false,
  "no sufficiently weighted calibration bin means no validation");

// Independent Platt calibration must correct systematic overconfidence without using validation rows.
const calibrationRows = [];
for (let i = 0; i < 400; i++) {
  const x = [-2, -1, 1, 2][i % 4];
  const target = 1 / (1 + Math.exp(-(-0.15 + 0.45 * x)));
  const fraction = (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;
  calibrationRows.push({ match_id: "calibration-match-" + i, x: [x], y: fraction < target ? 1 : 0 });
}
const platt = fitPlattCalibration(calibrationRows, [0, 1]);
assert.ok(platt && platt.method === "platt_train_match_holdout");
assert.ok(platt.slope > 0.1 && platt.slope < 1.2, "Platt slope should reduce overconfident raw logits");
const rawProbability = 1 / (1 + Math.exp(-2));
const calibratedProbability = predictProbability([0, 1], [2], platt);
assert.ok(calibratedProbability < rawProbability, "calibrated probability should be less extreme for an overconfident model");
assert.ok(calibratedProbability > 0 && calibratedProbability < 1);
const calibratedMetrics = metrics(calibrationRows, [0, 1], platt);
assert.ok(calibratedMetrics.calibration && calibratedMetrics.calibration.bin_count === 10);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-edge-live-trainer-"));
async function main() {
try {
  const week = "2026-W46";
  const timelinePath = path.join(temp, "flashscore-match-timeline-" + week + ".jsonl.gz");
  fs.writeFileSync(timelinePath, zlib.gzipSync(allRows.map(row => JSON.stringify(row)).join("\n") + "\n"));
  fs.writeFileSync(path.join(temp, "flashscore-timeline-index.json"), JSON.stringify({ source: "Flashscore", weeks: [{ week, file: path.basename(timelinePath) }] }));
  fs.writeFileSync(path.join(temp, "flashscore-confirmed-outcomes.json"), JSON.stringify({ matches }));
  const activation = started + 2 * 60 * 60 * 1000;
  const first = await run(temp, new Date(activation));
  assert.equal(first.total_labeled_samples, 0, "first run excludes snapshots captured before activation");
  const futureRows = [];
  for (let i = 100; i < 200; i++) {
    const id = "flashscore:live-match-" + i, positive = i < 150;
    futureRows.push(...matchRows(id, positive, 3 * 60 * 60 * 1000));
    matches[id.replace("flashscore:", "")] = { ...confirmed, home_score: positive ? 1 : 0, away_score: 0 };
  }
  fs.writeFileSync(timelinePath, zlib.gzipSync(allRows.concat(futureRows).map(row => JSON.stringify(row)).join("\n") + "\n"));
  fs.writeFileSync(path.join(temp, "flashscore-confirmed-outcomes.json"), JSON.stringify({ matches }));
  const second = await run(temp, new Date(activation + 1));
  assert.ok(second.total_labeled_samples > 0, "later run trains only from captures after activation");
  const model = JSON.parse(fs.readFileSync(path.join(temp, "ai-edge-live-model.json"), "utf8"));
  assert.equal(model.mode, "FORWARD_ONLY_LIVE_TRAINING");
  assert.equal(model.lag_minutes, 5);
  assert.equal(model.started_at, new Date(activation).toISOString());
  assert.ok(model.training_policy.includes("No historical backfill"));
  assert.equal(model.calibration_policy.min_effective_match_weight, 8);
  assert.equal(model.calibration_policy.max_absolute_error, 0.08);
  for (const horizon of [15, 25]) {
    const result = model.models[String(horizon)];
    if (result.metrics) {
      const cal = result.metrics.calibration;
      assert.ok(cal && cal.bin_count === 10, "each trained horizon stores ten-bin validation calibration");
      assert.ok(cal.expected_calibration_error >= 0 && cal.expected_calibration_error <= 1, "ECE stays within probability bounds");
    } else {
      assert.equal(result.status, "WARMUP", "insufficient independent validation matches must remain in warmup");
    }
  }
  const streamed = await readTimeline(temp, activation);
  assert.ok(streamed.length >= allRows.length + futureRows.length, "gzip JSONL timeline is streamed and parsed line by line");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log("AI Edge forward-only LIVE trainer tests passed.");
}
main().catch(error => { console.error(error); process.exit(1); });

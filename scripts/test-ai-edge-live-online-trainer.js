"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { featureVector, goalTransitions, labelFor, buildSamples, trainHorizon, metrics, run } = require("./ai-edge-live-online-trainer");

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

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-edge-live-trainer-"));
try {
  const week = "2026-W46";
  const timelinePath = path.join(temp, "flashscore-match-timeline-" + week + ".jsonl.gz");
  fs.writeFileSync(timelinePath, zlib.gzipSync(allRows.map(row => JSON.stringify(row)).join("\n") + "\n"));
  fs.writeFileSync(path.join(temp, "flashscore-timeline-index.json"), JSON.stringify({ source: "Flashscore", weeks: [{ week, file: path.basename(timelinePath) }] }));
  fs.writeFileSync(path.join(temp, "flashscore-confirmed-outcomes.json"), JSON.stringify({ matches }));
  const activation = started + 2 * 60 * 60 * 1000;
  const first = run(temp, new Date(activation));
  assert.equal(first.total_labeled_samples, 0, "first run excludes snapshots captured before activation");
  const futureRows = [];
  for (let i = 100; i < 200; i++) {
    const id = "flashscore:live-match-" + i, positive = i < 150;
    futureRows.push(...matchRows(id, positive, 3 * 60 * 60 * 1000));
    matches[id.replace("flashscore:", "")] = { ...confirmed, home_score: positive ? 1 : 0, away_score: 0 };
  }
  fs.writeFileSync(timelinePath, zlib.gzipSync(allRows.concat(futureRows).map(row => JSON.stringify(row)).join("\n") + "\n"));
  fs.writeFileSync(path.join(temp, "flashscore-confirmed-outcomes.json"), JSON.stringify({ matches }));
  const second = run(temp, new Date(activation + 1));
  assert.ok(second.total_labeled_samples > 0, "later run trains only from captures after activation");
  const model = JSON.parse(fs.readFileSync(path.join(temp, "ai-edge-live-model.json"), "utf8"));
  assert.equal(model.mode, "FORWARD_ONLY_LIVE_TRAINING");
  assert.equal(model.lag_minutes, 5);
  assert.equal(model.started_at, new Date(activation).toISOString());
  assert.ok(model.training_policy.includes("No historical backfill"));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log("AI Edge forward-only LIVE trainer tests passed.");

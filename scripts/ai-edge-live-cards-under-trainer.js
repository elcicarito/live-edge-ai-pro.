"use strict";

// Independent forward-only Flashscore model for full-match total yellow cards.
// Predictions are binary probabilities for fixed O/U lines; no tips are emitted here.
const fs = require("node:fs");
const path = require("node:path");
const base = require("./ai-edge-live-online-trainer");

const DATA = path.resolve(__dirname, "..", "data");
const MODEL_FILE = "ai-edge-live-cards-under-model.json";
const LAG_MINUTES = 5;
const MINUTE_FROM = 55;
const MINUTE_TO = 80;
const LINES = [
  { key: "UNDER_3_5", side: "UNDER", line: 3.5, positive: total => total <= 3 },
  { key: "UNDER_4_5", side: "UNDER", line: 4.5, positive: total => total <= 4 },
  { key: "UNDER_5_5", side: "UNDER", line: 5.5, positive: total => total <= 5 },
  { key: "OVER_2_5", side: "OVER", line: 2.5, positive: total => total >= 3 },
  { key: "OVER_3_5", side: "OVER", line: 3.5, positive: total => total >= 4 },
  { key: "OVER_4_5", side: "OVER", line: 4.5, positive: total => total >= 5 }
];
const PATTERNS = {
  cards: /yellow cards?/i,
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
function confirmedRegularCards(outcome) {
  const statusText = [outcome?.final_match?.status_text, outcome?.final_match?.stage, outcome?.final_match?.status]
    .filter(Boolean).join(" ");
  return outcome?.source === "Flashscore" &&
    outcome?.status === "CONFIRMED" &&
    outcome?.status_confirmation === "confirmed_finished" &&
    outcome?.final_status === "FINISHED" &&
    outcome?.yellow_cards_status === "CONFIRMED" &&
    Number.isInteger(outcome?.final_yellow_cards?.total_yellow_cards) &&
    !/extra.?time|\baet\b|penalt|abandoned|cancelled|postponed|suspended/i.test(statusText);
}
function minuteOf(row) { return base.finite(row?.snapshot?.live_minute); }
function cardValue(row) {
  return base.statValue(row?.snapshot?.stats, PATTERNS.cards);
}
function stageEligible(stage) {
  return !/(half.?time|\bht\b|finished|full.?time|\bft\b|extra.?time|\baet\b|penalt|abandoned|cancelled|postponed|suspended)/i.test(String(stage || ""));
}
function featureVector(row, previous) {
  const stats = row?.snapshot?.stats || [];
  const currentTime = Date.parse(row?.snapshot?.collected_at || "");
  const previousTime = Date.parse(previous?.snapshot?.collected_at || "");
  const comparisonMinutes = currentTime - previousTime;
  // Only use a prior snapshot as a live delta when it is genuinely recent.
  // Older archive rows must not masquerade as recent card/foul/shot activity.
  const comparisonReady = Number.isFinite(comparisonMinutes) &&
    comparisonMinutes > 0 && comparisonMinutes <= 12 * 60000;
  const oldStats = comparisonReady ? (previous?.snapshot?.stats || []) : [];
  const cards = base.statValue(stats, PATTERNS.cards);
  const fouls = base.statValue(stats, PATTERNS.fouls);
  const shots = base.statValue(stats, PATTERNS.shots);
  const sot = base.statValue(stats, PATTERNS.sot);
  const possession = base.statValue(stats, PATTERNS.possession);
  const red = base.statValue(stats, PATTERNS.red);
  const oldCards = base.statValue(oldStats, PATTERNS.cards);
  const oldFouls = base.statValue(oldStats, PATTERNS.fouls);
  const oldShots = base.statValue(oldStats, PATTERNS.shots);
  const scoreHome = base.finite(row?.snapshot?.home_score);
  const scoreAway = base.finite(row?.snapshot?.away_score);
  const score = scoreHome === null || scoreAway === null ? null : [scoreHome, scoreAway];
  const minute = minuteOf(row);
  if (!cards || !score || minute === null) return null;
  const total = value => value ? value.home + value.away : 0;
  const difference = value => value ? value.home - value.away : 0;
  const delta = (now, old) => now && old ? Math.max(0, total(now) - total(old)) : 0;
  return [
    Math.min(1, minute / 90),
    Math.min(1, total(cards) / 8),
    Math.max(-1, Math.min(1, difference(cards) / 6)),
    Math.max(-1, Math.min(1, (score[0] - score[1]) / 5)),
    Math.min(1, total(fouls) / 40),
    Math.max(-1, Math.min(1, difference(fouls) / 25)),
    Math.min(1, total(shots) / 35),
    Math.max(-1, Math.min(1, difference(shots) / 20)),
    Math.min(1, total(sot) / 14),
    Math.max(-1, Math.min(1, difference(sot) / 10)),
    Math.min(1, Math.abs(difference(possession)) / 100),
    Math.min(1, total(red) / 2),
    Math.min(1, delta(cards, oldCards) / 2),
    Math.min(1, delta(fouls, oldFouls) / 10),
    Math.min(1, delta(shots, oldShots) / 10),
    Math.max(0, Math.min(1, (90 - minute) / 90))
  ];
}
function hasCardChangeInLag(rows, index, startMinute) {
  const before = cardValue(rows[index]);
  const sampleMinute = minuteOf(rows[index]);
  if (!before || sampleMinute === null || !Number.isFinite(startMinute)) return true;
  let coveredThroughLag = false;
  for (let i = index + 1; i < rows.length; i++) {
    const from = minuteOf(rows[i - 1]);
    const to = minuteOf(rows[i]);
    if (to === null || to <= sampleMinute) continue;
    const after = cardValue(rows[i]);
    // Missing card statistics inside the effective-lag window make the event timing unknowable.
    if (from === null || !after) {
      if (from === null || from < startMinute) return true;
    } else {
      if (after.home < before.home || after.away < before.away) return true;
      // If a card count rose before the lag elapsed, the displayed sample may already be stale.
      if (from < startMinute && (after.home > before.home || after.away > before.away)) return true;
    }
    if (to >= startMinute) {
      coveredThroughLag = true;
      break;
    }
  }
  // Never accept a sample unless the timeline actually reaches the end of its five-minute lag.
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
  let excluded = { missing_final_cards: 0, incomplete_timeline: 0, invalid_card_sequence: 0, lag_ambiguous: 0 };
  for (const [matchId, matchRows] of grouped) {
    matchRows.sort((a, b) => Date.parse(a.snapshot.collected_at) - Date.parse(b.snapshot.collected_at));
    const outcome = outcomes?.matches?.[matchId.replace(/^flashscore:/, "")];
    if (!confirmedRegularCards(outcome)) { excluded.missing_final_cards++; continue; }
    const lastMinute = minuteOf(matchRows[matchRows.length - 1]);
    if (lastMinute === null || lastMinute < 90) { excluded.incomplete_timeline++; continue; }
    const finalTotal = outcome.final_yellow_cards.total_yellow_cards;
    const finalObservedCards = cardValue(matchRows[matchRows.length - 1]);
    const finalHomeCards = outcome.final_yellow_cards.home_yellow_cards;
    const finalAwayCards = outcome.final_yellow_cards.away_yellow_cards;
    if (!finalObservedCards || !Number.isInteger(finalHomeCards) || !Number.isInteger(finalAwayCards) ||
        finalHomeCards + finalAwayCards !== finalTotal ||
        finalObservedCards.home !== finalHomeCards || finalObservedCards.away !== finalAwayCards) {
      excluded.invalid_card_sequence++;
      continue;
    }
    let invalidSequence = false;
    for (let i = 1; i < matchRows.length; i++) {
      const a = cardValue(matchRows[i - 1]), b = cardValue(matchRows[i]);
      if (a && b && (b.home < a.home || b.away < a.away)) invalidSequence = true;
    }
    if (invalidSequence) { excluded.invalid_card_sequence++; continue; }
    const chosen = new Map();
    for (let i = 0; i < matchRows.length; i++) {
      const row = matchRows[i];
      const minute = minuteOf(row);
      if (minute === null || minute < MINUTE_FROM || minute > MINUTE_TO) continue;
      const x = featureVector(row, matchRows[i - 1]);
      if (!x) continue;
      const window = Math.floor(minute / 5) * 5;
      chosen.set(window, i);
    }
    for (const [window, index] of chosen) {
      const row = matchRows[index];
      const minute = minuteOf(row);
      if (hasCardChangeInLag(matchRows, index, minute + LAG_MINUTES)) {
        excluded.lag_ambiguous++;
        continue;
      }
      const current = cardValue(row);
      if (!current) continue;
      const x = featureVector(row, matchRows[index - 1]);
      for (const line of LINES) {
        byLine[line.key].push({
          id: matchId + "|" + row.snapshot.collected_at + "|" + window + "|" + line.key,
          match_id: matchId,
          x,
          y: line.positive(finalTotal) ? 1 : 0,
          split: base.stableValidationMatch(matchId) ? "validation" : "train"
        });
      }
    }
  }
  return { byLine, excluded };
}
function trainLine(samples) {
  return base.trainCalibratedHorizon(samples);
}
async function run(dataDir = DATA, nowDate = new Date()) {
  const modelPath = path.join(dataDir, MODEL_FILE);
  const existing = readJson(modelPath, null);
  if (existing && (existing.source !== "Flashscore" || existing.mode !== "FORWARD_ONLY_LIVE_CARDS_SHADOW")) {
    throw new Error("Neplatný samostatný cards model; odmietam prepísať.");
  }
  const startedAt = existing ? Date.parse(existing.started_at) : nowDate.getTime();
  if (!Number.isFinite(startedAt)) throw new Error("Neplatný čas aktivácie cards tréningu.");
  const timeline = await base.readTimeline(dataDir, startedAt);
  const outcomes = readJson(path.join(dataDir, "flashscore-confirmed-outcomes.json"), { matches: {} });
  const built = buildSamples(timeline, outcomes, startedAt);
  const models = {};
  for (const line of LINES) models[line.key] = trainLine(built.byLine[line.key]);
  const ready = LINES.filter(line => models[line.key].status === "SHADOW_VALIDATED").length;
  const total = LINES.reduce((sum, line) => sum + built.byLine[line.key].length, 0);
  const output = {
    schema_version: 1,
    source: "Flashscore",
    mode: "FORWARD_ONLY_LIVE_CARDS_SHADOW",
    started_at: new Date(startedAt).toISOString(),
    updated_at: nowDate.toISOString(),
    target: "Final total yellow cards in regular time (90 minutes plus stoppage time); extra time and penalty shootouts excluded.",
    lag_minutes: LAG_MINUTES,
    observation_minute_range: [MINUTE_FROM, MINUTE_TO],
    lines: LINES.map(({ key, side, line }) => ({ key, side, line })),
    training_policy: "Only snapshots captured at or after activation are eligible. One latest observation per five-minute decision window. Matches without confirmed full-time yellow-card totals, incomplete timelines, decreasing card sequences or a card event inside the five-minute effective lag are excluded. No historical backfill.",
    validation_policy: {
      min_train_samples: 500, min_validation_samples: 300,
      min_train_matches: 100, min_validation_matches: 50, min_calibration_matches: 30,
      min_relative_log_loss_gain: 0.01, min_relative_brier_gain: 0.005,
      min_effective_match_weight_per_calibration_bin: 8,
      max_absolute_calibration_error: 0.08,
      metrics_weighted_per_match: true
    },
    prediction_policy: "Shadow evaluation only. No TOP opportunities or betting recommendations are emitted by this trainer.",
    total_labeled_samples: total,
    total_labeled_matches: new Set(LINES.flatMap(line => built.byLine[line.key].map(sample => sample.match_id))).size,
    excluded: built.excluded,
    validated_lines: ready,
    status: ready ? "SHADOW_VALIDATION_AVAILABLE" : "COLLECTING_OR_NOT_VALIDATED",
    models
  };
  writeJson(modelPath, output);
  return { started_at: output.started_at, total_labeled_samples: total, validated_lines: ready, status: output.status, excluded: output.excluded };
}
if (require.main === module) run().then(result => console.log("AI EDGE LIVE CARDS SHADOW TRAINER", JSON.stringify(result)))
  .catch(error => { console.error("AI EDGE LIVE CARDS TRAINER FAILED:", error.message); process.exit(1); });
module.exports = { LINES, confirmedRegularCards, minuteOf, cardValue, featureVector, hasCardChangeInLag, buildSamples, trainLine, run };

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const DATA = path.resolve(__dirname, "..", "data");
const OBSERVATIONS_PATH = path.join(DATA, "flashscore-live-observations.jsonl.gz");
const STATUS_PATH = path.join(DATA, "flashscore-live-observations-status.json");
const OUTCOMES_PATH = path.join(DATA, "flashscore-confirmed-outcomes.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function resultOf(home, away) {
  return home > away ? "HOME" : home < away ? "AWAY" : "DRAW";
}
function labelObservations(observations, outcomes) {
  const labels = {
    confirmed: 0,
    pending: 0,
    excluded_penalties: 0,
    excluded_finished_snapshot: 0,
    excluded_score_inconsistency: 0,
    excluded_invalid_outcome: 0
  };
  const matches = outcomes?.matches && typeof outcomes.matches === "object" ? outcomes.matches : {};
  const labeled = observations.map(row => {
    const copy = { ...row };
    delete copy.labels;
    delete copy.label_horizon;
    delete copy.outcome_confirmed_at;
    delete copy.outcome_revision_count;
    const rawId = String(row.match_id || "").replace(/^flashscore:/, "");
    const outcome = matches[rawId];
    if (!outcome || outcome.status !== "CONFIRMED" ||
        outcome.status_confirmation !== "confirmed_finished" ||
        outcome.final_status !== "FINISHED") {
      copy.label_status = "AWAITING_CONFIRMED_FLASHSCORE_OUTCOME";
      labels.pending++;
      return copy;
    }

    const finalHome = finite(outcome.home_score);
    const finalAway = finite(outcome.away_score);
    const snapshotHome = finite(row.score?.home);
    const snapshotAway = finite(row.score?.away);
    const finalText = String(outcome.final_match?.status_text || "");
    const stage = String(row.stage || "");
    copy.outcome_confirmed_at = outcome.confirmed_at || null;
    copy.outcome_revision_count = Array.isArray(outcome.revisions) ? outcome.revisions.length : 0;

    if (/penalt/i.test(finalText) || /penalt/i.test(stage)) {
      copy.label_status = "EXCLUDED_PENALTY_SHOOTOUT_SCORE";
      labels.excluded_penalties++;
      return copy;
    }
    if (/finished|full.?time|\bft\b/i.test(stage)) {
      copy.label_status = "EXCLUDED_FINISHED_SNAPSHOT";
      labels.excluded_finished_snapshot++;
      return copy;
    }
    if (finalHome === null || finalAway === null || snapshotHome === null || snapshotAway === null ||
        finalHome < snapshotHome || finalAway < snapshotAway) {
      copy.label_status = "EXCLUDED_SCORE_INCONSISTENCY";
      labels.excluded_score_inconsistency++;
      return copy;
    }

    const remainingHome = finalHome - snapshotHome;
    const remainingAway = finalAway - snapshotAway;
    copy.label_status = "CONFIRMED_FLASHSCORE_OUTCOME";
    copy.label_horizon = "REMAINDER_OF_MATCH";
    copy.labels = {
      final_home_score: finalHome,
      final_away_score: finalAway,
      final_total_goals: finalHome + finalAway,
      final_result: resultOf(finalHome, finalAway),
      remaining_home_goals: remainingHome,
      remaining_away_goals: remainingAway,
      remaining_total_goals: remainingHome + remainingAway,
      remaining_goal_result: resultOf(remainingHome, remainingAway)
    };
    labels.confirmed++;
    return copy;
  });
  const confirmedRows = labeled.filter(row => row.label_status === "CONFIRMED_FLASHSCORE_OUTCOME");
  const byMatch = new Map();
  for (const row of confirmedRows) {
    const key = row.match_id || row.observation_id;
    if (!byMatch.has(key)) byMatch.set(key, { observations: 0, with_stats: 0, final_result: row.labels.final_result });
    const item = byMatch.get(key);
    item.observations++;
    if (row.stats_available && row.stats_count > 0 && Object.keys(row.features || {}).length > 0) item.with_stats++;
  }
  const matchQuality = {
    confirmed_matches: byMatch.size,
    confirmed_matches_with_stats: [...byMatch.values()].filter(item => item.with_stats > 0).length,
    confirmed_matches_without_stats: [...byMatch.values()].filter(item => item.with_stats === 0).length,
    confirmed_matches_with_stats_coverage: byMatch.size ? Number(([...byMatch.values()].filter(item => item.with_stats > 0).length / byMatch.size).toFixed(4)) : 0,
    final_result_distribution_by_match: [...byMatch.values()].reduce((acc, item) => {
      acc[item.final_result] = (acc[item.final_result] || 0) + 1;
      return acc;
    }, {}),
    confirmed_observations_with_stats: confirmedRows.filter(row => row.stats_available && row.stats_count > 0 && Object.keys(row.features || {}).length > 0).length
  };
  return { observations: labeled, counts: labels, matchQuality };
}
function parseJsonlGzip(buffer) {
  const text = zlib.gunzipSync(buffer).toString("utf8").trim();
  return text ? text.split(/\r?
/).map(line => JSON.parse(line)) : [];
}
function main(dataDir = DATA) {
  const observationsPath = path.join(dataDir, "flashscore-live-observations.jsonl.gz");
  const statusPath = path.join(dataDir, "flashscore-live-observations-status.json");
  const outcomesPath = path.join(dataDir, "flashscore-confirmed-outcomes.json");
  const observations = parseJsonlGzip(fs.readFileSync(observationsPath));
  const outcomes = readJson(outcomesPath);
  const result = labelObservations(observations, outcomes);
  const jsonl = result.observations.map(row => JSON.stringify(row)).join("
");
  const temporary = observationsPath + ".tmp";
  fs.writeFileSync(temporary, zlib.gzipSync(jsonl ? jsonl + "
" : ""));
  fs.renameSync(temporary, observationsPath);
  const status = readJson(statusPath);
  status.label_updated_at = new Date().toISOString();
  status.label_counts = result.counts;
  status.training_eligible_observations = result.counts.confirmed;
  status.label_match_quality = result.matchQuality;
  status.training_ready = false;
  status.training_readiness_note = "Confirmed labels are attached only to explicitly finished Flashscore matches. Dataset quality and minimum sample thresholds must be validated separately before model training.";
  const statusTemporary = statusPath + ".tmp";
  fs.writeFileSync(statusTemporary, JSON.stringify(status, null, 2) + "
");
  fs.renameSync(statusTemporary, statusPath);
  console.log("FLASHSCORE CONFIRMED LABELS:", JSON.stringify(result.counts));
  console.log("FLASHSCORE LABEL MATCH QUALITY:", JSON.stringify(result.matchQuality));
}
if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error("FLASHSCORE CONFIRMED LABELING FAILED:", error.message);
    process.exit(1);
  }
}
module.exports = { finite, resultOf, labelObservations, parseJsonlGzip, main };

"use strict";
const fs = require("fs");
const zlib = require("zlib");
const OBSERVATIONS_PATH = "data/live-prediction-observations.jsonl.gz";
const OUTCOMES_PATH = "data/live-prediction-outcomes.jsonl.gz";
const DATASET_PATH = "data/live-prediction-training.jsonl.gz";
const STATUS_PATH = "data/live-prediction-training-status.json";
function readGzipJsonl(path) {
  if (!fs.existsSync(path)) return [];
  const bytes = fs.readFileSync(path);
  if (!bytes.length) return [];
  const decoded = zlib.gunzipSync(bytes).toString("utf8");
  const rows = [];
  for (const line of decoded.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); }
    catch (error) { console.warn("PREDICTION DATASET: preskakujem poškodený JSONL riadok", path, error.message); }
  }
  return rows;
}
function parseScore(value) {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d+)\s*[:\-]\s*(\d+)$/);
    return match ? { home: Number(match[1]), away: Number(match[2]) } : null;
  }
  if (value && typeof value === "object") {
    const home = Number(value.home), away = Number(value.away);
    return Number.isFinite(home) && Number.isFinite(away) && home >= 0 && away >= 0 ? { home, away } : null;
  }
  return null;
}
function classifyRemainderGoals(currentScore, finalScore) {
  const current = parseScore(currentScore), final = parseScore(finalScore);
  if (!current || !final) return null;
  const homeDelta = final.home - current.home, awayDelta = final.away - current.away;
  if (homeDelta < 0 || awayDelta < 0) return null;
  let label;
  if (homeDelta > 0 && awayDelta > 0) label = "BOTH_TEAMS_SCORE_AGAIN";
  else if (homeDelta > 0) label = "HOME_ONLY_SCORES_AGAIN";
  else if (awayDelta > 0) label = "AWAY_ONLY_SCORES_AGAIN";
  else label = "NO_MORE_GOALS";
  return { label, home_goals_remaining: homeDelta, away_goals_remaining: awayDelta, total_goals_remaining: homeDelta + awayDelta };
}
function buildDataset(observations, outcomes) {
  const outcomeByMatch = new Map();
  for (const outcome of outcomes) if (outcome?.record_type === "confirmed_outcome" && outcome.match_id) outcomeByMatch.set(String(outcome.match_id), outcome);
  const seen = new Set(), rows = [];
  let unmatchedObservations = 0, invalidLabels = 0, matchedObservations = 0;
  const sourceCounts = {};
  for (const observation of observations) {
    if (observation?.record_type !== "observation" || !observation.match_id) continue;
    const observationId = String(observation.observation_id || "");
    if (!observationId || seen.has(observationId)) continue;
    seen.add(observationId);
    const outcome = outcomeByMatch.get(String(observation.match_id));
    if (!outcome) { unmatchedObservations++; continue; }
    matchedObservations++;
    const label = classifyRemainderGoals(observation.score, outcome.final_score);
    if (!label) { invalidLabels++; continue; }
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    labelCounts[label.label] = (labelCounts[label.label] || 0) + 1;
    rows.push({
      schema_version: 1, dataset_version: "remainder-development-v1",
      sample_id: observationId, match_id: String(observation.match_id),
      home: observation.home || "", away: observation.away || "",
      competition: observation.competition || "", source,
      collected_at: observation.collected_at || null,
      minute: observation.minute ?? null, minute_label: observation.minute_label || null,
      score: parseScore(observation.score), features: observation.features || {},
      stats_available: observation.stats_available === true,
      stats_count: Number(observation.stats_count || 0),
      stats_changes: Array.isArray(observation.stats_changes) ? observation.stats_changes : [],
      target_horizon: "REMAINDER_OF_MATCH", target: label,
      outcome_recorded_at: outcome.outcome_recorded_at || null,
      final_status: outcome.final_status || null
    });
  }
  return {
    rows,
    status: {
      schema_version: 1, dataset_version: "remainder-development-v1",
      updated_at: new Date().toISOString(), source_observations: observations.length,
      confirmed_outcomes: outcomeByMatch.size, unique_observations: seen.size,
      matched_observations: matchedObservations, unmatched_observations: unmatchedObservations,
      invalid_labels: invalidLabels, training_samples: rows.length, source_counts: sourceCounts,
      target_horizon: "REMAINDER_OF_MATCH",
      target_classes: ["HOME_ONLY_SCORES_AGAIN","AWAY_ONLY_SCORES_AGAIN","BOTH_TEAMS_SCORE_AGAIN","NO_MORE_GOALS"],
      note: "Label opisuje góly od času LIVE snímky do potvrdeného konca zápasu; nejde o predikciu gólu v najbližších 10 minútach ani o kalibrovanú pravdepodobnosť."
    }
  };
}
function main() {
  const dataset = buildDataset(readGzipJsonl(OBSERVATIONS_PATH), readGzipJsonl(OUTCOMES_PATH));
  const jsonl = dataset.rows.map(row => JSON.stringify(row)).join("\n");
  fs.writeFileSync(DATASET_PATH, zlib.gzipSync(jsonl ? jsonl + "\n" : ""));
  fs.writeFileSync(STATUS_PATH, JSON.stringify(dataset.status, null, 2) + "\n");
  console.log("LIVE PREDICTION TRAINING DATASET:", JSON.stringify(dataset.status));
}
if (require.main === module) main();
module.exports = { parseScore, classifyRemainderGoals, buildDataset };

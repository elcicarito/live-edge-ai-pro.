"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const DEFAULT_DATA = path.resolve(__dirname, "..", "data");
const STAT_ALIASES = [
  [/expected goals|\bxg\b/i, "xg"],
  [/shots on target/i, "shots_on_target"],
  [/total shots/i, "total_shots"],
  [/shots off target/i, "shots_off_target"],
  [/corner kicks|corners/i, "corners"],
  [/ball possession|possession/i, "possession"],
  [/big chances/i, "big_chances"],
  [/xg on target|xgot/i, "xgot"],
  [/goalkeeper saves|\bsaves\b/i, "saves"],
  [/yellow cards/i, "yellow_cards"],
  [/red cards/i, "red_cards"]
];

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(",", ".").replace("%", ""));
  return Number.isFinite(number) ? number : null;
}

function readTimeline(dataDir) {
  const indexPath = path.join(dataDir, "flashscore-timeline-index.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  if (index.source !== "Flashscore" || !Array.isArray(index.weeks)) {
    throw new Error("Neplatný Flashscore timeline index.");
  }
  const rows = [];
  const files = [];
  for (const item of index.weeks) {
    const file = item?.file;
    if (typeof file !== "string" || !/^flashscore-match-timeline-\d{4}-W\d{2}\.jsonl\.gz$/.test(file)) {
      throw new Error("Neplatný Flashscore timeline súbor: " + String(file));
    }
    const fullPath = path.join(dataDir, file);
    if (!fs.existsSync(fullPath)) throw new Error("Chýba Flashscore timeline súbor: " + file);
    const decoded = zlib.gunzipSync(fs.readFileSync(fullPath)).toString("utf8");
    let parsed = 0;
    for (const line of decoded.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); }
      catch (error) { throw new Error("Poškodený JSONL v " + file + ": " + error.message); }
      rows.push(row);
      parsed++;
    }
    files.push({ week: item.week || null, file, rows: parsed });
  }
  return { rows, files };
}

function statFeatures(stats) {
  const features = {};
  for (const stat of Array.isArray(stats) ? stats : []) {
    const label = String(stat?.name || stat?.label || "").trim();
    if (!label) continue;
    const period = String(stat?.period || "Match").trim() || "Match";
    const category = String(stat?.category || "Other").trim() || "Other";
    const home = finite(stat?.home_numeric ?? stat?.home);
    const away = finite(stat?.away_numeric ?? stat?.away);
    const keyBase = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    features[period.toLowerCase().replace(/[^a-z0-9]+/g, "_") + ":" + keyBase] = {
      home, away, category, label
    };
    if (period.toLowerCase() === "match") {
      for (const [pattern, alias] of STAT_ALIASES) {
        if (!pattern.test(label)) continue;
        features[alias + "_home"] = home;
        features[alias + "_away"] = away;
        break;
      }
    }
  }
  return features;
}

function buildObservations(rows) {
  const seen = new Set();
  const observations = [];
  const counts = {
    input_timeline_rows: rows.length,
    valid_observations: 0,
    duplicate_rows: 0,
    missing_match_id: 0,
    missing_timestamp: 0,
    missing_score: 0,
    snapshots_with_stats: 0,
    snapshots_without_stats: 0,
    source_counts: {}
  };
  for (const row of rows) {
    const snapshot = row?.snapshot || {};
    const rawId = String(row?.match_id || "").trim();
    if (!rawId) { counts.missing_match_id++; continue; }
    const timestamp = Date.parse(snapshot.collected_at || "");
    if (!Number.isFinite(timestamp)) { counts.missing_timestamp++; continue; }
    const homeScore = finite(snapshot.home_score);
    const awayScore = finite(snapshot.away_score);
    if (homeScore === null || awayScore === null || homeScore < 0 || awayScore < 0) {
      counts.missing_score++;
      continue;
    }
    const observationId = "flashscore:" + rawId + ":" + new Date(timestamp).toISOString();
    if (seen.has(observationId)) { counts.duplicate_rows++; continue; }
    seen.add(observationId);
    const stats = Array.isArray(snapshot.stats) ? snapshot.stats : [];
    const features = statFeatures(stats);
    const hasStats = stats.length > 0;
    if (hasStats) counts.snapshots_with_stats++;
    else counts.snapshots_without_stats++;
    const observation = {
      schema_version: 1,
      record_type: "observation",
      model_track: "FLASHSCORE_LIVE_DEVELOPMENT",
      model_version: "flashscore-observations-v1",
      observation_id: observationId,
      match_id: "flashscore:" + rawId,
      source: "Flashscore",
      home: String(row.home || ""),
      away: String(row.away || ""),
      competition: String(row.competition || ""),
      country: String(row.country || ""),
      collected_at: new Date(timestamp).toISOString(),
      minute: finite(snapshot.live_minute),
      minute_label: snapshot.live_clock || snapshot.stage || null,
      stage: snapshot.stage || null,
      score: { home: homeScore, away: awayScore },
      features,
      stats_available: hasStats,
      stats_count: stats.length,
      stats_changes: Array.isArray(row.stat_changes) ? row.stat_changes : [],
      target_horizon: "REMAINDER_OF_MATCH",
      label_status: "AWAITING_CONFIRMED_FLASHSCORE_OUTCOME"
    };
    observations.push(observation);
  }
  observations.sort((a, b) => Date.parse(a.collected_at) - Date.parse(b.collected_at) || a.observation_id.localeCompare(b.observation_id));
  counts.valid_observations = observations.length;
  counts.source_counts.Flashscore = observations.length;
  return { observations, counts };
}

function buildFlashscoreObservationExport(dataDir = DEFAULT_DATA) {
  const timeline = readTimeline(dataDir);
  const built = buildObservations(timeline.rows);
  return {
    schema_version: 1,
    dataset_version: "flashscore-observations-v1",
    source: "Flashscore",
    generated_at: new Date().toISOString(),
    timeline_files: timeline.files,
    counts: built.counts,
    observations: built.observations
  };
}

function main(dataDir = DEFAULT_DATA) {
  const output = buildFlashscoreObservationExport(dataDir);
  const jsonl = output.observations.map(row => JSON.stringify(row)).join("\n");
  fs.writeFileSync(path.join(dataDir, "flashscore-live-observations.jsonl.gz"), zlib.gzipSync(jsonl ? jsonl + "\n" : ""));
  const status = { ...output };
  delete status.observations;
  fs.writeFileSync(path.join(dataDir, "flashscore-live-observations-status.json"), JSON.stringify(status, null, 2) + "\n");
  console.log("FLASHSCORE OBSERVATION EXPORT:", JSON.stringify(output.counts));
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error("FLASHSCORE OBSERVATION EXPORT FAILED:", error.message);
    process.exit(1);
  }
}

module.exports = { finite, statFeatures, buildObservations, buildFlashscoreObservationExport, main };

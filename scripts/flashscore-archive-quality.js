"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const DATA = path.resolve(process.argv[2] || path.join(__dirname, "..", "data"));
const ARCHIVE = path.join(DATA, "flashscore-match-archive.json");
const INDEX = path.join(DATA, "flashscore-timeline-index.json");
const OUTPUT = path.join(DATA, "flashscore-archive-quality.json");
const CURRENT = path.join(DATA, "flashscore-live-current.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function finite(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return Number(sorted[index].toFixed(2));
}
function ratio(count, total) {
  return total ? Number((count / total).toFixed(4)) : 0;
}
function buildQualityReport(dataDir = DATA) {
  const archivePath = path.join(dataDir, "flashscore-match-archive.json");
  const indexPath = path.join(dataDir, "flashscore-timeline-index.json");
  const archive = readJson(archivePath);
  const index = readJson(indexPath);
  if (!archive.matches || typeof archive.matches !== "object" || !Array.isArray(index.weeks)) {
    throw new Error("Neplatná štruktúra Flashscore archívu alebo timeline indexu.");
  }

  const matches = Object.values(archive.matches);
  const byMatch = new Map();
  const missing = {
    match_id: 0, collected_at: 0, score: 0, stage: 0, clock: 0, stats: 0
  };
  let snapshotCount = 0;
  let snapshotsWithStats = 0;
  let snapshotsWithClock = 0;
  let snapshotsWithScore = 0;
  let snapshotsWithTimestamp = 0;
  let snapshotsWithStage = 0;
  const matchesWithStatsAnySnapshot = new Set();
  const intervals = [];
  const files = [];
  let malformedRows = 0;
  const statNameCounts = new Map();
  const historicalStatsStatus = { available: 0, not_flagged_unavailable: 0, flagged_but_empty: 0, error: 0, unknown_legacy: 0 };

  for (const week of index.weeks) {
    if (!week || typeof week.file !== "string" || !/^flashscore-match-timeline-\d{4}-W\d{2}\.jsonl\.gz$/.test(week.file)) {
      throw new Error("Neplatná timeline položka: " + JSON.stringify(week));
    }
    const file = path.join(dataDir, week.file);
    if (!fs.existsSync(file)) throw new Error("Chýba timeline súbor: " + week.file);
    const text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
    let fileRows = 0;
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      let row;
      try { row = JSON.parse(line); } catch { malformedRows++; continue; }
      fileRows++;
      snapshotCount++;
      const snapshot = row?.snapshot || {};
      const id = String(row?.match_id || "");
      const timestamp = Date.parse(snapshot.collected_at || "");
      const hasTimestamp = Number.isFinite(timestamp);
      const hasScore = finite(snapshot.home_score) && finite(snapshot.away_score);
      const hasClock = snapshot.live_clock !== null && snapshot.live_clock !== undefined && String(snapshot.live_clock).trim() !== "";
      const hasStage = Boolean(String(snapshot.stage || "").trim());
      const stats = Array.isArray(snapshot.stats) ? snapshot.stats : [];
      const hasStats = stats.length > 0;
      if (hasStats) {
        const namesInSnapshot = new Set();
        for (const stat of stats) {
          const name = String(stat?.name || "").trim();
          if (name) namesInSnapshot.add(name);
        }
        for (const name of namesInSnapshot) statNameCounts.set(name, (statNameCounts.get(name) || 0) + 1);
      }
      if (hasStats || snapshot.stats_available === true) historicalStatsStatus.available++;
      else if (snapshot.stats_error) historicalStatsStatus.error++;
      else if (snapshot.has_statistics === true) historicalStatsStatus.flagged_but_empty++;
      else if (snapshot.has_statistics === false) historicalStatsStatus.not_flagged_unavailable++;
      else historicalStatsStatus.unknown_legacy++;

      if (id) byMatch.set(id, (byMatch.get(id) || 0) + 1);
      if (hasTimestamp) snapshotsWithTimestamp++;
      else missing.collected_at++;
      if (hasScore) snapshotsWithScore++;
      else missing.score++;
      if (hasClock) snapshotsWithClock++;
      else missing.clock++;
      if (hasStage) snapshotsWithStage++;
      else missing.stage++;
      if (hasStats) {
        snapshotsWithStats++;
        if (id) matchesWithStatsAnySnapshot.add(id);
      } else missing.stats++;
      if (!id) missing.match_id++;

      if (id && hasTimestamp) {
        if (!byMatch.has(id + ":times")) byMatch.set(id + ":times", []);
        byMatch.get(id + ":times").push(timestamp);
      }
    }
    files.push({ week: week.week || null, file: week.file, snapshots: fileRows });
  }

  for (const [key, value] of byMatch.entries()) {
    if (!key.endsWith(":times")) continue;
    const times = [...new Set(value)].sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      const gap = (times[i] - times[i - 1]) / 60000;
      if (gap > 0 && Number.isFinite(gap)) intervals.push(gap);
    }
  }

  const matchesWithStats = matches.filter(match => Array.isArray(match?.last_snapshot?.stats) && match.last_snapshot.stats.length > 0).length;
  const statCoverage = [...statNameCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, snapshots: count, coverage: ratio(count, snapshotCount) }));
  let currentLive = null;
  const currentPath = path.join(dataDir, "flashscore-live-current.json");
  if (fs.existsSync(currentPath)) {
    const current = readJson(currentPath);
    const liveRecords = Array.isArray(current.records) ? current.records : [];
    const liveMatches = liveRecords.map(record => record?.match || record).filter(Boolean);
    const currentStats = {
      available: liveMatches.filter(match => match.stats_available === true || (Array.isArray(match.stats) && match.stats.length > 0)).length,
      not_flagged_unavailable: liveMatches.filter(match => match.has_statistics === false && !(match.stats?.length) && !match.stats_error).length,
      flagged_but_empty: liveMatches.filter(match => match.has_statistics === true && !(match.stats?.length) && !match.stats_error).length,
      error: liveMatches.filter(match => Boolean(match.stats_error)).length
    };
    currentLive = {
      collected_at: current.collected_at || null,
      live_matches: liveMatches.length,
      statistics: {
        ...currentStats,
        not_flagged_count: Number(current.stats_not_flagged_count ?? currentStats.not_flagged_unavailable),
        requested_count: Number(current.stats_requested_count ?? (currentStats.available + currentStats.flagged_but_empty + currentStats.error)),
        error_count: Number(current.stats_error_count ?? currentStats.error),
        note: "Zápasy bez has_statistics príznaku sa evidujú ako štatistiky nedostupné, nie ako chyba zberu."
      },
      clock: {
        available: liveMatches.filter(match => match.live_clock !== null && match.live_clock !== undefined && String(match.live_clock).trim() !== "").length,
        missing: liveMatches.filter(match => match.live_clock === null || match.live_clock === undefined || String(match.live_clock).trim() === "").length,
        errors: liveMatches.filter(match => Boolean(match.clock_error)).length,
        diagnostics: liveMatches.reduce((out, match) => {
          const key = match.clock_diagnostic || "unknown";
          out[key] = (out[key] || 0) + 1;
          return out;
        }, {})
      }
    };
  }
  const matchesWithClock = matches.filter(match => {
    const value = match?.last_snapshot?.live_clock;
    return value !== null && value !== undefined && String(value).trim() !== "";
  }).length;
  const matchesWithScore = matches.filter(match => finite(match?.last_snapshot?.home_score) && finite(match?.last_snapshot?.away_score)).length;
  const matchesWithMetadata = matches.filter(match => Boolean(match?.home && match?.away && match?.competition && match?.country)).length;
  const report = {
    schema_version: 1,
    source: "Flashscore",
    generated_at: new Date().toISOString(),
    retention_policy: archive.retention_policy || index.retention_policy || "unknown",
    summary: {
      archived_matches: matches.length,
      matches_with_stats_latest_snapshot: matchesWithStats,
      matches_with_stats_any_snapshot: matchesWithStatsAnySnapshot.size,
      matches_with_clock_latest_snapshot: matchesWithClock,
      matches_with_score_latest_snapshot: matchesWithScore,
      matches_with_complete_match_metadata: matchesWithMetadata,
      timeline_files: files.length,
      timeline_snapshots: snapshotCount,
      malformed_timeline_rows: malformedRows
    },
    coverage: {
      match_stats_latest_snapshot: ratio(matchesWithStats, matches.length),
      match_stats_any_snapshot: ratio(matchesWithStatsAnySnapshot.size, matches.length),
      match_clock_latest_snapshot: ratio(matchesWithClock, matches.length),
      match_score_latest_snapshot: ratio(matchesWithScore, matches.length),
      match_metadata: ratio(matchesWithMetadata, matches.length),
      snapshot_stats: ratio(snapshotsWithStats, snapshotCount),
      snapshot_clock: ratio(snapshotsWithClock, snapshotCount),
      snapshot_score: ratio(snapshotsWithScore, snapshotCount),
      snapshot_timestamp: ratio(snapshotsWithTimestamp, snapshotCount),
      snapshot_stage: ratio(snapshotsWithStage, snapshotCount)
    },
    statistics_quality: {
      historical_snapshot_status: historicalStatsStatus,
      by_stat_name: statCoverage,
      note: "Pokrytie štatistík je počet snímok, v ktorých sa daná štatistika nachádza. Staršie snímky bez uložených príznakov dostupnosti sa označujú ako unknown_legacy."
    },
    current_live_quality: currentLive,
    snapshot_quality: {
      with_stats: snapshotsWithStats,
      with_clock: snapshotsWithClock,
      with_score: snapshotsWithScore,
      with_timestamp: snapshotsWithTimestamp,
      with_stage: snapshotsWithStage,
      missing_required_fields: missing
    },
    cadence_minutes: {
      target: 2,
      interval_count: intervals.length,
      median: percentile(intervals, 0.5),
      p90: percentile(intervals, 0.9),
      within_3_minutes: ratio(intervals.filter(value => value <= 3).length, intervals.length),
      over_5_minutes: intervals.filter(value => value > 5).length
    },
    files,
    assessment: {
      suitable_for_exploratory_analysis: snapshotCount > 0 && malformedRows === 0,
      suitable_for_training_live_stats_models: snapshotCount >= 500 && snapshotsWithStats / Math.max(snapshotCount, 1) >= 0.5,
      note: "Coverage describes fields actually present in archived snapshots. It does not establish prediction quality, label correctness, or statistical significance."
    }
  };
  return report;
}

function main() {
  const report = buildQualityReport(DATA);
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + "\n");
  console.log("Flashscore archive quality report created:", JSON.stringify(report.summary));
  console.log("Flashscore archive cadence:", JSON.stringify(report.cadence_minutes));
}
if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error("FLASHSCORE ARCHIVE QUALITY FAILED:", error.message);
    process.exit(1);
  }
}
module.exports = { buildQualityReport };

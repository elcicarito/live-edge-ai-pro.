"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { buildQualityReport } = require("./flashscore-archive-quality");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flashscore-quality-"));
try {
  const archive = {
    retention_policy: "permanent",
    matches: {
      a: { home: "A", away: "B", competition: "League", country: "Country",
        last_snapshot: { live_clock: "12:00", home_score: 1, away_score: 0, stats: [{ name: "Shots on target" }] } },
      b: { home: "C", away: "D", competition: "Cup", country: "Country",
        last_snapshot: { live_clock: null, home_score: 0, away_score: 0, stats: [] } },
      c: { home: "E", away: "F", competition: "League", country: "Country",
        last_snapshot: { live_clock: "FT", home_score: 2, away_score: 1, stats: [] } }
    }
  };
  const index = { retention_policy: "permanent", weeks: [{ week: "2026-W46", file: "flashscore-match-timeline-2026-W46.jsonl.gz" }] };
  const rows = [
    { match_id: "a", snapshot: { collected_at: "2026-11-10T10:00:00Z", live_clock: "10:00", stage: "1st Half", home_score: 0, away_score: 0, has_statistics: true, stats_available: true, stats: [{ name: "Shots" }, { name: "Ball possession" }] } },
    { match_id: "a", snapshot: { collected_at: "2026-11-10T10:02:00Z", live_clock: "12:00", stage: "1st Half", home_score: 1, away_score: 0, has_statistics: true, stats_available: true, stats: [{ name: "Shots" }, { name: "Shots on target" }] } },
    { match_id: "b", snapshot: { collected_at: "2026-11-10T10:00:00Z", live_clock: null, stage: "1st Half", home_score: 0, away_score: 0, has_statistics: false, stats_available: false, stats: [] } },
    { match_id: "c", snapshot: { collected_at: "2026-11-10T10:00:00Z", live_clock: "70'", stage: "2nd Half", home_score: 1, away_score: 1, has_statistics: true, stats_error: "temporary error", stats: [] } }
  ];
  fs.writeFileSync(path.join(dir, "flashscore-match-archive.json"), JSON.stringify(archive));
  fs.writeFileSync(path.join(dir, "flashscore-live-current.json"), JSON.stringify({
    collected_at: "2026-11-10T10:02:00Z",
    live_count: 2, stats_not_flagged_count: 1, stats_requested_count: 1, stats_error_count: 0,
    records: [
      { match: { id: "live-a", has_statistics: false, stats: [], live_clock: "12:00", clock_diagnostic: "clock_ok" } },
      { match: { id: "live-b", has_statistics: true, stats: [{ name: "Shots on target" }], stats_available: true, live_clock: null, clock_diagnostic: "metadata_missing" } }
    ]
  }));
  fs.writeFileSync(path.join(dir, "flashscore-timeline-index.json"), JSON.stringify(index));
  fs.writeFileSync(path.join(dir, index.weeks[0].file), zlib.gzipSync(Buffer.from(rows.map(JSON.stringify).join("\n") + "\n")));

  const report = buildQualityReport(dir);
  assert.equal(report.summary.archived_matches, 3);
  assert.equal(report.summary.timeline_snapshots, 4);
  assert.equal(report.temporal_coverage.matches_with_5plus_snapshots, 0);
  assert.equal(report.temporal_coverage.matches_with_10plus_snapshots_and_30min_span, 0);
  assert.equal(report.match_coverage.length, 3);
  assert.equal(report.match_coverage.find(row => row.match_id === "a").span_minutes, 2);
  assert.equal(report.summary.matches_with_stats_latest_snapshot, 1);
  assert.equal(report.summary.matches_with_stats_any_snapshot, 1);
  assert.equal(report.coverage.match_stats_any_snapshot, 0.3333);
  assert.equal(report.snapshot_quality.with_stats, 2);
  assert.equal(report.statistics_quality.historical_snapshot_status.available, 2);
  assert.equal(report.statistics_quality.historical_snapshot_status.not_flagged_unavailable, 1);
  assert.equal(report.statistics_quality.historical_snapshot_status.error, 1);
  assert.equal(report.statistics_quality.by_stat_name.find(item => item.name === "Shots").snapshots, 2);
  assert.equal(report.current_live_quality.live_matches, 2);
  assert.equal(report.current_live_quality.statistics.not_flagged_count, 1);
  assert.equal(report.current_live_quality.clock.available, 1);
  assert.equal(report.current_live_quality.clock.missing, 1);
  assert.equal(report.cadence_minutes.median, 2);
  assert.equal(report.cadence_minutes.within_3_minutes, 1);
  assert.equal(report.retention_policy, "permanent");
  assert.equal(report.assessment.suitable_for_exploratory_analysis, true);
  assert.equal(report.assessment.suitable_for_training_live_stats_models, false);
  console.log("Flashscore archive quality tests passed.");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

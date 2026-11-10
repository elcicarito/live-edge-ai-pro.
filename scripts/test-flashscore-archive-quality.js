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
    { match_id: "a", snapshot: { collected_at: "2026-11-10T10:00:00Z", live_clock: "10:00", stage: "1st Half", home_score: 0, away_score: 0, stats: [{ name: "Shots" }] } },
    { match_id: "a", snapshot: { collected_at: "2026-11-10T10:02:00Z", live_clock: "12:00", stage: "1st Half", home_score: 1, away_score: 0, stats: [{ name: "Shots" }] } },
    { match_id: "b", snapshot: { collected_at: "2026-11-10T10:00:00Z", live_clock: null, stage: "1st Half", home_score: 0, away_score: 0, stats: [] } },
    { match_id: "c", snapshot: { collected_at: "2026-11-10T10:00:00Z", live_clock: "70'", stage: "2nd Half", home_score: 1, away_score: 1, stats: [{ name: "Shots" }] } }
  ];
  fs.writeFileSync(path.join(dir, "flashscore-match-archive.json"), JSON.stringify(archive));
  fs.writeFileSync(path.join(dir, "flashscore-timeline-index.json"), JSON.stringify(index));
  fs.writeFileSync(path.join(dir, index.weeks[0].file), zlib.gzipSync(Buffer.from(rows.map(JSON.stringify).join("\n") + "\n")));

  const report = buildQualityReport(dir);
  assert.equal(report.summary.archived_matches, 3);
  assert.equal(report.summary.timeline_snapshots, 4);
  assert.equal(report.summary.matches_with_stats_latest_snapshot, 1);
  assert.equal(report.summary.matches_with_stats_any_snapshot, 2);
  assert.equal(report.coverage.match_stats_any_snapshot, 0.6667);
  assert.equal(report.snapshot_quality.with_stats, 3);
  assert.equal(report.cadence_minutes.median, 2);
  assert.equal(report.cadence_minutes.within_3_minutes, 1);
  assert.equal(report.retention_policy, "permanent");
  assert.equal(report.assessment.suitable_for_exploratory_analysis, true);
  assert.equal(report.assessment.suitable_for_training_live_stats_models, false);
  console.log("Flashscore archive quality tests passed.");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

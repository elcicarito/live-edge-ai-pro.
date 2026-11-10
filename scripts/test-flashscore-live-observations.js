"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { buildFlashscoreObservationExport, statFeatures } = require("./flashscore-live-observations");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flashscore-observations-"));
try {
  const rows = [
    { match_id: "match-1", home: "Home", away: "Away", competition: "League", country: "Test", snapshot: {
      collected_at: "2026-11-10T09:00:00.000Z", live_minute: 32, live_clock: "32:14", stage: "2nd Half",
      home_score: 1, away_score: 0, stats: [
        { category: "Shots", period: "Match", name: "Expected goals (xG)", home: 1.2, away: 0.4 },
        { category: "Shots", period: "Match", name: "Shots on target", home: 4, away: 1 },
        { category: "Attack", period: "Match", name: "Corner kicks", home: 5, away: 2 }
      ]
    }, stat_changes: [] },
    { match_id: "match-1", home: "Home", away: "Away", competition: "League", country: "Test", snapshot: {
      collected_at: "2026-11-10T09:00:00.000Z", live_minute: 32, live_clock: "32:14",
      home_score: 1, away_score: 0, stats: []
    } },
    { match_id: "match-1", home: "Home", away: "Away", competition: "League", country: "Test", snapshot: {
      collected_at: "2026-11-10T09:02:00.000Z", live_minute: 34, live_clock: "34:10",
      home_score: 1, away_score: 0, stats: []
    } },
    { match_id: "missing-time", snapshot: { home_score: 0, away_score: 0, stats: [] } }
  ];
  fs.writeFileSync(path.join(dir, "flashscore-timeline-index.json"), JSON.stringify({
    source: "Flashscore", weeks: [{ week: "2026-W46", file: "flashscore-match-timeline-2026-W46.jsonl.gz" }]
  }));
  fs.writeFileSync(path.join(dir, "flashscore-match-timeline-2026-W46.jsonl.gz"),
    zlib.gzipSync(rows.map(row => JSON.stringify(row)).join("\n") + "\n"));

  const result = buildFlashscoreObservationExport(dir);
  assert.equal(result.observations.length, 2);
  assert.equal(result.counts.duplicate_rows, 1);
  assert.equal(result.counts.missing_timestamp, 1);
  assert.equal(result.counts.snapshots_with_stats, 1);
  assert.equal(result.observations[0].source, "Flashscore");
  assert.equal(result.observations[0].match_id, "flashscore:match-1");
  assert.equal(result.observations[0].features.xg_home, 1.2);
  assert.equal(result.observations[0].features.shots_on_target_away, 1);
  assert.equal(result.observations[0].features.corners_home, 5);
  assert.equal(result.observations[0].label_status, "AWAITING_CONFIRMED_FLASHSCORE_OUTCOME");
  assert.equal(result.observations[1].features.total_shots_home, undefined);

  const features = statFeatures([{ period: "1st Half", name: "Total shots", home: "7", away: "3" }]);
  assert.equal(features["1st_half:total_shots"].home, 7);
  console.log("Flashscore live observation export tests passed.");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

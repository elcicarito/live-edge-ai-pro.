"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { buildRecentTimeline } = require("./flashscore-timeline-browser-export");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flashscore-browser-timeline-"));
try {
  const now = Date.parse("2026-11-10T21:00:00Z");
  const index = {
    source: "Flashscore",
    weeks: [{ week: "2026-W46", file: "flashscore-match-timeline-2026-W46.jsonl.gz" }]
  };
  const rows = [
    { match_id: "match-a", snapshot: {
      collected_at: "2026-11-10T20:58:00Z", stage: "2nd Half", live_minute: 88,
      home_score: 1, away_score: 2,
      stats: [{ name: "Shots on target", home_numeric: 4, away_numeric: 3 }]
    } },
    { match_id: "match-a", snapshot: {
      collected_at: "2026-11-10T20:56:00Z", stage: "2nd Half", live_minute: 86,
      home_score: 1, away_score: 2, stats: []
    } },
    { match_id: "old-match", snapshot: {
      collected_at: "2026-11-09T20:00:00Z", stats: []
    } },
    { match_id: "", snapshot: { collected_at: "2026-11-10T20:59:00Z", stats: [] } }
  ];
  fs.writeFileSync(path.join(dir, "flashscore-timeline-index.json"), JSON.stringify(index));
  fs.writeFileSync(path.join(dir, "flashscore-primary-current.json"), JSON.stringify({
    source: "Flashscore",
    records: [{ match: { id: "match-a", status: "live" } }]
  }));
  fs.writeFileSync(path.join(dir, index.weeks[0].file),
    zlib.gzipSync(Buffer.from(rows.map(JSON.stringify).join("\n") + "\n")));

  const output = buildRecentTimeline(dir, now);
  assert.equal(output.source, "Flashscore");
  assert.equal(output.rows.length, 2);
  assert.equal(output.rows[0].match.id, "match-a");
  assert.equal(output.rows[0].match.live_minute, 86);
  assert.equal(output.rows[1].match.stats[0].label, "Shots on target");
  assert.equal(output.rows[1].match.stats[0].home, 4);
  console.log("Flashscore browser timeline export tests passed.");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

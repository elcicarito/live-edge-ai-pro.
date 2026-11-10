"use strict";
const assert = require("node:assert/strict");
const { adaptFlashscoreCurrent } = require("./flashscore-primary-adapter");

const adapted = adaptFlashscoreCurrent({
  source: "Flashscore",
  collected_at: "2026-11-10T12:00:00.000Z",
  data_status: "complete",
  collection_complete: true,
  fixture_count: 2,
  records: [
    {
      collected_at: "2026-11-10T12:00:00.000Z",
      match: {
        id: "abc123",
        home: "Home FC",
        away: "Away FC",
        status: "live",
        stage: "2nd Half",
        live_minute: 63,
        live_clock: "63:12",
        stats: [
          { name: "Shots on target", home: "5", away: "2", home_numeric: 5, away_numeric: 2 }
        ]
      }
    },
    {
      collected_at: "2026-11-10T12:00:00.000Z",
      match: {
        id: "def456",
        home: "Alpha",
        away: "Beta",
        status: "live",
        stage: "1st Half",
        live_minute: null,
        live_clock: null,
        stats: []
      }
    }
  ]
});

assert.equal(adapted.source, "Flashscore");
assert.deepEqual(adapted.source_providers, ["Flashscore"]);
assert.equal(adapted.records.length, 2);
assert.equal(adapted.records[0].match.source, "Flashscore");
assert.equal(adapted.records[0].match.stats[0].label, "Shots on target");
assert.equal(adapted.records[0].match.stats[0].home_numeric, 5);
assert.equal(adapted.validation.clock_available_count, 1);
assert.equal(adapted.validation.stats_available_count, 1);
assert.equal(adapted.collection_complete, false);
assert.equal(adapted.data_status, "partial");
assert.equal(adapted.promotion_ready, false);
assert.equal(adapted.signal_eligible, false);

assert.throws(() => adaptFlashscoreCurrent({ source: "ESPN", records: [] }), /Neplatný Flashscore/);
console.log("Flashscore primary adapter tests passed.");

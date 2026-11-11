"use strict";

const assert = require("node:assert/strict");
const {
  stageIsUsable, transitionsFor, labelWindow, buildDataset
} = require("./ai-edge-selector-dataset");

function snap(id, minute, home, away, collected, extra = {}) {
  return {
    source: "Flashscore",
    match_id: "flashscore:" + id,
    observation_id: id + ":" + minute,
    collected_at: collected || new Date(Date.UTC(2026, 10, 10, 10, minute)).toISOString(),
    minute,
    stage: minute < 45 ? "1st Half" : "2nd Half",
    score: { home, away },
    stats_available: true,
    stats_count: 2,
    features: { xg_home: 0.7, shots_on_target_home: 3, shots_on_target_away: 1 },
    ...extra
  };
}
function test(name, fn) {
  fn();
  console.log("PASS", name);
}
test("half-time and finished stages are excluded", () => {
  assert.equal(stageIsUsable("Half Time"), false);
  assert.equal(stageIsUsable("Finished"), false);
  assert.equal(stageIsUsable("2nd Half"), true);
});
test("goal wholly inside delay-aware horizon is positive", () => {
  const rows = [
    snap("a", 10, 0, 0),
    snap("a", 12, 0, 0),
    snap("a", 16, 1, 0),
    snap("a", 20, 1, 0),
    snap("a", 40, 1, 0)
  ];
  const tr = transitionsFor(rows);
  assert.equal(tr.invalid, false);
  assert.equal(labelWindow(rows[0], rows, tr.transitions, [1, 0], 25).label, 1);
});
test("goal during five-minute unseen delay is excluded", () => {
  const rows = [
    snap("b", 10, 0, 0),
    snap("b", 12, 0, 0),
    snap("b", 14, 1, 0),
    snap("b", 20, 1, 0),
    snap("b", 40, 1, 0)
  ];
  const tr = transitionsFor(rows);
  assert.equal(labelWindow(rows[0], rows, tr.transitions, [1, 0], 25).status, "goal_during_delay");
});
test("boundary-straddling goal is excluded", () => {
  const rows = [
    snap("c", 10, 0, 0),
    snap("c", 12, 0, 0),
    snap("c", 14, 0, 0),
    snap("c", 16, 1, 0),
    snap("c", 40, 1, 0)
  ];
  const tr = transitionsFor(rows);
  assert.equal(labelWindow(rows[0], rows, tr.transitions, [1, 0], 25).status, "ambiguous_start_boundary");
});
test("confirmed final score matching last snapshot supports a negative label", () => {
  const rows = [snap("d", 10, 0, 0), snap("d", 12, 0, 0), snap("d", 20, 0, 0)];
  const tr = transitionsFor(rows);
  assert.equal(labelWindow(rows[0], rows, tr.transitions, [0, 0], 25).label, 0);
});
test("one match is kept wholly in one frozen split and non-Flashscore rows are rejected", () => {
  const rows = [
    snap("e", 10, 0, 0, "2026-11-10T10:10:00.000Z"),
    snap("e", 20, 0, 0, "2026-11-10T10:20:00.000Z")
  ];
  const outcomes = { source: "Flashscore", matches: {
    e: { source: "Flashscore", status: "CONFIRMED", status_confirmation: "confirmed_finished",
      final_status: "FINISHED", home_score: 0, away_score: 0, final_match: { status_text: "Finished" } }
  }};
  const built = buildDataset([...rows, { ...rows[0], match_id: "espn:e", source: "ESPN" }], outcomes,
    "2026-11-09T00:00:00.000Z", { horizons: [15] });
  assert.equal(built.report.matches.confirmed_unique_matches_used, 1);
  assert.equal(built.report.matches.test_matches, 1);
  assert.ok(built.rows.every(row => row.split === "test"));
  assert.equal(built.report.exclusions.non_flashscore_or_invalid_match_id, 1);
});
console.log("AI EDGE SELECTOR DATASET TESTS PASSED");

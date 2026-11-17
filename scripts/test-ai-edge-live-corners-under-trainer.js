"use strict";
const assert = require("node:assert/strict");
const corners = require("./ai-edge-live-corners-under-trainer");
const at = minute => new Date(Date.UTC(2026, 10, 17, 12, 0) + minute * 60000).toISOString();
function row(id, minute, homeCorners, awayCorners) {
  return { match_id: "flashscore:" + id, snapshot: {
    collected_at: at(minute), live_minute: minute, stage: "2nd Half",
    home_score: 1, away_score: 0,
    stats: [
      { name: "Corner kicks", period: "Match", home: String(homeCorners), away: String(awayCorners) },
      { name: "Fouls", period: "Match", home: "18", away: "15" },
      { name: "Total shots", period: "Match", home: "10", away: "7" },
      { name: "Shots on target", period: "Match", home: "4", away: "2" },
      { name: "Ball possession", period: "Match", home: "55", away: "45" },
      { name: "Red cards", period: "Match", home: "0", away: "0" }
    ]
  }};
}
const outcome = { source: "Flashscore", status: "CONFIRMED", status_confirmation: "confirmed_finished",
  final_status: "FINISHED", final_match: { status_text: "Finished" }, corners_status: "CONFIRMED",
  final_corners: { home_corners: 5, away_corners: 4, total_corners: 9 } };
assert.equal(corners.confirmedRegularCorners(outcome), true);
assert.equal(corners.confirmedRegularCorners({ ...outcome, final_match: { status_text: "After extra time" } }), false);
const rows = [row("under9",55,3,2),row("under9",60,3,2),row("under9",65,4,2),row("under9",70,4,2),row("under9",75,4,2),row("under9",80,5,4),row("under9",90,5,4)];
const built = corners.buildSamples(rows, { matches: { under9: outcome } }, Date.parse("2026-11-17T00:00:00.000Z"));
assert.ok(built.byLine.UNDER_9_5.length > 0);
assert.ok(built.byLine.UNDER_9_5.every(sample => sample.y === 1));
assert.ok(built.byLine.UNDER_8_5.every(sample => sample.y === 0));
assert.ok(built.byLine.UNDER_10_5.every(sample => sample.y === 1));
assert.ok(built.byLine.UNDER_11_5.every(sample => sample.y === 1));
const lag = [row("lag",55,3,2),row("lag",58,3,2),row("lag",61,4,2),row("lag",66,4,2),row("lag",70,4,2),row("lag",75,4,2),row("lag",80,5,4),row("lag",90,5,4)];
const excluded = corners.buildSamples(lag, { matches: { lag: outcome } }, Date.parse("2026-11-17T00:00:00.000Z"));
assert.ok(excluded.excluded.lag_ambiguous > 0);
const control = corners.buildSamples(
  [row("control",55,3,2),row("control",58,3,2),row("control",61,3,2),row("control",66,3,2),row("control",70,3,2),row("control",75,3,2),row("control",80,3,2),row("control",90,5,4)],
  { matches: { control: outcome } }, Date.parse("2026-11-17T00:00:00.000Z"));
assert.ok(excluded.byLine.UNDER_9_5.length < control.byLine.UNDER_9_5.length);
const shortCoverage = [row("short",55,3,2),row("short",58,3,2),row("short",90,5,4)];
assert.equal(corners.hasCornerChangeInLag(shortCoverage,0,60),true);
const mismatch = corners.buildSamples([row("bad",55,6,4),row("bad",60,6,4),row("bad",90,6,4)],
  { matches: { bad: { ...outcome, final_corners: { home_corners: 3, away_corners: 2, total_corners: 5 } } } },
  Date.parse("2026-11-17T00:00:00.000Z"));
assert.equal(mismatch.excluded.invalid_corner_sequence,1);
console.log("AI EDGE live corners UNDER trainer tests passed.");

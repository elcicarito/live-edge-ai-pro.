"use strict";

const assert = require("node:assert/strict");
const { labelObservations } = require("./flashscore-observation-labels");

const observations = [
  { match_id: "flashscore:match-1", stage: "2nd Half", score: { home: 1, away: 0 }, label_status: "AWAITING_CONFIRMED_FLASHSCORE_OUTCOME" },
  { match_id: "flashscore:match-2", stage: "2nd Half", score: { home: 0, away: 0 } },
  { match_id: "flashscore:match-3", stage: "Penalties", score: { home: 1, away: 1 } },
  { match_id: "flashscore:match-4", stage: "2nd Half", score: { home: 3, away: 0 } },
  { match_id: "flashscore:match-5", stage: "Finished", score: { home: 2, away: 1 } }
];
const outcomes = { matches: {
  "match-1": { status: "CONFIRMED", status_confirmation: "confirmed_finished", final_status: "FINISHED", home_score: 2, away_score: 2, confirmed_at: "2026-11-10T10:00:00Z", final_match: { status_text: "Finished" }, revisions: [] },
  "match-3": { status: "CONFIRMED", status_confirmation: "confirmed_finished", final_status: "FINISHED", home_score: 4, away_score: 5, confirmed_at: "2026-11-10T10:00:00Z", final_match: { status_text: "After Penalties" }, revisions: [] },
  "match-4": { status: "CONFIRMED", status_confirmation: "confirmed_finished", final_status: "FINISHED", home_score: 2, away_score: 0, confirmed_at: "2026-11-10T10:00:00Z", final_match: { status_text: "Finished" }, revisions: [] },
  "match-5": { status: "CONFIRMED", status_confirmation: "confirmed_finished", final_status: "FINISHED", home_score: 2, away_score: 1, confirmed_at: "2026-11-10T10:00:00Z", final_match: { status_text: "Finished" }, revisions: [] }
}};
const result = labelObservations(observations, outcomes);
assert.equal(result.counts.confirmed, 1);
assert.equal(result.counts.pending, 1);
assert.equal(result.counts.excluded_penalties, 1);
assert.equal(result.counts.excluded_score_inconsistency, 1);
assert.equal(result.counts.excluded_finished_snapshot, 1);
assert.deepEqual(result.observations[0].labels, {
  final_home_score: 2,
  final_away_score: 2,
  final_total_goals: 4,
  final_result: "DRAW",
  remaining_home_goals: 1,
  remaining_away_goals: 2,
  remaining_total_goals: 3,
  remaining_goal_result: "AWAY"
});
assert.equal(result.observations[1].label_status, "AWAITING_CONFIRMED_FLASHSCORE_OUTCOME");
console.log("Flashscore confirmed observation labeling tests passed.");

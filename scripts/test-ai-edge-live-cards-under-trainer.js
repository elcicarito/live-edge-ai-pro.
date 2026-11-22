"use strict";

const assert = require("node:assert/strict");
const cards = require("./ai-edge-live-cards-under-trainer");

const at = minute => new Date(Date.UTC(2026, 10, 17, 12, 0) + minute * 60000).toISOString();
function row(matchId, minute, homeCards, awayCards) {
  return {
    match_id: "flashscore:" + matchId,
    home: "Home", away: "Away", competition: "Test League", country: "Testland",
    snapshot: {
      collected_at: at(minute), live_minute: minute, stage: "2nd Half",
      home_score: 1, away_score: 0,
      stats: [
        { name: "Yellow cards", period: "Match", home: String(homeCards), away: String(awayCards) },
        { name: "Fouls", period: "Match", home: "18", away: "15" },
        { name: "Total shots", period: "Match", home: "10", away: "7" },
        { name: "Shots on target", period: "Match", home: "4", away: "2" },
        { name: "Ball possession", period: "Match", home: "55", away: "45" }
      ]
    }
  };
}
const outcome = {
  source: "Flashscore", status: "CONFIRMED",
  status_confirmation: "confirmed_finished", final_status: "FINISHED",
  final_match: { status_text: "Finished" },
  yellow_cards_status: "CONFIRMED",
  final_yellow_cards: { home_yellow_cards: 2, away_yellow_cards: 2, total_yellow_cards: 4 }
};
assert.equal(cards.confirmedRegularCards(outcome), true);
assert.equal(cards.confirmedRegularCards({ ...outcome, final_match: { status_text: "After extra time" } }), false);
const rows = [row("sample", 55, 1, 1), row("sample", 60, 1, 1), row("sample", 65, 2, 1), row("sample", 70, 2, 1), row("sample", 75, 2, 1), row("sample", 80, 2, 1), row("sample", 90, 2, 2)];
const built = cards.buildSamples(rows, { matches: { sample: outcome } }, Date.parse("2026-11-17T00:00:00.000Z"));
assert.ok(built.byLine.UNDER_4_5.length > 0);
assert.ok(built.byLine.UNDER_4_5.every(sample => sample.y === 1));
assert.ok(built.byLine.OVER_3_5.every(sample => sample.y === 1));
assert.ok(built.byLine.UNDER_3_5.every(sample => sample.y === 0));
assert.ok(built.byLine.OVER_4_5.every(sample => sample.y === 0));
const lagAmbiguous = [row("lag", 55, 1, 1), row("lag", 58, 2, 1), row("lag", 63, 2, 1), row("lag", 70, 2, 1), row("lag", 80, 2, 1), row("lag", 90, 2, 2)];
const excluded = cards.buildSamples(lagAmbiguous, { matches: { lag: outcome } }, Date.parse("2026-11-17T00:00:00.000Z"));
assert.ok(excluded.excluded.lag_ambiguous > 0);
assert.ok(excluded.byLine.UNDER_4_5.length < built.byLine.UNDER_4_5.length);
const invalid = cards.buildSamples([row("bad", 55, 2, 1), row("bad", 60, 1, 1), row("bad", 90, 2, 2)], { matches: { bad: outcome } }, 0);
assert.equal(invalid.excluded.invalid_card_sequence, 1);

assert.equal(cards.hasCardChangeInLag([row("coverage", 55, 1, 1), row("coverage", 58, 1, 1)], 0, 60), true);
const finalCardsMismatch = cards.buildSamples(
  [row("mismatch", 55, 1, 1), row("mismatch", 60, 1, 1), row("mismatch", 90, 3, 2)],
  { matches: { mismatch: { ...outcome, final_yellow_cards: { home_yellow_cards: 1, away_yellow_cards: 1, total_yellow_cards: 2 } } } },
  Date.parse("2026-11-17T00:00:00.000Z")
);
assert.equal(finalCardsMismatch.excluded.invalid_card_sequence, 1);
const finalCardsHigherThanSnapshot = cards.buildSamples(
  [row("higher", 55, 1, 1), row("higher", 60, 1, 1), row("higher", 90, 2, 1)],
  { matches: { higher: { ...outcome, final_yellow_cards: { home_yellow_cards: 2, away_yellow_cards: 2, total_yellow_cards: 4 } } } },
  Date.parse("2026-11-17T00:00:00.000Z")
);
assert.equal(finalCardsHigherThanSnapshot.excluded.invalid_card_sequence, 1,
  "final outcome must exactly match the last snapshot, not merely be greater");
const finalCardsTeamMismatch = cards.buildSamples(
  [row("teams", 55, 1, 1), row("teams", 60, 1, 1), row("teams", 90, 2, 2)],
  { matches: { teams: { ...outcome, final_yellow_cards: { home_yellow_cards: 3, away_yellow_cards: 1, total_yellow_cards: 4 } } } },
  Date.parse("2026-11-17T00:00:00.000Z")
);
assert.equal(finalCardsTeamMismatch.excluded.invalid_card_sequence, 1,
  "matching total with mismatched team counts must be rejected");

const currentDeltaRow = row("delta", 65, 2, 1);
const stalePreviousRow = row("delta", 50, 1, 1);
const staleFeatures = cards.featureVector(currentDeltaRow, stalePreviousRow);
assert.equal(staleFeatures[12], 0, "card delta must be zero when the previous snapshot is older than 12 minutes");
assert.equal(staleFeatures[13], 0, "foul delta must be zero when the previous snapshot is older than 12 minutes");
assert.equal(staleFeatures[14], 0, "shot delta must be zero when the previous snapshot is older than 12 minutes");
const recentPreviousRow = row("delta", 60, 1, 1);
const recentFeatures = cards.featureVector(currentDeltaRow, recentPreviousRow);
assert.ok(recentFeatures[12] > 0, "recent snapshot deltas remain available inside the 12-minute window");

process.stdout.write("AI EDGE live cards shadow trainer tests passed.\n");

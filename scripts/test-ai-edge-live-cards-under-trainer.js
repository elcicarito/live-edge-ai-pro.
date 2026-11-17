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
process.stdout.write("AI EDGE live cards shadow trainer tests passed.\n");

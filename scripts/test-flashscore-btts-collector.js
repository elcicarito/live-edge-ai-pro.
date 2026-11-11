"use strict";
const assert = require("node:assert/strict");
const { getBttsCandidates, run, isFinished, buildSignalContext } = require("./flashscore-btts-collector");

const base = {
  id: "abc123", source: "Flashscore", home: "Home FC", away: "Away FC",
  stage: "2nd Half", live_minute: 48, live_clock: "48:12",
  home_score: 1, away_score: 0,
  stats: [
    { name: "Shots on target", home: 3, away: 2 },
    { name: "Total shots", home: 5, away: 5 }
  ]
};
const candidates = getBttsCandidates(base);
assert.deepEqual(candidates.map(x => x.tierKey), ["10_sot5_shots8", "10_sot5_shots10"]);
assert.equal(candidates[0].predictedSide, "away");
assert.deepEqual(
  [candidates[0].homeSot, candidates[0].awaySot, candidates[0].homeShots, candidates[0].awayShots],
  [3, 2, 5, 5],
  "signal candidate must retain exact per-team Match statistics"
);
assert.equal(getBttsCandidates({ ...base, live_minute: 51 }).length, 0);
assert.equal(getBttsCandidates({ ...base, stage: "1st Half" }).length, 0);
assert.equal(getBttsCandidates({ ...base, source: "ESPN" }).length, 0);
// Period-aware Flashscore payload: first-half values must not be mistaken for full-match totals.
const noTotalShots = [{ name: "Shots on target", home: 3, away: 2 }, { name: "Shots off target", home: 4, away: 3 }];
assert.equal(getBttsCandidates({ ...base, stats: noTotalShots }).length, 0, "Total Shots must not be estimated from SOT + off-target");
const periodStats = [
  { name: "Shots on target", period: "1st Half", home: 8, away: 0 },
  { name: "Total shots", period: "1st Half", home: 12, away: 0 },
  { name: "Shots on target", period: "Match", home: 3, away: 1 },
  { name: "Total shots", period: "Match", home: 6, away: 2 }
];
assert.equal(getBttsCandidates({ ...base, stats: periodStats }).length, 0,
  "BTTS thresholds must use Match totals, not inflated first-half-only values");
assert.equal(getBttsCandidates({ ...base, home_score: 0, away_score: 1,
  stats: [{ name: "Shots on target", home: 3, away: 3 }, { name: "Total shots", home: 4, away: 4 }]
}).length, 1);

const metricNow = Date.now();
const metricTime = offset => new Date(metricNow + offset * 60000).toISOString();
const metricMatch = {
  ...base,
  stats: [
    { name: "Ball possession", home: 60, away: 40 },
    { name: "Shots on target", home: 3, away: 2 },
    { name: "Shots off target", home: 3, away: 2 },
    { name: "Total shots", home: 5, away: 5 }
  ]
};
const metricHistory = [-4, -2].map((offset, index) => ({
  time: Date.parse(metricTime(offset)),
  match: {
    ...metricMatch,
    live_minute: 40 + index * 2,
    stats: [
      { name: "Ball possession", home: 60, away: 40 },
      { name: "Shots on target", home: index + 1, away: index },
      { name: "Shots off target", home: index + 1, away: index },
      { name: "Total shots", home: index + 2, away: index + 2 }
    ]
  }
}));
const metricContext = buildSignalContext(metricMatch, metricHistory, metricTime(0), metricTime(0));
assert.deepEqual(metricContext.pressure, { home: 60, away: 40 });
assert.deepEqual(metricContext.goal_threat, { home: 49, away: 40 });
assert.deepEqual(metricContext.activity_rate_per_10min, {
  home: 20, away: 20, interval_minutes: 2, previous_collected_at: metricTime(-2)
});
assert.equal(typeof metricContext.ai_quality_score.home, "number");
assert.equal(typeof metricContext.ai_quality_score.away, "number");

(async () => {
  const current = {
    source: "Flashscore", collected_at: new Date().toISOString(),
    records: [{ collected_at: new Date().toISOString(), match: base }]
  };
  const archive = { schema_version: 1, source: "Flashscore", signals: [] };
  const first = await run({ current, archive, now: new Date().toISOString() });
  assert.equal(first.signals.length, 2);
  assert.equal(first.signals[0].status, "OPEN");
  assert.equal(first.signals[0].sourceSnapshot.schema_version, 2);
  assert.deepEqual(first.signals[0].sourceSnapshot.stats_summary, {
    home_shots_on_target: 3,
    away_shots_on_target: 2,
    combined_shots_on_target: 5,
    home_total_shots: 5,
    away_total_shots: 5,
    combined_total_shots: 10
  });
  assert.equal(first.signals[0].sourceSnapshot.metric_availability.goal_threat, false);
  assert.equal(first.signals[0].sourceSnapshot.metric_availability.activity_rate, false);
  assert.equal(first.signals[0].sourceSnapshot.metric_availability.ai_quality_score, false);
  const metricNowIso = metricTime(0);
  const metricRun = await run({
    current: { source: "Flashscore", collected_at: metricNowIso, records: [{ collected_at: metricNowIso, match: metricMatch }] },
    archive: { schema_version: 1, source: "Flashscore", signals: [] },
    history: metricHistory,
    now: metricNowIso
  });
  assert.equal(metricRun.signals[0].sourceSnapshot.metric_availability.goal_threat, true);
  assert.equal(metricRun.signals[0].sourceSnapshot.metric_availability.activity_rate, true);
  assert.equal(metricRun.signals[0].sourceSnapshot.metric_availability.ai_quality_score, true);
  assert.equal(typeof metricRun.signals[0].sourceSnapshot.scanner_context.ai_quality_score.away, "number");
  assert.equal(metricRun.signals[0].qualityScoreVersion, "ai-quality-v1");
  assert.equal(metricRun.signals[0].qualityScoreSide, "away");
  assert.equal(metricRun.signals[0].qualityScore, metricRun.signals[0].sourceSnapshot.scanner_context.ai_quality_score.away);
  assert.equal(metricRun.signals[0].pressureHome, 60);
  assert.equal(metricRun.signals[0].goalThreatAway, 40);
  assert.equal(metricRun.signals[0].activityHome, 20);
  const second = await run({ current, archive: first, now: new Date().toISOString() });
  assert.equal(second.signals.length, 2, "duplicate signal must not be added");

  const settled = await run({
    current: { source: "Flashscore", collected_at: new Date().toISOString(), records: [] },
    archive: first,
    detailsFetcher: async () => ({ status: "finished", home_score: 1, away_score: 1 }),
    now: new Date().toISOString()
  });
  assert.equal(settled.signals[0].status, "WIN");
  assert.equal(isFinished({ status: "finished" }), true);
  console.log("Flashscore BTTS collector tests passed.");
})().catch(error => { console.error(error); process.exit(1); });

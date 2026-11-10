"use strict";
const assert = require("node:assert/strict");
const { getBttsCandidates, run, isFinished } = require("./flashscore-btts-collector");

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
assert.deepEqual(candidates.map(x => x.tierKey), ["10_sot5_shots8"]);
assert.equal(candidates[0].predictedSide, "away");
assert.equal(getBttsCandidates({ ...base, live_minute: 51 }).length, 0);
assert.equal(getBttsCandidates({ ...base, stage: "1st Half" }).length, 0);
assert.equal(getBttsCandidates({ ...base, source: "ESPN" }).length, 0);
assert.equal(getBttsCandidates({ ...base, home_score: 0, away_score: 1,
  stats: [{ name: "Shots on target", home: 3, away: 3 }, { name: "Total shots", home: 4, away: 4 }]
}).length, 1);

(async () => {
  const current = {
    source: "Flashscore", collected_at: new Date().toISOString(),
    records: [{ collected_at: new Date().toISOString(), match: base }]
  };
  const archive = { schema_version: 1, source: "Flashscore", signals: [] };
  const first = await run({ current, archive, now: new Date().toISOString() });
  assert.equal(first.signals.length, 1);
  assert.equal(first.signals[0].status, "OPEN");
  const second = await run({ current, archive: first, now: new Date().toISOString() });
  assert.equal(second.signals.length, 1, "duplicate signal must not be added");

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

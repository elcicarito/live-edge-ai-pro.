"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flashscore-outcomes-test-"));
const now = new Date();
const date = now.toISOString().slice(0, 10);
const archived = (id, home, away) => ({
  id, home, away, competition: "Test League", country: "Testland",
  start_time: date + "T17:00:00.000Z",
  first_seen_at: now.toISOString(), last_seen_at: now.toISOString(),
  snapshots_count: 3,
  last_snapshot: { collected_at: now.toISOString(), stage: "2nd Half", home_score: 1, away_score: 0, stats: [] }
});
const apiMatches = [
  { id: "finished-corrected", status: "finished", stage: "Finished", home: {name:"Home A"}, away: {name:"Away A"}, home_score: 2, away_score: 1, start_time: date + "T17:00:00.000Z", competition: {name:"Test League", country:{name:"Testland"}} },
  { id: "not-finished", status: "live", stage: "2nd Half", home: {name:"Home B"}, away: {name:"Away B"}, home_score: 1, away_score: 0 },
  { id: "missing-score", status: "finished", stage: "Finished", home: {name:"Home C"}, away: {name:"Away C"}, home_score: null, away_score: 0 }
];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  assert.equal(url.pathname, "/matches");
  assert.equal(url.searchParams.get("sport"), "football");
  assert.equal(url.searchParams.get("date"), date);
  assert.equal(url.searchParams.get("timezone"), "0");
  assert.equal(url.searchParams.get("status"), "finished");
  res.writeHead(200, {"content-type":"application/json"});
  res.end(JSON.stringify({competitions:[{competition:{name:"Test League",country:{name:"Testland"}},matches:apiMatches}]}));
});

(async () => {
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    process.env.FLASHSCORE_API_BASE = "http://127.0.0.1:" + server.address().port;
    const settlement = require("./flashscore-outcome-settlement");
    const dataDir = path.join(tempDir, "data");
    fs.mkdirSync(dataDir, {recursive:true});
    fs.writeFileSync(path.join(dataDir, "flashscore-match-archive.json"), JSON.stringify({
      source:"Flashscore",
      matches:{
        "finished-corrected":archived("finished-corrected","Home A","Away A"),
        "not-finished":archived("not-finished","Home B","Away B"),
        "missing-score":archived("missing-score","Home C","Away C")
      }
    }));
    fs.writeFileSync(path.join(dataDir, "flashscore-confirmed-outcomes.json"), JSON.stringify({
      schema_version:1, source:"Flashscore", retention_policy:"permanent",
      date_checks:{}, matches:{
        "finished-corrected":{
          id:"finished-corrected", source:"Flashscore", status:"CONFIRMED",
          status_confirmation:"confirmed_finished", final_status:"FINISHED",
          final_score:"1 : 0", home_score:1, away_score:0,
          confirmed_at:"2026-11-09T20:00:00.000Z",
          final_match:{id:"finished-corrected",home:"Home A",away:"Away A",time:date+"T17:00:00.000Z"},
          revisions:[]
        }
      }
    }));

    const first = await settlement.settleOutcomes(dataDir, now);
    const outputPath = path.join(dataDir, "flashscore-confirmed-outcomes.json");
    const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(first.corrected_scores, 1, "a changed finished score must be audited as a correction");
    assert.equal(first.newly_confirmed, 0);
    assert.equal(output.matches["finished-corrected"].final_score, "2 : 1");
    assert.equal(output.matches["finished-corrected"].snapshots_count, 3);
    assert.equal(output.matches["finished-corrected"].revisions.length, 1);
    assert.equal(output.matches["finished-corrected"].revisions[0].final_score, "1 : 0");
    assert.equal(output.matches["not-finished"], undefined, "a live match must never be settled");
    assert.equal(output.matches["missing-score"], undefined, "a missing score must never be settled");
    assert.equal(output.pending_matches.length, 2);
    assert.equal(output.source, "Flashscore");
    assert.equal(output.retention_policy, "permanent");

    const cooldown = await settlement.settleOutcomes(dataDir, new Date(now.getTime() + 60 * 1000));
    assert.equal(cooldown.checked_dates, 0, "date checks must respect the 15-minute cooldown");

    process.stdout.write("Flashscore outcome settlement tests passed: explicit FINISHED status, valid score, pending matches, correction audit and check cooldown.\n");
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tempDir, {recursive:true,force:true});
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

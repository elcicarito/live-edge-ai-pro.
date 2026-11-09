"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const zlib = require("node:zlib");

const collectorPath = path.join(__dirname, "flashscore-only-collector.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flashscore-collector-test-"));
let liveRun = 0;

const server = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url.startsWith("/matches/live")) {
    liveRun += 1;
    res.end(JSON.stringify({
      competitions: [{
        competition: { name: "Test League", country: { name: "Testland" } },
        matches: [{
          id: "test-match-1",
          home: { id: "home-1", name: "Home FC" },
          away: { id: "away-1", name: "Away FC" },
          home_score: liveRun,
          away_score: 0,
          status: "live",
          stage: "2nd Half",
          available_tabs: ["statistics", "commentary"],
          has_statistics: true
        }]
      }]
    }));
    return;
  }
  if (req.url.startsWith("/matches/statistics")) {
    res.end(JSON.stringify({
      periods: [{
        period: "ALL",
        groups: [{
          category: "Match",
          statistics: [{
            name: "Shots on target",
            home_value: String(3 + liveRun),
            away_value: "2"
          }]
        }]
      }]
    }));
    return;
  }
  if (req.url.startsWith("/matches/commentary")) {
    res.end(JSON.stringify({
      comments: [{ minute: "57'", text: "Test commentary" }]
    }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

function runCollector() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [collectorPath], {
      cwd: tempDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve(stdout);
      else reject(new Error("Collector exit " + code + "\n" + stdout + "\n" + stderr));
    });
  });
}

(async () => {
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(8000, "127.0.0.1", resolve);
    });
    fs.mkdirSync(path.join(tempDir, "data"), { recursive: true });

    await runCollector();
    await runCollector();

    const dataDir = path.join(tempDir, "data");
    const current = JSON.parse(fs.readFileSync(path.join(dataDir, "flashscore-live-current.json"), "utf8"));
    const archive = JSON.parse(fs.readFileSync(path.join(dataDir, "flashscore-match-archive.json"), "utf8"));
    const index = JSON.parse(fs.readFileSync(path.join(dataDir, "flashscore-timeline-index.json"), "utf8"));

    assert.equal(current.source, "Flashscore");
    assert.equal(current.live_count, 1);
    assert.equal(current.records[0].match.live_minute, "57'");
    assert.equal(current.records[0].match.minute_source, "Flashscore commentary MB");
    assert.equal(current.records[0].match.stats[0].name, "Shots on target");
    assert.equal(archive.matches["test-match-1"].snapshots_count, 2);
    assert.equal(archive.matches["test-match-1"].score_change_count, 1);
    assert.equal(archive.matches["test-match-1"].stat_change_count, 1);
    assert.equal(index.weeks.length, 1);

    const timelinePath = path.join(dataDir, index.weeks[0].file);
    const lines = zlib.gunzipSync(fs.readFileSync(timelinePath), { finishFlush: zlib.constants.Z_FINISH })
      .toString("utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].snapshot.live_minute, "57'");
    assert.equal(lines[1].score_changed, true);
    assert.equal(lines[1].stat_changes.length, 1);

    process.stdout.write("Flashscore collector integration test passed: two snapshots, live minute, stats, score/stat changes, gzip timeline and index.\n");
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

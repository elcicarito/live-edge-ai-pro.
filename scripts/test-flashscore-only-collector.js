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

function isoWeekKey(date) {
  const d = new Date(date);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return d.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
}

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
        }, {
          id: "test-match-special",
          home: { id: "home-2", name: "Kings Home" },
          away: { id: "away-2", name: "Kings Away" },
          home_score: 1,
          away_score: 1,
          status: "live",
          stage: "2nd Half",
          available_tabs: ["commentary", "statistics"],
          has_statistics: false
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
  if (req.url.startsWith("/matches/details")) {
    res.end(JSON.stringify({
      id: "test-match-1",
      status: "live",
      stage: "2nd Half",
      live_clock_metadata: req.url.includes("test-match-special")
        ? {
            stage_start_epoch: Math.floor(Date.now() / 1000) - (11 * 60 + 20),
            stage_id: 13,
            stage_type_id: 2,
            core_minute: 31,
            format: "Played with special rules. Format: 2x20 minutes."
          }
        : {
            stage_start_epoch: Math.floor(Date.now() / 1000) - (10 * 60 + 20),
            stage_id: 13,
            stage_type_id: 2,
            format: null
          }
    }));
    return;
  }
  if (req.url.startsWith("/matches/commentary")) {
    res.end(JSON.stringify({
      comments: [{ minute: "57'", text: "Test commentary" }],
      available_tabs: req.url.includes("test-match-special") ? ["commentary", "statistics"] : ["commentary"]
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
    const previousWeek = isoWeekKey(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const previousTimeline = "flashscore-match-timeline-" + previousWeek + ".jsonl.gz";
    fs.writeFileSync(path.join(tempDir, "data", previousTimeline), zlib.gzipSync(Buffer.from("")));
    const ancientWeek = "2019-W01";
    const ancientTimeline = "flashscore-match-timeline-" + ancientWeek + ".jsonl.gz";
    fs.writeFileSync(path.join(tempDir, "data", ancientTimeline), zlib.gzipSync(Buffer.from("historical\n")));
    fs.writeFileSync(path.join(tempDir, "data", "flashscore-match-archive.json"), JSON.stringify({
      schema_version: 1, source: "Flashscore", created_at: "2019-01-01T00:00:00.000Z",
      updated_at: "2019-01-01T00:00:00.000Z", matches: {
        "ancient-match": { id: "ancient-match", home: "Old Home", away: "Old Away",
          first_seen_at: "2019-01-01T00:00:00.000Z", last_seen_at: "2019-01-01T00:00:00.000Z",
          snapshots_count: 1, last_snapshot: { collected_at: "2019-01-01T00:00:00.000Z" } }
      }
    }));
    fs.writeFileSync(path.join(tempDir, "data", "flashscore-timeline-index.json"), JSON.stringify({
      schema_version: 1, source: "Flashscore",
      weeks: [{ week: ancientWeek, file: ancientTimeline }, { week: previousWeek, file: previousTimeline }, "invalid-week-entry"]
    }));

    await runCollector();
    await runCollector();

    const dataDir = path.join(tempDir, "data");
    const current = JSON.parse(fs.readFileSync(path.join(dataDir, "flashscore-live-current.json"), "utf8"));
    const archive = JSON.parse(fs.readFileSync(path.join(dataDir, "flashscore-match-archive.json"), "utf8"));
    const index = JSON.parse(fs.readFileSync(path.join(dataDir, "flashscore-timeline-index.json"), "utf8"));

    assert.equal(current.source, "Flashscore");
    assert.equal(current.live_count, 2);
    assert.equal(current.stats_flagged_count, 1);
    assert.equal(current.stats_not_flagged_count, 1);
    assert.equal(current.stats_tab_available_count, 2);
    assert.equal(current.stats_requested_count, 2);
    assert.equal(current.stats_flagged_but_empty_count, 0);
    assert.equal(current.stats_match_count, 2);
    const standardMatch = current.records.find(record => record.match.id === "test-match-1").match;
    const specialMatch = current.records.find(record => record.match.id === "test-match-special").match;
    assert.equal(standardMatch.live_minute, 55, "standard second-half clock must include the 45-minute first half");
    assert.match(standardMatch.live_clock, /^55:\d{2}$/, "standard clock must preserve seconds");
    assert.equal(standardMatch.minute_source, "Flashscore eventStageStartTime");
    assert.equal(standardMatch.status_text, "2nd Half");
    assert.equal(standardMatch.last_event_minute, "57'");
    assert.equal(standardMatch.last_event_minute_source, "Flashscore commentary MB");
    assert.equal(standardMatch.commentary_count, 1);
    assert.equal(standardMatch.stats[0].name, "Shots on target");
    assert.equal(standardMatch.stats[0].label, "Shots on target", "timeline stats must expose the canonical label used by Momentum");
    assert.equal(standardMatch.has_statistics, true);
    assert.equal(standardMatch.stats_available, true);
    assert.equal(standardMatch.stats_fetch_status, "success_with_data");
    assert.ok(Number.isFinite(Date.parse(standardMatch.stats_collected_at)), "successful stats fetch must have its own timestamp");
    assert.equal(standardMatch.match_collected_at, standardMatch.collected_at, "match collection timestamp must remain backward-compatible");
    assert.equal(specialMatch.stats_fetch_status, "success_with_data");
    assert.ok(Number.isFinite(Date.parse(specialMatch.stats_collected_at)));
    assert.equal(specialMatch.has_statistics, false);
    assert.equal(specialMatch.stats_available, true, "statistics tab must trigger a fetch even when has_statistics is false");
    assert.equal(specialMatch.available_tabs.includes("statistics"), true);
    assert.equal(specialMatch.live_minute, 31, "2x20 special-rules match must use its 20-minute half");
    assert.equal(specialMatch.live_clock, "31'", "minute-only special-rules clock must use Flashscore's direct minute");
    assert.equal(specialMatch.minute_source, "Flashscore core DI (minute-only clock)");
    assert.equal(archive.matches["test-match-1"].snapshots_count, 2);
    assert.equal(archive.matches["test-match-special"].snapshots_count, 2);
    assert.ok(archive.matches["ancient-match"], "archive entries older than 90 days must never be deleted");
    assert.equal(archive.retention_policy, "permanent", "match archive must declare permanent retention");
    assert.ok(index.weeks.some(item => item.week === "2019-W01"), "ancient timeline weeks must remain indexed");
    assert.ok(fs.existsSync(path.join(dataDir, "flashscore-match-timeline-2019-W01.jsonl.gz")), "ancient timeline files must never be deleted");
    assert.equal(index.retention_policy, "permanent", "timeline index must declare permanent retention");
    assert.equal(archive.matches["test-match-1"].score_change_count, 1);
    assert.equal(archive.matches["test-match-1"].stat_change_count, 1);
    assert.ok(index.weeks.some(item => item.week === previousWeek), "previous indexed week must be retained");
    assert.ok(index.weeks.some(item => item.week !== previousWeek), "current indexed week must be added");

    const currentWeek = isoWeekKey(new Date());
    const currentWeekEntry = index.weeks.find(item => item.week === currentWeek);
    assert.ok(currentWeekEntry, "current week timeline must be indexed");
    const timelinePath = path.join(dataDir, currentWeekEntry.file);
    const lines = zlib.gunzipSync(fs.readFileSync(timelinePath), { finishFlush: zlib.constants.Z_FINISH })
      .toString("utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(lines.length, 4);
    const standardTimeline = lines.filter(line => line.match_id === "test-match-1");
    const specialTimeline = lines.filter(line => line.match_id === "test-match-special");
    assert.equal(standardTimeline[0].snapshot.live_minute, 55);
    assert.match(standardTimeline[0].snapshot.live_clock, /^55:\d{2}$/);
    assert.equal(standardTimeline[0].snapshot.last_event_minute, "57'");
    assert.equal(standardTimeline[1].score_changed, true);
    assert.equal(standardTimeline[1].stat_changes.length, 1);
    assert.equal(specialTimeline[0].snapshot.live_minute, 31);
    assert.equal(specialTimeline[0].snapshot.live_clock, "31'");
    assert.equal(standardTimeline[0].snapshot.has_statistics, true);
    assert.equal(standardTimeline[0].snapshot.stats_available, true);
    assert.equal(standardTimeline[0].snapshot.stats_fetch_status, "success_with_data");
    assert.ok(Number.isFinite(Date.parse(standardTimeline[0].snapshot.stats_collected_at)), "each archived snapshot must preserve its own statistics timestamp");
    assert.equal(specialTimeline[0].snapshot.has_statistics, false);
    assert.equal(specialTimeline[0].snapshot.stats_available, true);

    process.stdout.write("Flashscore collector integration test passed: standard and 2x20 clocks, seconds, separate event/live minute fields, stats, score/stat changes, gzip timeline, permanent retention and index.\n");
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

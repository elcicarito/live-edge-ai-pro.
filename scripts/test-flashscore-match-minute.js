"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "..", "scanner.js"), "utf8");
const start = source.indexOf("const minuteOf = snapshot => {");
assert.notEqual(start, -1, "minuteOf parser must exist in scanner.js");
const end = source.indexOf("\n    };", start);
assert.notEqual(end, -1, "minuteOf parser must be closed");
const expression = source.slice(start + "const minuteOf = ".length, end + 6).trim();
const minuteOf = vm.runInNewContext("const minuteOf = " + expression + "; minuteOf");

const cases = [
  [{ live_minute: 49 }, 49],
  [{ live_minute: "49′" }, 49],
  [{ live_clock: "49:23" }, 49],
  [{ live_clock: "45+2′" }, 47],
  [{ live_clock: "HT" }, null],
  [{ minute: "45:00" }, 45],
  [{ live_minute: "45+2" }, 47],
  [{ live_minute: "45+2′" }, 47],
  [{ live_minute: "90+4" }, 94],
  [{ live_minute: 120 }, 120],
  [{ live_minute: "HT" }, null],
  [{ live_minute: "FT" }, null],
  [{ live_minute: "2nd Half" }, null],
  [{ live_minute: "LIVE" }, null],
  [{ live_minute: "45+99" }, null],
  [{ live_minute: 0 }, 0]
];
for (const [snapshot, expected] of cases) {
  assert.equal(minuteOf(snapshot), expected, JSON.stringify(snapshot));
}
const pairStart = source.indexOf("const activityIntervalForPair = (");
assert.notEqual(pairStart, -1, "activity interval attribution helper must exist");
const pairEnd = source.indexOf("\n    };", pairStart);
assert.notEqual(pairEnd, -1, "activity interval attribution helper must be closed");
const pairExpression = source.slice(pairStart + "const activityIntervalForPair = ".length, pairEnd + 6).trim();
const activityIntervalForPair = vm.runInNewContext("const activityIntervalForPair = " + pairExpression + "; activityIntervalForPair");

const definitions = [
  { start: 1, end: 15, label: "01–15′" },
  { start: 16, end: 30, label: "16–30′" },
  { start: 31, end: 45, label: "31–45′" },
  { start: 46, end: 60, label: "46–60′" },
  { start: 61, end: 75, label: "61–75′" },
  { start: 76, end: 90, label: "76–90′" },
  { start: 91, end: 120, label: "90+′" }
];
assert.equal(activityIntervalForPair(0, 2, definitions).interval.label, "01–15′");
assert.equal(activityIntervalForPair(0, 16, definitions).reason, "crosses-interval-boundary");
assert.equal(activityIntervalForPair(12, 15, definitions).interval.label, "01–15′");
assert.equal(activityIntervalForPair(14, 15, definitions).interval.label, "01–15′");
assert.equal(activityIntervalForPair(15, 16, definitions).reason, "crosses-interval-boundary");
assert.equal(activityIntervalForPair(30, 31, definitions).reason, "crosses-interval-boundary");
assert.equal(activityIntervalForPair(46, 49, definitions).interval.label, "46–60′");
assert.equal(activityIntervalForPair(null, 47, definitions).reason, "unknown-start-minute");
assert.equal(activityIntervalForPair(45, null, definitions).reason, "unknown-current-minute");


const deriveStart = source.indexOf("const deriveScoreChanges = (");
assert.notEqual(deriveStart, -1, "score-change retrospective helper must exist");
const deriveEnd = source.indexOf("\n    };", deriveStart);
assert.notEqual(deriveEnd, -1, "score-change helper must be closed");
const deriveExpression = source.slice(deriveStart + "const deriveScoreChanges = ".length, deriveEnd + 6).trim();
const deriveScoreChanges = vm.runInNewContext("const deriveScoreChanges = " + deriveExpression + "; deriveScoreChanges");
const snapshots = [
  { time: 1000, match: { home_score: 1, away_score: 1, live_minute: "43′", home: "Home", away: "Away" } },
  { time: 2000, match: { home_score: 3, away_score: 1, live_minute: "55′", home: "Home", away: "Away" } }
];
const inferred = deriveScoreChanges(snapshots);
assert.equal(inferred.length, 1);
assert.equal(inferred[0].minute, "medzi 43′–55′");
assert.equal(inferred[0].detail, "Home · +2 · skóre 1:1 → 3:1");
assert.equal(inferred[0].derived, true);
assert.equal(deriveScoreChanges([snapshots[0], { time: 2000, match: { home_score: 1, away_score: 1, live_minute: "55′" } }]).length, 0,
  "unchanged score must not create a goal");
assert.equal(deriveScoreChanges([snapshots[0], { time: 2000, match: { home_score: 0, away_score: 1, live_minute: "55′" } }]).length, 0,
  "score reversals must not create a goal");
assert.equal(deriveScoreChanges(snapshots, [{ kind: "⚽ Gól", minute: "50′" }]).length, 0,
  "an official goal in the same interval must suppress a duplicate inferred goal");
const noMinute = deriveScoreChanges([
  { time: Date.parse("2026-11-11T12:46:00"), match: { home_score: 1, away_score: 1 } },
  { time: Date.parse("2026-11-11T13:14:00"), match: { home_score: 2, away_score: 1 } }
]);
assert.match(noMinute[0].minute, /12:46–13:14/, "missing match minute must use observation-time range");

console.log("Flashscore match-minute clock and activity-bin tests passed.");

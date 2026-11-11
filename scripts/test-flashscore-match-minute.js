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

console.log("Flashscore match-minute clock and activity-bin tests passed.");

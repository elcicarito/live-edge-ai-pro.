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
  [{ live_minute: 0 }, null]
];
for (const [snapshot, expected] of cases) {
  assert.equal(minuteOf(snapshot), expected, JSON.stringify(snapshot));
}
console.log("Flashscore match-minute parsing tests passed.");

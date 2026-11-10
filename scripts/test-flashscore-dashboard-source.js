"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scanner = fs.readFileSync(path.join(__dirname, "..", "scanner.js"), "utf8");

assert.match(
  scanner,
  /const CURRENT_URL = DATA_BASE_URL \+ "flashscore-primary-current\.json";/,
  "Main LIVE dashboard must read the Flashscore-only primary candidate."
);
assert.match(
  scanner,
  /contents\/data\/flashscore-primary-current\.json\?ref=live-data-v2/,
  "GitHub API fallback must point to the same Flashscore primary file."
);
assert.match(
  scanner,
  /const HISTORY_URL = DATA_BASE_URL \+ "live-history\.json";/,
  "Historical history remains on the legacy store during the staged migration."
);

console.log("Flashscore dashboard primary-source contract tests passed.");

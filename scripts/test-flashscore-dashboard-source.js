"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scanner = fs.readFileSync(path.join(__dirname, "..", "scanner.js"), "utf8");

assert.match(scanner, /const CURRENT_URL = DATA_BASE_URL \+ "flashscore-primary-current\.json";/);
assert.ok(scanner.includes("data/flashscore-primary-current.json"));
assert.ok(scanner.includes("flashscore-match-timeline-"));
assert.ok(scanner.includes("/git/blobs/"));
assert.ok(scanner.includes("current.recent_history"));
assert.ok(scanner.includes("recent_history_count"));
assert.ok(scanner.includes("GitHub API Blob"));
assert.match(scanner, /async function loadFlashscoreRecentHistory/);
assert.match(scanner, /flashscore-timeline-index\.json/);
assert.ok(scanner.includes("flashscore-confirmed-outcomes.json"));
assert.ok(scanner.includes('data.source !== "Flashscore"'));
assert.ok(scanner.includes('item?.status_confirmation === "confirmed_finished"'));
assert.doesNotMatch(scanner, /live-archive\.json|live-match-history|ESPN/);
assert.ok(scanner.includes("function historyRecords(historyData, id)"));
assert.ok(scanner.includes("matchId(row.match) === id"));
assert.match(scanner, /loadFlashscoreRecentHistory\(\)\.catch/);
assert.doesNotMatch(scanner, /const HISTORY_URL = DATA_BASE_URL \+ "live-history\.json"|LIVE MOMENTUM · ESPN|providerStatus\.ESPN/);

console.log("Flashscore dashboard primary-source and archive-history contract tests passed.");

const assert = require("node:assert/strict");
const { classifyESPNFeedState } = require("./espn-feed-state");

assert.equal(classifyESPNFeedState({
  complete: true, liveFixtureCount: 0, archiveSafe: true, baseline: 7
}), "NO_LIVE", "complete empty feed is a valid NO_LIVE state");

assert.equal(classifyESPNFeedState({
  complete: false, liveFixtureCount: 0, archiveSafe: false, baseline: 7
}), "PARTIAL", "incomplete empty feed remains PARTIAL");

assert.equal(classifyESPNFeedState({
  complete: true, liveFixtureCount: 3, archiveSafe: true, baseline: 7
}), "LIVE", "verified live feed is LIVE");

assert.equal(classifyESPNFeedState({
  complete: true, liveFixtureCount: 3, archiveSafe: false, baseline: null
}), "BASELINE_PENDING", "feed without baseline remains pending");

assert.equal(classifyESPNFeedState({
  complete: true, liveFixtureCount: 1, archiveSafe: false, baseline: 7
}), "SUSPECTED_DROP", "unexpected lower live count is guarded");

console.log("ESPN feed-state tests passed.");

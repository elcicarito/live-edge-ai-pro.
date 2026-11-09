"use strict";

function classifyESPNFeedState({
  complete,
  liveFixtureCount,
  archiveSafe,
  baseline
}) {
  if (!complete) return "PARTIAL";

  const count = Number(liveFixtureCount);
  if (count === 0) return "NO_LIVE";
  if (archiveSafe) return "LIVE";

  const hasBaseline = baseline !== null &&
    baseline !== undefined &&
    Number.isFinite(Number(baseline));

  return hasBaseline ? "SUSPECTED_DROP" : "BASELINE_PENDING";
}

module.exports = { classifyESPNFeedState };

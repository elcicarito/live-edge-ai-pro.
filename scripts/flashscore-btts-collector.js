"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DATA = path.join(process.cwd(), "data");
const CURRENT_PATH = path.join(DATA, "flashscore-live-current.json");
const ARCHIVE_PATH = path.join(DATA, "flashscore-btts-signal-archive.json");
const API_BASE = process.env.FLASHSCORE_API_BASE || "http://127.0.0.1:8000";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}
function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function statPair(stats, names) {
  const rows = Array.isArray(stats) ? stats : [];
  const wanted = names.map(x => x.toLowerCase());
  // Flashscore can return Match, 1st Half and 2nd Half rows together.
  // BTTS thresholds must use whole-match totals, never a half-only subtotal.
  const hasPeriodMetadata = rows.some(row => typeof row?.period === "string" && row.period.trim());
  const relevantRows = hasPeriodMetadata
    ? rows.filter(row => String(row.period || "").trim().toLowerCase() === "match")
    : rows; // Backward compatibility for older archived/test snapshots without period labels.
  const item = relevantRows.find(row =>
    wanted.includes(String(row.label || row.name || "").trim().toLowerCase())
  );
  if (!item) return null;
  const home = numeric(item.home_numeric ?? item.home);
  const away = numeric(item.away_numeric ?? item.away);
  return home === null || away === null ? null : { home, away };
}
function getBttsCandidates(match) {
  if (!match || match.source !== "Flashscore") return [];
  const minute = numeric(match.live_minute);
  if (!Number.isInteger(minute) || minute < 46 || minute > 50) return [];
  if (!/2nd\s*half|second\s*half/i.test(String(match.stage || match.status_text || ""))) return [];
  const homeScore = numeric(match.home_score);
  const awayScore = numeric(match.away_score);
  if (homeScore === null || awayScore === null) return [];

  const stats = Array.isArray(match.stats) && match.stats.length
    ? match.stats
    : Array.isArray(match.flashscore_stats) ? match.flashscore_stats : [];
  const sot = statPair(stats, ["shots on target"]);
  const total = statPair(stats, ["total shots"]);
  if (!sot || (!total && !off)) return [];

  const combinedSot = sot.home + sot.away;
  // Total Shots is a distinct Flashscore statistic; never estimate it from SOT + off-target.
  if (!total) return [];
  const combinedShots = total.home + total.away;
  const candidates = [];

  if (homeScore === 1 && awayScore === 0 && combinedSot >= 5) {
    if (combinedShots >= 8) candidates.push({
      tier: "1:0 · SOT ≥5 · strely ≥8",
      tierKey: "10_sot5_shots8",
      predictedSide: "away"
    });
    if (combinedShots >= 10) candidates.push({
      tier: "1:0 · SOT ≥5 · strely ≥10",
      tierKey: "10_sot5_shots10",
      predictedSide: "away"
    });
    if (combinedShots >= 12) candidates.push({
      tier: "1:0 · SOT ≥5 · strely ≥12",
      tierKey: "10_sot5_shots12",
      predictedSide: "away"
    });
  } else if (homeScore === 0 && awayScore === 1 &&
             combinedSot >= 6 && combinedShots >= 8) {
    candidates.push({
      tier: "0:1 · SOT ≥6 · strely ≥8",
      tierKey: "01_sot6_shots8",
      predictedSide: "home"
    });
  }
  return candidates.map(candidate => ({
    ...candidate, minute, homeScore, awayScore, combinedSot, combinedShots
  }));
}

function getBttsAfter70Candidate(match) {
  if (!match || match.source !== "Flashscore") return null;
  const minute = numeric(match.live_minute);
  if (!Number.isInteger(minute) || minute <= 70) return null;
  if (!/2nd\\s*half|second\\s*half/i.test(String(match.stage || match.status_text || ""))) return null;
  const homeScore = numeric(match.home_score);
  const awayScore = numeric(match.away_score);
  if (homeScore === null || awayScore === null) return null;
  const stats = Array.isArray(match.stats) && match.stats.length
    ? match.stats
    : Array.isArray(match.flashscore_stats) ? match.flashscore_stats : [];
  const sot = statPair(stats, ["shots on target"]);
  const total = statPair(stats, ["total shots"]);
  if (!sot || !total) return null;
  const combinedSot = sot.home + sot.away;
  const combinedShots = total.home + total.away;
  let tier = null, tierKey = null, predictedSide = null;
  if (homeScore === 1 && awayScore === 0 && combinedSot >= 5 && combinedShots >= 12) {
    tier = "70+ · 1:0 · SOT ≥5 · strely ≥12"; tierKey = "70plus_10_sot5_shots12"; predictedSide = "away";
  } else if (homeScore === 1 && awayScore === 0 && combinedSot >= 5 && combinedShots >= 10) {
    tier = "70+ · 1:0 · SOT ≥5 · strely ≥10"; tierKey = "70plus_10_sot5_shots10"; predictedSide = "away";
  } else if (homeScore === 1 && awayScore === 0 && combinedSot >= 5 && combinedShots >= 8) {
    tier = "70+ · 1:0 · SOT ≥5 · strely ≥8"; tierKey = "70plus_10_sot5_shots8"; predictedSide = "away";
  } else if (homeScore === 0 && awayScore === 1 && combinedSot >= 6 && combinedShots >= 8) {
    tier = "70+ · 0:1 · SOT ≥6 · strely ≥8"; tierKey = "70plus_01_sot6_shots8"; predictedSide = "home";
  }
  return tier ? { tier, tierKey, predictedSide, minute, homeScore, awayScore, combinedSot, combinedShots } : null;
}

function isFinished(detail) {
  const status = String(detail?.status || detail?.stage || detail?.status_text || "").toLowerCase();
  return /finished|full.?time|after extra time|after penalties|^ft$/.test(status);
}
async function getDetails(matchId) {
  const response = await fetch(API_BASE + "/matches/details?match=" + encodeURIComponent(matchId), {
    headers: { Accept: "application/json", "User-Agent": "LIVE-EDGE-AI-PRO/9.2" },
    signal: AbortSignal.timeout(20000),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Flashscore details HTTP " + response.status);
  return response.json();
}
async function run({ current, archive, detailsFetcher = getDetails, now = new Date().toISOString() }) {
  if (!current || current.source !== "Flashscore" || !Array.isArray(current.records)) {
    throw new Error("Neplatný alebo chýbajúci Flashscore LIVE snapshot.");
  }
  const output = archive && archive.source === "Flashscore" && Array.isArray(archive.signals)
    ? archive
    : { schema_version: 1, source: "Flashscore", created_at: now, updated_at: null, signals: [] };

  const liveIds = new Set();
  let captured = 0;
  for (const record of current.records) {
    const match = record?.match;
    if (!match || match.source !== "Flashscore" || !match.id) continue;
    const id = String(match.id);
    liveIds.add(id);
    const collectedAt = record.collected_at || current.collected_at || now;
    const age = Date.now() - Date.parse(collectedAt);
    if (!Number.isFinite(age) || age < -60000 || age > 7 * 60 * 1000) continue;

    const standardCandidates = getBttsCandidates(match);\n    const lateCandidate = getBttsAfter70Candidate(match);\n    // The 70+ group records only the strongest qualifying tier once per match.\n    for (const candidate of [...standardCandidates, ...(lateCandidate ? [lateCandidate] : [])]) {
      const signalId = "flashscore_btts_" + id + "_" + candidate.tierKey;
      if (output.signals.some(item => item.signalId === signalId)) continue;
      output.signals.push({
        signalId,
        model: "BTTS",
        source: "Flashscore",
        matchId: id,
        home: match.home || null,
        away: match.away || null,
        competition: match.competition || null,
        country: match.country || null,
        predictedSide: candidate.predictedSide,
        predictedTeam: candidate.predictedSide === "home" ? match.home : match.away,
        tier: candidate.tier,
        tierKey: candidate.tierKey,
        startMinute: candidate.minute,
        startClock: match.live_clock || String(candidate.minute) + "'",
        startScore: candidate.homeScore + ":" + candidate.awayScore,
        combinedSot: candidate.combinedSot,
        combinedShots: candidate.combinedShots,
        createdAt: collectedAt,
        status: "OPEN",
        sourceSnapshot: {
          collected_at: collectedAt,
          minute: candidate.minute,
          live_clock: match.live_clock || null,
          stage: match.stage || match.status_text || null,
          home_score: candidate.homeScore,
          away_score: candidate.awayScore,
          raw_stats: Array.isArray(match.stats) && match.stats.length ? match.stats : match.flashscore_stats || []
        }
      });
      captured++;
      console.log("FLASHSCORE BTTS SIGNAL CAPTURED:", signalId, candidate.tier);
    }
  }

  let settled = 0;
  for (const signal of output.signals) {
    if (signal.source !== "Flashscore" || signal.status !== "OPEN" || liveIds.has(String(signal.matchId))) continue;
    try {
      const detail = await detailsFetcher(String(signal.matchId));
      if (!isFinished(detail)) continue;
      const home = numeric(detail.home_score);
      const away = numeric(detail.away_score);
      if (home === null || away === null) continue;
      const predicted = signal.predictedSide === "home" ? home : away;
      const starting = signal.predictedSide === "home"
        ? numeric(signal.sourceSnapshot?.home_score)
        : numeric(signal.sourceSnapshot?.away_score);
      if (starting === null) continue;
      signal.status = predicted > starting ? "WIN" : "LOSS";
      signal.settledAt = now;
      signal.settledScore = home + ":" + away;
      signal.settlementNote = signal.status === "WIN"
        ? "Predikovaný tím skóroval po vytvorení signálu."
        : "Predikovaný tím po vytvorení signálu už neskóroval.";
      signal.finalStatus = detail.status || detail.stage || null;
      settled++;
    } catch (error) {
      signal.lastFinalCheckError = error.message;
      signal.lastFinalCheckAt = now;
    }
  }

  output.updated_at = now;
  output.last_collection_at = current.collected_at || now;
  output.last_run = {
    captured,
    settled,
    live_flashscore_matches: liveIds.size,
    checked_at: now
  };
  return output;
}

async function main() {
  const current = readJson(CURRENT_PATH, null);
  const archive = readJson(ARCHIVE_PATH, {
    schema_version: 1, source: "Flashscore", created_at: new Date().toISOString(), signals: []
  });
  const output = await run({ current, archive });
  writeJson(ARCHIVE_PATH, output);
  console.log("FLASHSCORE BTTS COLLECTOR:", JSON.stringify({
    total: output.signals.length,
    open: output.signals.filter(x => x.status === "OPEN").length,
    wins: output.signals.filter(x => x.status === "WIN").length,
    losses: output.signals.filter(x => x.status === "LOSS").length,
    ...output.last_run
  }));
}

if (require.main === module) main().catch(error => {
  console.error("FLASHSCORE BTTS COLLECTOR FAILED:", error);
  process.exit(1);
});
module.exports = { getBttsCandidates, getBttsAfter70Candidate, run, isFinished };

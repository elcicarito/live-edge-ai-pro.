"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const readline = require("node:readline");

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
// These calculations intentionally mirror scanner.js AI Quality v1.
const MIN_GAP_MINUTES = 1.5;
const MAX_GAP_MINUTES = 15;
function statValue(stats, keyword) {
  const candidates = (Array.isArray(stats) ? stats : []).filter(stat =>
    String(stat?.label || stat?.name || stat?.type || stat?.category || "").trim().toLowerCase().includes(keyword)
  );
  if (!candidates.length) return null;
  const hasPeriod = candidates.some(stat => String(stat?.period || "").trim());
  const item = hasPeriod
    ? candidates.find(stat => String(stat?.period || "").trim().toLowerCase() === "match")
    : candidates[0];
  if (!item) return null;
  const parse = value => {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const n = Number(String(value).replace("%", "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };
  const home = parse(item.home_numeric ?? item.home);
  const away = parse(item.away_numeric ?? item.away);
  return home === null || away === null ? null : { home, away };
}
function uniqueHistory(match, history, collectedAt) {
  const id = String(match?.id || "");
  const currentTime = Date.parse(collectedAt || "");
  const rows = (Array.isArray(history) ? history : [])
    .filter(row => row?.match && String(row.match.id || "") === id &&
      Number.isFinite(row.time) &&
      (!Number.isFinite(currentTime) || (row.time >= currentTime - 24 * 60 * 60 * 1000 && row.time <= currentTime + 60000)))
    .map(row => ({ time: Number(row.time), match: row.match }))
    .sort((a, b) => a.time - b.time);
  if (Number.isFinite(currentTime) && !rows.some(row => Math.abs(row.time - currentTime) < 1000)) {
    rows.push({ time: currentTime, match });
    rows.sort((a, b) => a.time - b.time);
  }
  return rows.filter((row, index) => index === 0 || row.time !== rows[index - 1].time);
}
function calculatePressure(stats) {
  const measures = [{ key: "possession", weight: 0.10 }, { key: "shots on target", weight: 0.40 }, { key: "shots off target", weight: 0.50 }];
  let home = 0, away = 0, totalWeight = 0;
  for (const measure of measures) {
    const value = statValue(stats, measure.key);
    if (!value) continue;
    const total = value.home + value.away;
    const ratio = total > 0 ? value.home / total : 0.5;
    home += ratio * measure.weight;
    away += (1 - ratio) * measure.weight;
    totalWeight += measure.weight;
  }
  return totalWeight ? { home: Math.round(home / totalWeight * 100), away: Math.round(away / totalWeight * 100) } : null;
}
function getMatchReliability(records) {
  if (!records.length) return null;
  let momentumReady = 0;
  for (const row of records) {
    const stats = row.match?.stats || [];
    if (statValue(stats, "shots on target") && statValue(stats, "shots off target")) momentumReady++;
  }
  const gaps = [];
  for (let i = 1; i < records.length; i++) {
    const minutes = (records[i].time - records[i - 1].time) / 60000;
    if (Number.isFinite(minutes) && minutes > 0) gaps.push(minutes);
  }
  return {
    count: records.length,
    momentumCoverage: Math.round(momentumReady / records.length * 100),
    maxGap: gaps.length ? Math.max(...gaps) : null
  };
}
function getActivitySnapshot(match, records, collectedAt) {
  const currentShots = statValue(match.stats || [], "shots on target");
  const currentAttacks = statValue(match.stats || [], "shots off target");
  if (!currentShots || !currentAttacks) return null;
  const currentTime = Date.parse(collectedAt || "");
  if (!Number.isFinite(currentTime)) return null;
  const previous = records.filter(row => row.time < currentTime - 1000).at(-1);
  if (!previous) return null;
  const minutes = (currentTime - previous.time) / 60000;
  if (!Number.isFinite(minutes) || minutes < MIN_GAP_MINUTES || minutes > MAX_GAP_MINUTES) return null;
  const oldShots = statValue(previous.match.stats || [], "shots on target");
  const oldAttacks = statValue(previous.match.stats || [], "shots off target");
  if (!oldShots || !oldAttacks ||
      currentShots.home < oldShots.home || currentShots.away < oldShots.away ||
      currentAttacks.home < oldAttacks.home || currentAttacks.away < oldAttacks.away) return null;
  const homeActivity = (currentShots.home - oldShots.home) * 3 + currentAttacks.home - oldAttacks.home;
  const awayActivity = (currentShots.away - oldShots.away) * 3 + currentAttacks.away - oldAttacks.away;
  return {
    homeActivityRate: homeActivity / minutes * 10,
    awayActivityRate: awayActivity / minutes * 10,
    intervalMinutes: Number(minutes.toFixed(1)),
    previousCollectedAt: new Date(previous.time).toISOString()
  };
}
function getAcceleration(records) {
  const intervals = [];
  let previousValidIntervalEnd = null;
  const consecutive = [];
  for (let i = 1; i < records.length; i++) {
    const previous = records[i - 1], current = records[i];
    const minutes = (current.time - previous.time) / 60000;
    if (!Number.isFinite(minutes) || minutes < MIN_GAP_MINUTES || minutes > MAX_GAP_MINUTES) {
      previousValidIntervalEnd = null; consecutive.length = 0; continue;
    }
    const oldSot = statValue(previous.match.stats || [], "shots on target");
    const sot = statValue(current.match.stats || [], "shots on target");
    const oldOff = statValue(previous.match.stats || [], "shots off target");
    const off = statValue(current.match.stats || [], "shots off target");
    if (!oldSot || !sot || !oldOff || !off ||
        sot.home < oldSot.home || sot.away < oldSot.away ||
        off.home < oldOff.home || off.away < oldOff.away) {
      previousValidIntervalEnd = null; consecutive.length = 0; continue;
    }
    const interval = {
      time: current.time,
      homeRate: ((sot.home - oldSot.home) * 3 + off.home - oldOff.home) / minutes * 10,
      awayRate: ((sot.away - oldSot.away) * 3 + off.away - oldOff.away) / minutes * 10
    };
    intervals.push(interval);
    if (previousValidIntervalEnd === previous.time) consecutive.push(interval);
    else { consecutive.length = 0; consecutive.push(interval); }
    previousValidIntervalEnd = current.time;
  }
  if (consecutive.length < 2) return null;
  const prev = consecutive.at(-2), last = consecutive.at(-1);
  return {
    homeDelta: Number((last.homeRate - prev.homeRate).toFixed(1)),
    awayDelta: Number((last.awayRate - prev.awayRate).toFixed(1))
  };
}
function buildSignalContext(match, history, collectedAt, now) {
  const records = uniqueHistory(match, history, collectedAt);
  const pressure = calculatePressure(match.stats || []);
  const activity = getActivitySnapshot(match, records, collectedAt);
  const threat = pressure && activity ? {
    home: Math.min(100, Math.round(pressure.home * 0.45 + Math.min(activity.homeActivityRate * 3, 40) * 0.55)),
    away: Math.min(100, Math.round(pressure.away * 0.45 + Math.min(activity.awayActivityRate * 3, 40) * 0.55))
  } : null;
  const reliability = getMatchReliability(records);
  const acceleration = getAcceleration(records);
  const age = Date.parse(now) - Date.parse(collectedAt || "");
  let quality = null;
  if (threat && activity && reliability && reliability.count >= 3 &&
      Number.isFinite(age) && age >= 0 && age <= 7 * 60 * 1000) {
    const freshness = age <= 2 * 60000 ? 100 : age <= 4 * 60000 ? 80 : age <= 7 * 60000 ? 50 : 0;
    const sampleDepth = Math.min(100, reliability.count / 5 * 100);
    const dataQuality = Math.round(reliability.momentumCoverage * 0.7 + sampleDepth * 0.3);
    quality = {};
    for (const side of ["home", "away"]) {
      const activityRate = activity[side + "ActivityRate"];
      const components = [
        { value: dataQuality, weight: 25 },
        { value: freshness, weight: 20 },
        { value: threat[side], weight: 20 },
        { value: Math.max(0, Math.min(100, activityRate * 10)), weight: 20 }
      ];
      if (acceleration) components.push({
        value: Math.max(0, Math.min(100, 50 + acceleration[side + "Delta"] * 5)),
        weight: 15
      });
      const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
      quality[side] = Math.round(components.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight);
    }
  }
  return {
    version: "scanner-ai-quality-v1",
    sample_count: reliability?.count ?? records.length,
    momentum_coverage_pct: reliability?.momentumCoverage ?? null,
    pressure,
    goal_threat: threat,
    activity_rate_per_10min: activity ? {
      home: Number(activity.homeActivityRate.toFixed(1)),
      away: Number(activity.awayActivityRate.toFixed(1)),
      interval_minutes: activity.intervalMinutes,
      previous_collected_at: activity.previousCollectedAt
    } : null,
    acceleration,
    ai_quality_score: quality
  };
}
async function loadTimelineHistory(dataDir = DATA) {
  const index = readJson(path.join(dataDir, "flashscore-timeline-index.json"), null);
  if (!index || index.source !== "Flashscore" || !Array.isArray(index.weeks)) return [];
  const rows = [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const week of index.weeks.slice(0, 2)) {
    if (!/^flashscore-match-timeline-\\d{4}-W\\d{2}\\.jsonl\\.gz$/.test(week?.file || "")) continue;
    const file = path.join(dataDir, week.file);
    if (!fs.existsSync(file)) continue;
    const input = fs.createReadStream(file).pipe(zlib.createGunzip());
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let entry; try { entry = JSON.parse(line); } catch { continue; }
      const snap = entry.snapshot || {};
      const time = Date.parse(snap.collected_at || "");
      if (!entry.match_id || !Number.isFinite(time) || time < cutoff) continue;
      const stats = (Array.isArray(snap.stats) ? snap.stats : []).map(item => ({
        ...item, label: item.label || item.name || "",
        home: item.home_numeric ?? item.home, away: item.away_numeric ?? item.away
      }));
      rows.push({ time, match: {
        id: String(entry.match_id), source: "Flashscore", status: "live",
        status_text: String(snap.stage || "LIVE"), stage: snap.stage || null,
        live_minute: snap.live_minute ?? null, live_clock: snap.live_clock || null,
        home_score: snap.home_score ?? null, away_score: snap.away_score ?? null, stats
      }});
    }
  }
  return rows;
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
  if (!sot || !total) return [];

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
    ...candidate,
    minute,
    homeScore,
    awayScore,
    combinedSot,
    combinedShots,
    homeSot: sot.home,
    awaySot: sot.away,
    homeShots: total.home,
    awayShots: total.away
  }));
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
async function run({ current, archive, history = [], detailsFetcher = getDetails, now = new Date().toISOString() }) {
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

    const historyRows = history.filter(row => String(row.match?.id || "") === id);
    for (const candidate of getBttsCandidates(match)) {
      const signalContext = buildSignalContext(match, historyRows, collectedAt, now);
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
        pressureHome: signalContext.pressure?.home ?? null,
        pressureAway: signalContext.pressure?.away ?? null,
        goalThreatHome: signalContext.goal_threat?.home ?? null,
        goalThreatAway: signalContext.goal_threat?.away ?? null,
        activityHome: signalContext.activity_rate_per_10min?.home ?? null,
        activityAway: signalContext.activity_rate_per_10min?.away ?? null,
        ...(Number.isFinite(signalContext.ai_quality_score?.[candidate.predictedSide]) ? {
          qualityScore: signalContext.ai_quality_score[candidate.predictedSide],
          qualityScoreVersion: "ai-quality-v1",
          qualityScoreSide: candidate.predictedSide
        } : {}),
        createdAt: collectedAt,
        status: "OPEN",
        sourceSnapshot: {
          schema_version: 2,
          collected_at: collectedAt,
          minute: candidate.minute,
          live_clock: match.live_clock || null,
          stage: match.stage || match.status_text || null,
          home_score: candidate.homeScore,
          away_score: candidate.awayScore,
          stats_summary: {
            home_shots_on_target: candidate.homeSot,
            away_shots_on_target: candidate.awaySot,
            combined_shots_on_target: candidate.combinedSot,
            home_total_shots: candidate.homeShots,
            away_total_shots: candidate.awayShots,
            combined_total_shots: candidate.combinedShots
          },
          metric_availability: {
            score: true,
            minute: true,
            shots_on_target: true,
            total_shots: true,
            goal_threat: Boolean(signalContext.goal_threat),
            activity_rate: Boolean(signalContext.activity_rate_per_10min),
            ai_quality_score: Boolean(signalContext.ai_quality_score)
          },
          scanner_context: signalContext,
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
  const history = await loadTimelineHistory();
  const output = await run({ current, archive, history });
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
module.exports = { getBttsCandidates, run, isFinished, buildSignalContext, loadTimelineHistory };

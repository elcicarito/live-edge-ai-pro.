"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DATA = path.resolve(__dirname, "..", "data");
const ARCHIVE_PATH = path.join(DATA, "flashscore-match-archive.json");
const OUTCOMES_PATH = path.join(DATA, "flashscore-confirmed-outcomes.json");
const API_BASE = String(process.env.FLASHSCORE_API_BASE || "http://127.0.0.1:8000").replace(/\/$/, "");
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const RECENT_RECHECK_DAYS = 7;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error("Poškodený JSON " + file + ": " + error.message);
  }
}

function atomicJson(file, value) {
  const temporary = file + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temporary, file);
}

function nameOf(value) {
  if (typeof value === "string") return value.trim();
  return String(value?.name || value?.full_name || value?.short_name || "").trim();
}

function dateKey(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : "";
}

function validScore(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function flattenMatches(payload) {
  if (!payload || !Array.isArray(payload.competitions)) {
    throw new Error("Flashscore výsledkový feed nemá platné competitions.");
  }
  const matches = [];
  for (const group of payload.competitions) {
    for (const match of Array.isArray(group.matches) ? group.matches : []) {
      matches.push({
        ...match,
        competition: match.competition || group.competition
      });
    }
  }
  return matches;
}

function dueForCheck(date, dateChecks, nowMs) {
  const last = Date.parse(dateChecks?.[date]?.last_checked_at || "");
  return !Number.isFinite(last) || nowMs - last >= CHECK_INTERVAL_MS;
}

function selectDates(archive, outcomes, nowMs = Date.now()) {
  const matches = Object.values(archive.matches || {});
  const byDate = new Map();
  for (const match of matches) {
    const date = dateKey(match.start_time);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(match);
  }
  const checks = outcomes.date_checks || {};
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const cutoff = nowMs - RECENT_RECHECK_DAYS * 86400000;
  const recent = [...byDate.keys()]
    .filter(date => Date.parse(date + "T00:00:00Z") >= cutoff && date <= today)
    .filter(date => dueForCheck(date, checks, nowMs))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 2);
  const pending = [...byDate.entries()]
    .filter(([date, entries]) => entries.some(match => !outcomes.matches?.[String(match.id)]))
    .map(([date]) => date)
    .filter(date => dueForCheck(date, checks, nowMs))
    .sort((a, b) => {
      const ta = Date.parse(checks[a]?.last_checked_at || "") || 0;
      const tb = Date.parse(checks[b]?.last_checked_at || "") || 0;
      return ta - tb || b.localeCompare(a);
    })
    .slice(0, 2);
  return [...new Set([...recent, ...pending])].slice(0, 4);
}

async function fetchFinishedForDate(date) {
  const url = new URL(API_BASE + "/matches");
  url.searchParams.set("sport", "football");
  url.searchParams.set("date", date);
  url.searchParams.set("timezone", "0");
  url.searchParams.set("status", "finished");
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "LIVE-EDGE-AI-PRO/10.0" },
    signal: AbortSignal.timeout(30000),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("/matches date=" + date + " HTTP " + response.status);
  return flattenMatches(await response.json());
}

function buildFinalMatch(match, archived) {
  const home = nameOf(match.home) || archived.home || "";
  const away = nameOf(match.away) || archived.away || "";
  const competition = nameOf(match.competition) || archived.competition || "";
  const country = nameOf(match.competition?.country) || archived.country || "";
  const startTime = match.start_time || archived.start_time || null;
  return {
    id: String(match.id),
    source: "Flashscore",
    status: "finished",
    status_text: String(match.stage || "Finished"),
    home,
    away,
    competition,
    country,
    time: startTime,
    start_time: startTime,
    home_score: validScore(match.home_score),
    away_score: validScore(match.away_score),
    winner: match.winner || null
  };
}

function settleOne(match, archived, outcomes, confirmedAt) {
  if (String(match?.status || "").toLowerCase() !== "finished") return false;
  const homeScore = validScore(match.home_score);
  const awayScore = validScore(match.away_score);
  if (homeScore === null || awayScore === null) return false;
  const id = String(match.id || "");
  if (!id || !archived || !outcomes.matches) return false;
  const finalMatch = buildFinalMatch(match, archived);
  const finalScore = homeScore + " : " + awayScore;
  const previous = outcomes.matches[id];
  if (previous && previous.final_score === finalScore) return false;
  const revisions = Array.isArray(previous?.revisions) ? previous.revisions.slice() : [];
  if (previous) {
    revisions.push({
      revision: revisions.length + 1,
      final_score: previous.final_score,
      home_score: previous.home_score,
      away_score: previous.away_score,
      confirmed_at: previous.confirmed_at || null,
      superseded_at: confirmedAt,
      reason: "Flashscore returned a different explicitly finished score."
    });
  }
  outcomes.matches[id] = {
    id,
    source: "Flashscore",
    status: "CONFIRMED",
    status_confirmation: "confirmed_finished",
    final_status: "FINISHED",
    final_score: finalScore,
    snapshots_count: Number(archived.snapshots_count || 0),
    home_score: homeScore,
    away_score: awayScore,
    final_match: finalMatch,
    first_confirmed_at: previous?.first_confirmed_at || confirmedAt,
    confirmed_at: confirmedAt,
    archived_at: confirmedAt,
    revisions
  };
  return true;
}

function pendingMatches(archive, outcomes) {
  return Object.values(archive.matches || {})
    .filter(match => !outcomes.matches?.[String(match.id)])
    .map(match => ({
      id: String(match.id),
      source: "Flashscore",
      last_missing_at: match.last_seen_at || null,
      last_checked_status: "čaká na explicitný konečný výsledok Flashscore",
      final_check_attempts: Number(outcomes.date_checks?.[dateKey(match.start_time)]?.attempts || 0),
      last_snapshot: {
        match: {
          id: String(match.id),
          source: "Flashscore",
          status: "live",
          status_text: match.last_snapshot?.stage || "LIVE",
          home: match.home,
          away: match.away,
          competition: match.competition,
          country: match.country,
          start_time: match.start_time,
          home_score: match.last_snapshot?.home_score ?? null,
          away_score: match.last_snapshot?.away_score ?? null,
          stats: Array.isArray(match.last_snapshot?.stats) ? match.last_snapshot.stats : []
        }
      }
    }));
}

async function settleOutcomes(dataDir = DATA, now = new Date()) {
  const archive = readJson(path.join(dataDir, "flashscore-match-archive.json"), null);
  if (!archive || archive.source !== "Flashscore" || !archive.matches || typeof archive.matches !== "object") {
    throw new Error("Chýba platný trvalý Flashscore match archív.");
  }
  const outcomesPath = path.join(dataDir, "flashscore-confirmed-outcomes.json");
  const existing = readJson(outcomesPath, null);
  if (existing && (existing.source !== "Flashscore" || !existing.matches || typeof existing.matches !== "object")) {
    throw new Error("Flashscore výsledkový archív má neplatnú štruktúru; odmietam prepísať.");
  }
  const outcomes = existing || {
    schema_version: 1,
    source: "Flashscore",
    retention_policy: "permanent",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    date_checks: {},
    matches: {},
    pending_matches: [],
    archived_matches: []
  };
  if (!outcomes.date_checks || typeof outcomes.date_checks !== "object") outcomes.date_checks = {};
  if (!outcomes.matches || typeof outcomes.matches !== "object") outcomes.matches = {};
  const dates = selectDates(archive, outcomes, now.getTime());
  let changed = !existing;
  for (const [id, outcome] of Object.entries(outcomes.matches)) {
    const archivedMatch = archive.matches[id];
    if (archivedMatch && !Number.isInteger(outcome.snapshots_count)) {
      outcome.snapshots_count = Number(archivedMatch.snapshots_count || 0);
      changed = true;
    }
  }
  let checkedDates = 0;
  let feedMatches = 0;
  let newConfirmed = 0;
  let corrected = 0;
  const errors = [];
  for (const date of dates) {
    try {
      const finished = await fetchFinishedForDate(date);
      feedMatches += finished.length;
      let settledOnDate = 0;
      for (const match of finished) {
        const id = String(match?.id || "");
        const archived = archive.matches[id];
        if (!archived) continue;
        const previous = outcomes.matches[id];
        const didSettle = settleOne(match, archived, outcomes, now.toISOString());
        if (!didSettle) continue;
        changed = true;
        settledOnDate++;
        if (previous) corrected++;
        else newConfirmed++;
      }
      outcomes.date_checks[date] = {
        last_checked_at: now.toISOString(),
        attempts: Number(outcomes.date_checks[date]?.attempts || 0) + 1,
        finished_feed_count: finished.length,
        archived_matches_confirmed: settledOnDate,
        error: null
      };
      checkedDates++;
      changed = true;
    } catch (error) {
      errors.push(date + ": " + (error?.message || String(error)));
      outcomes.date_checks[date] = {
        last_checked_at: now.toISOString(),
        attempts: Number(outcomes.date_checks[date]?.attempts || 0) + 1,
        finished_feed_count: 0,
        archived_matches_confirmed: 0,
        error: error?.message || String(error)
      };
      checkedDates++;
      changed = true;
    }
  }
  const pending = pendingMatches(archive, outcomes);
  const archivedMatches = Object.values(outcomes.matches)
    .sort((a, b) => Date.parse(b.confirmed_at || 0) - Date.parse(a.confirmed_at || 0));
  const beforePending = JSON.stringify(outcomes.pending_matches || []);
  const beforeArchived = JSON.stringify(outcomes.archived_matches || []);
  outcomes.pending_matches = pending;
  outcomes.archived_matches = archivedMatches;
  outcomes.updated_at = now.toISOString();
  if (beforePending !== JSON.stringify(pending) || beforeArchived !== JSON.stringify(archivedMatches)) changed = true;
  if (changed) atomicJson(outcomesPath, outcomes);
  return {
    source: "Flashscore",
    checked_dates: checkedDates,
    dates,
    feed_matches: feedMatches,
    newly_confirmed: newConfirmed,
    corrected_scores: corrected,
    pending_matches: pending.length,
    total_confirmed: archivedMatches.length,
    errors,
    changed
  };
}

async function main() {
  const result = await settleOutcomes();
  console.log("FLASHSCORE CONFIRMED OUTCOMES:", JSON.stringify(result));
}

if (require.main === module) {
  main().catch(error => {
    console.error("FLASHSCORE OUTCOME SETTLEMENT FAILED:", error.message);
    process.exit(1);
  });
}

module.exports = {
  dateKey,
  validScore,
  flattenMatches,
  selectDates,
  buildFinalMatch,
  settleOne,
  pendingMatches,
  settleOutcomes
};

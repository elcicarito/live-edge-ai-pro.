"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BASE = "http://127.0.0.1:8000";
const DATA = "data";
const CURRENT_PATH = path.join(DATA, "flashscore-live-current.json");
const ARCHIVE_PATH = path.join(DATA, "flashscore-match-archive.json");
const TIMELINE_PATH = path.join(DATA, "flashscore-match-timeline.jsonl");
const MAX_ARCHIVE_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const now = new Date().toISOString();

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error("Poškodený JSON " + file + ": " + error.message);
  }
}
function atomicJson(file, value) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}
function nameOf(value) {
  if (typeof value === "string") return value.trim();
  return String(value?.name || value?.full_name || value?.short_name || "").trim();
}
function numberOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace("%", "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
async function getJSON(endpoint, params = {}) {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(BASE + endpoint + (query ? "?" + query : ""), {
    headers: { Accept: "application/json", "User-Agent": "LIVE-EDGE-AI-PRO/10.0" },
    signal: AbortSignal.timeout(25000),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(endpoint + " HTTP " + response.status);
  return response.json();
}
function allStats(payload) {
  const out = [];
  for (const period of Array.isArray(payload?.periods) ? payload.periods : []) {
    for (const group of Array.isArray(period?.groups) ? period.groups : []) {
      for (const stat of Array.isArray(group?.statistics) ? group.statistics : []) {
        out.push({
          category: group.category || null,
          period: period.period || null,
          name: stat.name || null,
          home: stat.home_value ?? stat.home ?? null,
          away: stat.away_value ?? stat.away ?? null,
          home_numeric: numberOf(stat.home_value ?? stat.home),
          away_numeric: numberOf(stat.away_value ?? stat.away)
        });
      }
    }
  }
  return out;
}
function makeMatch(raw, competition, stats, statsError) {
  const home = nameOf(raw.home), away = nameOf(raw.away);
  const stage = String(raw.stage || raw.status || "LIVE");
  return {
    id: String(raw.id),
    url: raw.link || "https://www.flashscore.com/match/" + String(raw.id) + "/",
    home, away,
    home_id: raw.home?.id || null,
    away_id: raw.away?.id || null,
    competition: competition?.name || "Neznáma súťaž",
    country: competition?.country?.name || null,
    status: raw.status || "live",
    stage,
    // Live list currently has no verified elapsed-minute field. Never fabricate one.
    live_minute: null,
    minute_source: "not_provided_by_flashscore_live_list",
    start_time: raw.start_time || null,
    collected_at: now,
    home_score: numberOf(raw.home_score),
    away_score: numberOf(raw.away_score),
    has_statistics: raw.has_statistics === true,
    stats,
    stats_available: stats.length > 0,
    stats_error: statsError || null,
    source: "Flashscore"
  };
}
function snapshotOf(match) {
  return {
    collected_at: match.collected_at,
    live_minute: match.live_minute,
    stage: match.stage,
    home_score: match.home_score,
    away_score: match.away_score,
    stats: match.stats
  };
}
async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  const feed = await getJSON("/matches/live", { sport: "football" });
  if (!Array.isArray(feed?.competitions)) {
    throw new Error("Flashscore LIVE feed nemá platné competitions; dáta sa neprepíšu.");
  }

  const rawMatches = [];
  for (const competition of feed.competitions) {
    for (const raw of Array.isArray(competition.matches) ? competition.matches : []) {
      if (raw?.id && nameOf(raw.home) && nameOf(raw.away)) {
        rawMatches.push({ raw, competition: raw.competition || competition.competition });
      }
    }
  }

  const records = [];
  const errors = [];
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= rawMatches.length) return;
      const { raw, competition } = rawMatches[index];
      let stats = [], statsError = null;
      if (raw.has_statistics === true) {
        try {
          const payload = await getJSON("/matches/statistics", { match: String(raw.id) });
          stats = allStats(payload);
        } catch (error) {
          statsError = error.message;
          errors.push(String(raw.id) + ": " + statsError);
        }
      }
      records.push(makeMatch(raw, competition, stats, statsError));
    }
  });
  await Promise.all(workers);
  records.sort((a, b) => a.competition.localeCompare(b.competition) || a.home.localeCompare(b.home));

  const archive = readJson(ARCHIVE_PATH, {
    schema_version: 1, source: "Flashscore", created_at: now,
    updated_at: now, matches: {}
  });
  if (!archive || archive.source !== "Flashscore" || !archive.matches || typeof archive.matches !== "object") {
    throw new Error("Nový Flashscore archív má neplatnú štruktúru; odmietam prepísať.");
  }

  const timelineLines = [];
  for (const match of records) {
    const id = match.id;
    const previous = archive.matches[id];
    const snapshot = snapshotOf(match);
    const snapshots = Number(previous?.snapshots_count || 0) + 1;
    const scoreChanged = previous &&
      (previous.last_snapshot?.home_score !== snapshot.home_score ||
       previous.last_snapshot?.away_score !== snapshot.away_score);
    const oldStats = new Map((previous?.last_snapshot?.stats || []).map(x => [x.name, x]));
    const statChanges = snapshot.stats.filter(stat => {
      const old = oldStats.get(stat.name);
      return old && (old.home !== stat.home || old.away !== stat.away);
    }).map(stat => ({ name: stat.name, previous: oldStats.get(stat.name), current: stat }));

    archive.matches[id] = {
      id, home: match.home, away: match.away, competition: match.competition,
      country: match.country, start_time: match.start_time,
      first_seen_at: previous?.first_seen_at || now,
      last_seen_at: now,
      snapshots_count: snapshots,
      score_change_count: Number(previous?.score_change_count || 0) + (scoreChanged ? 1 : 0),
      stat_change_count: Number(previous?.stat_change_count || 0) + statChanges.length,
      last_snapshot: snapshot
    };
    timelineLines.push(JSON.stringify({
      match_id: id, home: match.home, away: match.away,
      competition: match.competition, snapshot,
      score_changed: Boolean(scoreChanged), stat_changes: statChanges
    }));
  }

  const cutoff = Date.now() - MAX_ARCHIVE_AGE_MS;
  for (const [id, item] of Object.entries(archive.matches)) {
    if (Date.parse(item.last_seen_at || "") < cutoff) delete archive.matches[id];
  }
  archive.updated_at = now;
  archive.live_match_count = records.length;
  archive.retention_days = 90;

  const current = {
    collected_at: now,
    source: "Flashscore",
    data_status: "complete",
    collection_complete: true,
    fixture_count: records.length,
    live_count: records.length,
    stats_match_count: records.filter(x => x.stats_available).length,
    stats_error_count: errors.length,
    errors: errors.slice(0, 30),
    records: records.map(match => ({ collected_at: now, match }))
  };

  if (timelineLines.length) {
    fs.appendFileSync(TIMELINE_PATH, timelineLines.join("\n") + "\n");
  }
  atomicJson(ARCHIVE_PATH, archive);
  atomicJson(CURRENT_PATH, current);
  console.log(JSON.stringify({
    source: "Flashscore", live_count: records.length,
    stats_match_count: current.stats_match_count,
    stats_error_count: errors.length,
    archive_matches: Object.keys(archive.matches).length,
    timeline_snapshots_written: timelineLines.length,
    collected_at: now
  }, null, 2));
}
main().catch(error => {
  console.error("FLASHSCORE-ONLY COLLECTOR FAILED:", error);
  process.exit(1);
});

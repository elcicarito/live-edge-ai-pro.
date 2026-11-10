#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("node:readline");
const zlib = require("node:zlib");

const DATA = path.join(__dirname, "..", "data");
const INPUT = path.join(DATA, "flashscore-live-current.json");
const OUTPUT = path.join(DATA, "flashscore-primary-current.json");

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function normalizeStats(stats) {
  return (Array.isArray(stats) ? stats : []).map(item => ({
    label: String(item?.label || item?.name || "Statistic"),
    category: item?.category ?? null,
    period: item?.period ?? null,
    home: item?.home ?? item?.home_value ?? null,
    away: item?.away ?? item?.away_value ?? null,
    home_numeric: numberOrNull(item?.home_numeric ?? item?.home ?? item?.home_value),
    away_numeric: numberOrNull(item?.away_numeric ?? item?.away ?? item?.away_value)
  }));
}

async function buildRecentHistory(currentRecords) {
  const indexPath = path.join(DATA, "flashscore-timeline-index.json");
  let index;
  try { index = JSON.parse(fs.readFileSync(indexPath, "utf8")); }
  catch { return []; }
  if (index?.source !== "Flashscore" || !Array.isArray(index.weeks)) return [];

  const activeIds = new Set(currentRecords.map(record => String(record.match.id)));
  if (!activeIds.size) return [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const rows = [];
  const weeks = index.weeks
    .filter(item => item && typeof item.file === "string" &&
      /^flashscore-match-timeline-\d{4}-W\d{2}\.jsonl\.gz$/.test(item.file))
    .sort((a, b) => String(b.week || "").localeCompare(String(a.week || "")))
    .slice(0, 2);

  for (const week of weeks) {
    const filePath = path.join(DATA, week.file);
    if (!fs.existsSync(filePath)) continue;
    const input = fs.createReadStream(filePath).pipe(zlib.createGunzip());
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const id = String(entry.match_id || "");
      const snapshot = entry.snapshot || {};
      const time = Date.parse(snapshot.collected_at || "");
      if (!activeIds.has(id) || !Number.isFinite(time) || time < cutoff || time > Date.now() + 60000) continue;
      const stats = (Array.isArray(snapshot.stats) ? snapshot.stats : [])
        .filter(stat => !stat.period || String(stat.period).toLowerCase() === "match")
        .filter(stat => /shots on target|shots off target|total shots|ball possession|corner kicks/i.test(String(stat.name || stat.label || "")))
        .map(stat => ({
          label: String(stat.label || stat.name || ""),
          home: stat.home_numeric ?? stat.home ?? null,
          away: stat.away_numeric ?? stat.away ?? null
        }));
      rows.push({
        time,
        match: {
          id, source: "Flashscore", status: "live",
          status_text: String(snapshot.stage || "LIVE"),
          stage: snapshot.stage || null,
          live_minute: snapshot.live_minute ?? null,
          live_clock: snapshot.live_clock || null,
          home_score: snapshot.home_score ?? null,
          away_score: snapshot.away_score ?? null,
          stats
        }
      });
    }
  }
  const unique = new Map();
  for (const row of rows) unique.set(String(row.match.id) + "|" + row.time, row);
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

function adaptFlashscoreCurrent(input, options = {}) {
  if (!input || input.source !== "Flashscore" || !Array.isArray(input.records)) {
    throw new Error("Neplatný Flashscore current snapshot.");
  }
  const records = input.records.map(record => {
    const match = record?.match;
    if (!match || !match.id || !match.home || !match.away) return null;
    return {
      collected_at: record.collected_at || match.collected_at || input.collected_at,
      match: {
        ...match,
        source: "Flashscore",
        status_text: match.status_text || match.stage || match.status || "",
        live_minute: match.live_minute ?? null,
        live_clock: match.live_clock ?? null,
        stats: normalizeStats(match.stats),
        stats_available: Array.isArray(match.stats) && match.stats.length > 0
      }
    };
  }).filter(Boolean);

  const clockCount = records.filter(record => Boolean(record.match.live_clock)).length;
  const statsCount = records.filter(record => record.match.stats_available).length;
  const recentHistory = options.recentHistory || [];
  return {
    schema_version: 1,
    source: "Flashscore",
    source_providers: ["Flashscore"],
    source_status: {
      Flashscore: {
        live_count: records.length,
        complete: input.data_status === "complete" && input.collection_complete === true,
        stats_available_count: statsCount,
        clock_available_count: clockCount
      }
    },
    collected_at: input.collected_at || null,
    fixture_count: input.fixture_count ?? records.length,
    live_count: records.length,
    records,
    recent_history: recentHistory,
    recent_history_count: recentHistory.length,
    // Promotion remains blocked until live clock, score and stats checks pass.
    collection_complete: false,
    data_status: "partial",
    feed_state: "FLASHSCORE_VALIDATION_PENDING",
    archive_safe: false,
    promotion_ready: false,
    signal_eligible: false,
    validation: {
      clock_available_count: clockCount,
      stats_available_count: statsCount,
      records_count: records.length,
      clock_coverage: records.length ? clockCount / records.length : 0,
      stats_coverage: records.length ? statsCount / records.length : 0
    }
  };
}

async function main() {
  const input = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  const recentHistory = await buildRecentHistory(input.records.map(record => record?.match ? { match: record.match } : null).filter(Boolean));
  const output = adaptFlashscoreCurrent(input, { recentHistory });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify({
    source: output.source,
    records: output.records.length,
    recent_history: output.recent_history_count,
    clock_available: output.validation.clock_available_count,
    stats_available: output.validation.stats_available_count,
    promotion_ready: output.promotion_ready,
    signal_eligible: output.signal_eligible,
    output: path.basename(OUTPUT)
  }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { adaptFlashscoreCurrent, normalizeStats, buildRecentHistory };

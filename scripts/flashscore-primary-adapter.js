#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

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
    home: item?.home ?? item?.home_value ?? null,
    away: item?.away ?? item?.away_value ?? null,
    home_numeric: numberOrNull(item?.home_numeric ?? item?.home ?? item?.home_value),
    away_numeric: numberOrNull(item?.away_numeric ?? item?.away ?? item?.away_value)
  }));
}

function adaptFlashscoreCurrent(input) {
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

function main() {
  const input = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  const output = adaptFlashscoreCurrent(input);
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify({
    source: output.source,
    records: output.records.length,
    clock_available: output.validation.clock_available_count,
    stats_available: output.validation.stats_available_count,
    promotion_ready: output.promotion_ready,
    signal_eligible: output.signal_eligible,
    output: path.basename(OUTPUT)
  }, null, 2));
}

if (require.main === module) main();
module.exports = { adaptFlashscoreCurrent, normalizeStats };

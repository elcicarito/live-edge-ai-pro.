#!/usr/bin/env node
"use strict";

// Pre-production adapter: normalize the isolated Flashscore collector output
// to the LIVE EDGE canonical record shape without replacing ESPN's production
// live-current.json. Promotion is deliberately blocked until clock/statistics
// validation has passed.
const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "data");
const INPUT = path.join(DATA, "flashscore-live-current.json");
const OUTPUT = path.join(DATA, "flashscore-primary-current.json");

function normalizeStats(stats) {
  return (Array.isArray(stats) ? stats : []).map(item => ({
    label: String(item?.label || item?.name || "Statistic"),
    home: item?.home ?? item?.home_value ?? null,
    away: item?.away ?? item?.away_value ?? null,
    home_numeric: Number.isFinite(Number(item?.home_numeric))
      ? Number(item.home_numeric)
      : (Number.isFinite(Number(item?.home ?? item?.home_value)) ? Number(item.home ?? item.home_value) : null),
    away_numeric: Number.isFinite(Number(item?.away_numeric))
      ? Number(item.away_numeric)
      : (Number.isFinite(Number(item?.away ?? item?.away_value)) ? Number(item.away ?? item.away_value) : null)
  }));
}

function adaptFlashscoreCurrent(input) {
  if (!input || input.source !== "Flashscore" || !Array.isArray(input.records)) {
    throw new Error("Neplatný Flashscore current snapshot.");
  }
  const records = input.records.map(record => {
    const match = record?.match;
    if (!match || !match.id || !match.home || !match.away) return null;
    const normalized = {
      ...match,
      source: "Flashscore",
      status_text: match.status_text || match.stage || match.status || "",
      live_minute: match.live_minute ?? null,
      live_clock: match.live_clock ?? null,
      stats: normalizeStats(match.stats),
      stats_available: Array.isArray(match.stats) && match.stats.length > 0
    };
    return {
      collected_at: record.collected_at || match.collected_at || input.collected_at,
      match: normalized
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
    // Keep production signals disabled until a live sample confirms clock,
    // score and statistics against the Flashscore match pages.
    collection_complete: false,
    data_status: "partial",
    feed_state: "FLASHScore_VALIDATION_PENDING",
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

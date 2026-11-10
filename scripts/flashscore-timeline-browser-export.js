"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const DATA = path.resolve(process.argv[2] || path.join(__dirname, "..", "data"));
const OUTPUT = path.join(DATA, "flashscore-live-timeline-recent.json");
const DAY_MS = 24 * 60 * 60 * 1000;

function buildRecentTimeline(dataDir = DATA, nowMs = Date.now(), retentionMs = DAY_MS) {
  const indexPath = path.join(dataDir, "flashscore-timeline-index.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  if (index.source !== "Flashscore" || !Array.isArray(index.weeks)) {
    throw new Error("Neplatný Flashscore timeline index.");
  }

  const cutoff = nowMs - retentionMs;
  const seen = new Set();
  const rows = [];
  const recentWeeks = index.weeks
    .filter(week => week && typeof week.file === "string")
    .sort((a, b) => String(b.week || "").localeCompare(String(a.week || "")))
    .slice(0, 2);
  for (const week of recentWeeks) {
    if (!week || typeof week.file !== "string" ||
        !/^flashscore-match-timeline-\d{4}-W\d{2}\.jsonl\.gz$/.test(week.file)) {
      throw new Error("Neplatná timeline položka v indexe.");
    }
    const file = path.join(dataDir, week.file);
    if (!fs.existsSync(file)) throw new Error("Chýba timeline súbor: " + week.file);
    const decoded = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
    for (const line of decoded.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const snap = entry.snapshot || {};
      const time = Date.parse(snap.collected_at || "");
      const id = String(entry.match_id || "");
      if (!id || !Number.isFinite(time) || time < cutoff || time > nowMs + 60000) continue;
      const key = id + "|" + time;
      if (seen.has(key)) continue;
      seen.add(key);
      const stats = (Array.isArray(snap.stats) ? snap.stats : []).map(x => ({
        ...x,
        label: x.label || x.name || "",
        home: x.home_numeric ?? x.home,
        away: x.away_numeric ?? x.away
      }));
      rows.push({
        time,
        match: {
          id,
          source: "Flashscore",
          status: "live",
          status_text: String(snap.stage || "LIVE"),
          stage: snap.stage || null,
          live_minute: snap.live_minute ?? null,
          live_clock: snap.live_clock || null,
          home_score: snap.home_score ?? null,
          away_score: snap.away_score ?? null,
          stats
        }
      });
    }
  }
  rows.sort((a, b) => a.time - b.time);
  return {
    schema_version: 1,
    source: "Flashscore",
    generated_at: new Date(nowMs).toISOString(),
    retention_hours: Math.round(retentionMs / 3600000),
    rows
  };
}

function exportRecentTimeline(dataDir = DATA, nowMs = Date.now(), retentionMs = DAY_MS) {
  const output = buildRecentTimeline(dataDir, nowMs, retentionMs);
  fs.writeFileSync(path.join(dataDir, "flashscore-live-timeline-recent.json"), JSON.stringify(output));
  return output;
}

if (require.main === module) {
  const result = exportRecentTimeline();
  console.log("Flashscore browser timeline export:", result.rows.length, "snapshots");
}

module.exports = { buildRecentTimeline, exportRecentTimeline };

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const DATA = path.resolve(__dirname, "..", "data");
const INDEX_PATH = path.join(DATA, "flashscore-timeline-index.json");
const OUTCOMES_PATH = path.join(DATA, "flashscore-confirmed-outcomes.json");
const BTTS_PATH = path.join(DATA, "flashscore-btts-signal-archive.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeJson(file, value) {
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temp, file);
}
function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function pair(stats, wanted) {
  const rows = Array.isArray(stats) ? stats : [];
  const hasPeriods = rows.some(row => typeof row?.period === "string" && row.period.trim());
  const matchRows = hasPeriods ? rows.filter(row => String(row.period).trim().toLowerCase() === "match") : rows;
  const row = matchRows.find(item => wanted.includes(String(item.name || item.label || "").trim().toLowerCase()));
  if (!row) return null;
  const home = num(row.home_numeric ?? row.home);
  const away = num(row.away_numeric ?? row.away);
  return home === null || away === null ? null : { home, away };
}
function classify(snapshot) {
  const minute = num(snapshot?.live_minute);
  if (!Number.isInteger(minute) || minute <= 70) return null;
  if (!/2nd\s*half|second\s*half/i.test(String(snapshot.stage || ""))) return null;
  const home = num(snapshot.home_score), away = num(snapshot.away_score);
  if (home === null || away === null) return null;
  const sot = pair(snapshot.stats, ["shots on target"]);
  const shots = pair(snapshot.stats, ["total shots"]);
  if (!sot || !shots) return null;
  const combinedSot = sot.home + sot.away;
  const combinedShots = shots.home + shots.away;
  if (home === 1 && away === 0 && combinedSot >= 5) {
    if (combinedShots >= 12) return { tierKey:"10_sot5_shots12", tier:"1:0 · SOT ≥5 · strely ≥12", predictedSide:"away", minute, home, away, combinedSot, combinedShots };
    if (combinedShots >= 10) return { tierKey:"10_sot5_shots10", tier:"1:0 · SOT ≥5 · strely ≥10", predictedSide:"away", minute, home, away, combinedSot, combinedShots };
    if (combinedShots >= 8) return { tierKey:"10_sot5_shots8", tier:"1:0 · SOT ≥5 · strely ≥8", predictedSide:"away", minute, home, away, combinedSot, combinedShots };
  }
  if (home === 0 && away === 1 && combinedSot >= 6 && combinedShots >= 8) {
    return { tierKey:"01_sot6_shots8", tier:"0:1 · SOT ≥6 · strely ≥8", predictedSide:"home", minute, home, away, combinedSot, combinedShots };
  }
  return null;
}
function buildCapturedSignalAfter70Analysis({ signals, outcomes, timelineRecords, index, now }) {
  const captured = (Array.isArray(signals) ? signals : []).filter(signal =>
    signal?.source === "Flashscore" && signal?.model === "BTTS" &&
    Number(signal.startMinute) >= 46 && Number(signal.startMinute) <= 50 &&
    signal.matchId != null
  );
  const signalMatches = new Map();
  for (const signal of captured) {
    const id = String(signal.matchId);
    if (!signalMatches.has(id)) signalMatches.set(id, []);
    signalMatches.get(id).push(signal);
  }
  const records = [];
  if (Array.isArray(timelineRecords)) records.push(...timelineRecords);
  else {
    for (const week of index.weeks || []) {
      const file = path.join(DATA, path.basename(week.file || ""));
      if (!fs.existsSync(file)) continue;
      const content = zlib.gunzipSync(fs.readFileSync(file), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString("utf8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try { records.push(JSON.parse(line)); } catch {}
      }
    }
  }
  const firstByMatch = new Map();
  for (const record of records) {
    const id = String(record?.match_id || "");
    if (!signalMatches.has(id)) continue;
    const candidate = classify(record.snapshot);
    if (!candidate || candidate.minute <= 70) continue;
    const prior = firstByMatch.get(id);
    if (!prior || candidate.minute < prior.minute) {
      firstByMatch.set(id, {
        matchId:id, homeTeam:record.home || "", awayTeam:record.away || "",
        competition:record.competition || "", ...candidate,
        collectedAt:record.snapshot?.collected_at || null
      });
    }
  }
  const entries = [...firstByMatch.values()].map(entry => {
    const final = outcomes?.matches?.[entry.matchId];
    const home = num(final?.home_score), away = num(final?.away_score);
    let status = "PENDING";
    if (final?.status === "CONFIRMED" && home !== null && away !== null) {
      status = home > 0 && away > 0 ? "WIN" : "LOSS";
    }
    return { ...entry, status, finalScore:home === null || away === null ? null : home + ":" + away };
  }).sort((a,b) => String(b.collectedAt || "").localeCompare(String(a.collectedAt || "")));
  const wins = entries.filter(x => x.status === "WIN").length;
  const losses = entries.filter(x => x.status === "LOSS").length;
  const pending = entries.filter(x => x.status === "PENDING").length;
  return {
    method:"Iba skutočne zachytené Flashscore BTTS LIVE signály z 46.–50. minúty. Z ich zápasov sa vyberie prvá uložená snímka po 70. minúte, ktorá splní existujúce BTTS skóre a strelecké prahy. Jeden záznam na zápas; nejde o nový LIVE signál.",
    source:"Flashscore BTTS signal archive + permanent Flashscore timeline + confirmed outcomes",
    generated_at:now,
    captured_signal_count:signalMatches.size,
    qualifying_match_count:entries.length,
    sample:entries.length, wins, losses, pending, settled:wins+losses,
    win_rate:wins+losses ? wins/(wins+losses) : null,
    odds_available:false, roi_available:false,
    note:"Úspech znamená, že do konečného výsledku skórovali oba tímy. Zápasy bez splnenej podmienky po 70. minúte sa nezapočítavajú do tejto vzorky.",
    entries
  };
}

function buildEvaluation({ index, outcomes, bttsArchive, timelineRecords = null, now = new Date().toISOString() }) {
  if (index?.source !== "Flashscore" || !Array.isArray(index.weeks)) throw new Error("Invalid Flashscore timeline index.");
  const firstByMatch = new Map();
  for (const week of index.weeks) {
    const file = path.join(DATA, path.basename(week.file || ""));
    if (!fs.existsSync(file)) continue;
    const content = zlib.gunzipSync(fs.readFileSync(file), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString("utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const id = String(record.match_id || "");
      if (!id || firstByMatch.has(id)) continue;
      const candidate = classify(record.snapshot);
      if (!candidate) continue;
      const final = outcomes?.matches?.[id];
      const finalHome = num(final?.home_score);
      const finalAway = num(final?.away_score);
      let status = "PENDING";
      if (final?.status === "CONFIRMED" && finalHome !== null && finalAway !== null) {
        const finalPredicted = candidate.predictedSide === "home" ? finalHome : finalAway;
        const startPredicted = candidate.predictedSide === "home" ? candidate.home : candidate.away;
        status = finalPredicted > startPredicted ? "WIN" : "LOSS";
      }
      firstByMatch.set(id, {
        matchId:id, homeTeam:record.home || "", awayTeam:record.away || "",
        competition:record.competition || "", createdAt:record.snapshot.collected_at || null,
        ...candidate, status, finalScore: finalHome === null || finalAway === null ? null : finalHome + ":" + finalAway
      });
    }
  }
  const entries = [...firstByMatch.values()].sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const keys = ["10_sot5_shots8","10_sot5_shots10","10_sot5_shots12","01_sot6_shots8"];
  const groups = {};
  for (const key of keys) {
    const rows = entries.filter(row => row.tierKey === key);
    const wins = rows.filter(row => row.status === "WIN").length;
    const losses = rows.filter(row => row.status === "LOSS").length;
    groups[key] = { sample:rows.length, wins, losses, pending:rows.filter(row => row.status === "PENDING").length, settled:wins+losses, win_rate:wins+losses ? wins/(wins+losses) : null };
  }
  const wins = entries.filter(row => row.status === "WIN").length;
  const losses = entries.filter(row => row.status === "LOSS").length;
  const pending = entries.filter(row => row.status === "PENDING").length;
  const output = bttsArchive && bttsArchive.source === "Flashscore" ? bttsArchive : { schema_version:1, source:"Flashscore", signals:[] };
  output.after70_analysis = {
    method:"Retrospective analysis of the first archived Flashscore snapshot after minute 70 that meets the existing BTTS score and shot thresholds. One observation per match; no additional live signal is created.",
    source:"Flashscore permanent timeline + confirmed Flashscore final outcomes",
    generated_at:now,
    sample:entries.length, wins, losses, pending, settled:wins+losses,
    win_rate:wins+losses ? wins/(wins+losses) : null,
    odds_available:false, roi_available:false,
    groups, entries
  };
  output.captured_signals_after70_analysis = buildCapturedSignalAfter70Analysis({ signals:output.signals, outcomes, timelineRecords, index, now });
  return output;
}
function main() {
  const result = buildEvaluation({
    index:readJson(INDEX_PATH),
    outcomes:readJson(OUTCOMES_PATH),
    bttsArchive:readJson(BTTS_PATH)
  });
  writeJson(BTTS_PATH, result);
  console.log("BTTS AFTER-70 ARCHIVE EVALUATION:", JSON.stringify({
    sample:result.after70_analysis.sample, wins:result.after70_analysis.wins,
    losses:result.after70_analysis.losses, pending:result.after70_analysis.pending,
    generated_at:result.after70_analysis.generated_at
  }));
}
if (require.main === module) main();
module.exports = { classify, buildEvaluation, buildCapturedSignalAfter70Analysis };

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

  // Retrospektíva sleduje iba okamih, keď po zachytení signálu oba tímy
  // už majú aspoň jeden gól. Strelecké prahy patria výhradne k pôvodnému signálu.
  const timelineByMatch = new Map();
  for (const record of records) {
    const id = String(record?.match_id || "");
    if (!signalMatches.has(id)) continue;
    const snapshot = record?.snapshot;
    const minute = num(snapshot?.live_minute ?? snapshot?.minute);
    const home = num(snapshot?.home_score), away = num(snapshot?.away_score);
    if (!Number.isInteger(minute) || home === null || away === null) continue;
    const collectedAt = snapshot?.collected_at || record?.collected_at || null;
    if (!timelineByMatch.has(id)) timelineByMatch.set(id, []);
    timelineByMatch.get(id).push({ minute, home, away, collectedAt });
  }
  for (const rows of timelineByMatch.values()) {
    rows.sort((a,b) => a.minute - b.minute ||
      String(a.collectedAt || "").localeCompare(String(b.collectedAt || "")));
  }

  const entries = [...signalMatches.entries()].map(([id, matchSignals]) => {
    const signal = matchSignals.slice().sort((a,b) =>
      Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0)
    )[0];
    const signalMinute = Number(signal.startMinute);
    const signalTime = Date.parse(signal.createdAt || "");
    const rows = timelineByMatch.get(id) || [];
    const afterSignal = rows.filter(row => {
      const time = Date.parse(row.collectedAt || "");
      return Number.isFinite(signalTime) && Number.isFinite(time)
        ? time >= signalTime
        : row.minute >= signalMinute;
    });
    const alreadyMetAtSignal = Number((String(signal.startScore || "").match(/^(\d+)\s*[:\-]\s*(\d+)$/) || [])[1]) > 0 &&
      Number((String(signal.startScore || "").match(/^(\d+)\s*[:\-]\s*(\d+)$/) || [])[2]) > 0;
    const completion = alreadyMetAtSignal
      ? { minute: signalMinute, home: Number(signal.startScore.split(/[:\-]/)[0]), away: Number(signal.startScore.split(/[:\-]/)[1]), atSignal: true }
      : afterSignal.find(row => row.home > 0 && row.away > 0) || null;

    const final = outcomes?.matches?.[id];
    const finalHome = num(final?.home_score);
    const finalAway = num(final?.away_score);
    const finalConfirmed = final?.status === "CONFIRMED" && finalHome !== null && finalAway !== null;
    const fallbackScore = String(signal?.settledScore || "").match(/^\s*(\d+)\s*[:\-]\s*(\d+)\s*$/);
    const settledHome = finalConfirmed ? finalHome : fallbackScore ? Number(fallbackScore[1]) : null;
    const settledAway = finalConfirmed ? finalAway : fallbackScore ? Number(fallbackScore[2]) : null;
    const status = settledHome !== null && settledAway !== null
      ? (settledHome > 0 && settledAway > 0 ? "WIN" : "LOSS")
      : (["WIN","LOSS"].includes(signal?.status) ? signal.status : "PENDING");

    const completionStatus = completion
      ? completion.atSignal ? "ALREADY_MET_AT_SIGNAL"
        : completion.minute > 70 ? "COMPLETED_AFTER_70" : "COMPLETED_BY_70"
      : status === "LOSS" ? "NOT_COMPLETED"
        : afterSignal.length ? "NO_COMPLETION_OBSERVED" : "NO_TIMELINE_DATA";

    return {
      matchId:id, homeTeam:signal.home || "", awayTeam:signal.away || "",
      competition:signal.competition || "",
      signalStartMinute:signalMinute, signalStartScore:signal.startScore || "",
      signalTier:signal.tier || signal.tierKey || "BTTS",
      signalSot:num(signal.combinedSot), signalShots:num(signal.combinedShots),
      signalCreatedAt:signal.createdAt || null,
      capturedSignalCountForMatch:matchSignals.length,
      completionStatus,
      bttsCompletedMinute:completion?.minute ?? null,
      bttsCompletedScore:completion ? completion.home + ":" + completion.away : null,
      completionCollectedAt:completion?.collectedAt || null,
      status,
      finalScore:settledHome !== null && settledAway !== null ? settledHome + ":" + settledAway : null
    };
  }).sort((a,b) => String(b.signalCreatedAt || "").localeCompare(String(a.signalCreatedAt || "")));

  const wins=entries.filter(x=>x.status==="WIN").length;
  const losses=entries.filter(x=>x.status==="LOSS").length;
  const pending=entries.filter(x=>x.status==="PENDING").length;
  const after70=entries.filter(x=>x.completionStatus==="COMPLETED_AFTER_70");
  const by70=entries.filter(x=>["COMPLETED_BY_70","ALREADY_MET_AT_SIGNAL"].includes(x.completionStatus));
  return {
    schema_version:3, ready:true,
    method:"Iba skutočne zachytené Flashscore BTTS signály z 46.–50. minúty. Sleduje sa prvý uložený LIVE snapshot po zachytení signálu, v ktorom oba tímy už skórovali. SOT a strely sa používajú iba pri pôvodnom signále, nie pri retrospektíve.",
    source:"Flashscore BTTS signal archive + permanent Flashscore timeline + confirmed outcomes",
    generated_at:now, captured_signal_count:signalMatches.size, sample:entries.length,
    wins, losses, pending, settled:wins+losses,
    win_rate:wins+losses?wins/(wins+losses):null,
    completed_by_70_count:by70.length,
    completed_after_70_count:after70.length,
    not_completed_count:entries.filter(x=>x.completionStatus==="NOT_COMPLETED").length,
    no_completion_observed_count:entries.filter(x=>x.completionStatus==="NO_COMPLETION_OBSERVED").length,
    no_timeline_data_count:entries.filter(x=>x.completionStatus==="NO_TIMELINE_DATA").length,
    completed_after_70_wins:after70.filter(x=>x.status==="WIN").length,
    odds_available:false, roi_available:false,
    note:"Čas dokončenia BTTS je minúta prvého uloženého snapshotu, v ktorom oba tímy majú gól; pri intervalovom zbere môže byť neskorší než presná minúta gólu. Konečný WIN/LOSS sa vyhodnocuje samostatne.",
    entries
  };
}
function buildEvaluation({ index, outcomes, bttsArchive, timelineRecords = null, now = new Date().toISOString() }) {
  if (index?.source !== "Flashscore" || !Array.isArray(index.weeks)) throw new Error("Invalid Flashscore timeline index.");
  const output = bttsArchive && bttsArchive.source === "Flashscore"
    ? bttsArchive
    : { schema_version:1, source:"Flashscore", signals:[] };

  // Odstráni starú retrospektívu, ktorá nezávisle vyhľadávala všetky zápasy po 70. minúte.
  delete output.after70_analysis;

  // Jediná retrospektíva: iba reálne zachytené BTTS signály z 46.–50. minúty.
  output.captured_signals_after70_analysis = buildCapturedSignalAfter70Analysis({
    signals:output.signals, outcomes, timelineRecords, index, now
  });
  return output;
}
function main() {
  const result = buildEvaluation({
    index:readJson(INDEX_PATH),
    outcomes:readJson(OUTCOMES_PATH),
    bttsArchive:readJson(BTTS_PATH)
  });
  writeJson(BTTS_PATH, result);
  console.log("BTTS CAPTURED-SIGNAL RETROSPECTIVE:", JSON.stringify({
    captured:result.captured_signals_after70_analysis.captured_signal_count,
    qualifiedAfter70:result.captured_signals_after70_analysis.qualifying_match_count,
    wins:result.captured_signals_after70_analysis.wins,
    losses:result.captured_signals_after70_analysis.losses,
    pending:result.captured_signals_after70_analysis.pending,
    generated_at:result.captured_signals_after70_analysis.generated_at
  }));
}
if (require.main === module) main();
module.exports = { classify, buildEvaluation, buildCapturedSignalAfter70Analysis };

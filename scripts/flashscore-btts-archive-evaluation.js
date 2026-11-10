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

  const post70ByMatch = new Map();
  for (const record of records) {
    const id = String(record?.match_id || "");
    if (!signalMatches.has(id)) continue;
    const snapshot = record?.snapshot;
    const minute = num(snapshot?.live_minute);
    if (!Number.isInteger(minute) || minute <= 70 ||
        !/2nd\s*half|second\s*half/i.test(String(snapshot?.stage || ""))) continue;

    const state = post70ByMatch.get(id) || {
      post70SnapshotCount: 0,
      evaluablePost70SnapshotCount: 0,
      firstQualified: null
    };
    state.post70SnapshotCount += 1;

    const home = num(snapshot?.home_score), away = num(snapshot?.away_score);
    const sot = pair(snapshot?.stats, ["shots on target"]);
    const shots = pair(snapshot?.stats, ["total shots"]);
    if (home !== null && away !== null && sot && shots) {
      state.evaluablePost70SnapshotCount += 1;
    }

    const candidate = classify(snapshot);
    if (candidate && (!state.firstQualified ||
        candidate.minute < state.firstQualified.minute ||
        (candidate.minute === state.firstQualified.minute &&
         String(snapshot?.collected_at || "") < String(state.firstQualified.collectedAt || "")))) {
      state.firstQualified = {
        ...candidate,
        collectedAt: snapshot?.collected_at || null
      };
    }
    post70ByMatch.set(id, state);
  }

  const entries = [...signalMatches.entries()].map(([id, matchSignals]) => {
    const signal = matchSignals.slice().sort((a,b) =>
      Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0)
    )[0];
    const observed = post70ByMatch.get(id) || {
      post70SnapshotCount: 0,
      evaluablePost70SnapshotCount: 0,
      firstQualified: null
    };
    const qualified = observed.firstQualified;
    const after70Status = qualified ? "QUALIFIED" :
      observed.evaluablePost70SnapshotCount > 0 ? "NOT_QUALIFIED" :
      observed.post70SnapshotCount > 0 ? "INSUFFICIENT_DATA" : "NO_POST70_DATA";

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

    return {
      matchId: id,
      homeTeam: signal.home || "",
      awayTeam: signal.away || "",
      competition: signal.competition || "",
      signalStartMinute: Number(signal.startMinute),
      signalStartScore: signal.startScore || "",
      signalTier: signal.tier || signal.tierKey || "BTTS",
      signalSot: num(signal.combinedSot),
      signalShots: num(signal.combinedShots),
      signalCreatedAt: signal.createdAt || null,
      capturedSignalCountForMatch: matchSignals.length,
      after70Status,
      post70SnapshotCount: observed.post70SnapshotCount,
      evaluablePost70SnapshotCount: observed.evaluablePost70SnapshotCount,
      post70Minute: qualified?.minute ?? null,
      post70Score: qualified ? qualified.home + ":" + qualified.away : null,
      post70Tier: qualified?.tier || null,
      post70Sot: qualified?.combinedSot ?? null,
      post70Shots: qualified?.combinedShots ?? null,
      post70CollectedAt: qualified?.collectedAt || null,
      status,
      finalScore: settledHome !== null && settledAway !== null ? settledHome + ":" + settledAway : null
    };
  }).sort((a,b) => String(b.signalCreatedAt || "").localeCompare(String(a.signalCreatedAt || "")));

  const wins = entries.filter(x => x.status === "WIN").length;
  const losses = entries.filter(x => x.status === "LOSS").length;
  const pending = entries.filter(x => x.status === "PENDING").length;
  const qualified = entries.filter(x => x.after70Status === "QUALIFIED");
  const qualifiedWins = qualified.filter(x => x.status === "WIN").length;
  const qualifiedLosses = qualified.filter(x => x.status === "LOSS").length;
  const qualifiedPending = qualified.filter(x => x.status === "PENDING").length;
  return {
    schema_version:2,
    method:"Iba skutočne zachytené Flashscore BTTS signály z 46.–50. minúty. Každý zachytený zápas zostáva vo vzorke; samostatne sa označí, či po 70. minúte splnil existujúce BTTS skóre a strelecké prahy, a následne sa vyhodnotí konečné BTTS.",
    source:"Flashscore BTTS signal archive + permanent Flashscore timeline + confirmed outcomes",
    generated_at:now,
    captured_signal_count:signalMatches.size,
    qualifying_match_count:qualified.length,
    not_qualifying_match_count:entries.filter(x => x.after70Status === "NOT_QUALIFIED").length,
    insufficient_data_match_count:entries.filter(x => x.after70Status === "INSUFFICIENT_DATA").length,
    no_post70_data_match_count:entries.filter(x => x.after70Status === "NO_POST70_DATA").length,
    sample:entries.length, wins, losses, pending, settled:wins+losses,
    win_rate:wins+losses ? wins/(wins+losses) : null,
    qualified_sample:qualified.length,
    qualified_wins:qualifiedWins,
    qualified_losses:qualifiedLosses,
    qualified_pending:qualifiedPending,
    qualified_settled:qualifiedWins+qualifiedLosses,
    qualified_win_rate:qualifiedWins+qualifiedLosses ? qualifiedWins/(qualifiedWins+qualifiedLosses) : null,
    odds_available:false, roi_available:false,
    note:"WIN/LOSS sa určuje podľa konečného BTTS (oba tímy skórovali). Zápasy bez splnených podmienok po 70. minúte zostávajú v celkovej vzorke ako NOT_QUALIFIED; chýbajúce alebo neúplné snímky sa označujú osobitne.",
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

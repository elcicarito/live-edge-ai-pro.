import fs from "node:fs/promises";

const API = process.env.FLASHSCORE_API || "http://127.0.0.1:8000";
const now = new Date().toISOString();
const paths = { current: "data/hockey-flashscore-current.json", archive: "data/hockey-flashscore-archive.json", history: "data/hockey-flashscore-history.jsonl" };
const headers = { accept: "application/json", "user-agent": "LIVE-EDGE-AI-PRO-HOCKEY/1.0", "cache-control": "no-cache" };
const get = async (path, params = {}) => {
  const url = new URL(path, API);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Flashscore ${path}: HTTP ${response.status}`);
  const data = await response.json();
  if (!data || typeof data !== "object") throw new Error(`Flashscore ${path}: invalid JSON`);
  return data;
};
const readJson = async (path, fallback) => { try { return JSON.parse(await fs.readFile(path, "utf8")); } catch { return fallback; } };
const readLines = async path => { try { return (await fs.readFile(path, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line)); } catch { return []; } };
const safeName = value => String(value?.name || value?.short_name || value || "").trim();
const num = value => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const allMatches = payload => (payload?.competitions || []).flatMap(group => (group?.matches || []).map(match => ({ ...match, competition: match.competition || group.competition })));
const periodNumber = value => {
  if (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 3) return Number(value);
  const m = String(value || "").match(/(?:period|third|tretin[ay])\s*([1-3])|([1-3])(?:st|nd|rd)?\s*(?:period|third)/i);
  return m ? Number(m[1] || m[2]) : null;
};

const livePayload = await get("/matches/live", { sport: "hockey" });
const liveRows = allMatches(livePayload);
const details = await Promise.all(liveRows.map(async row => {
  const sourceId = String(row.id || "");
  if (!sourceId) return null;
  let detail = {}, statData = {};
  try { detail = await get("/matches/details", { match: sourceId }); } catch (error) { console.log("HOCKEY FLASHSCORE DETAILS:", sourceId, error.message); }
  try { statData = await get("/matches/statistics", { match: sourceId }); } catch (error) { console.log("HOCKEY FLASHSCORE STATS:", sourceId, error.message); }
  const homeName = safeName(detail.home || row.home), awayName = safeName(detail.away || row.away);
  if (!homeName || !awayName) return null;
  const home = { id: detail.home?.id || row.home?.id || "", name: homeName, score: num(row.home_score ?? detail.home_score) };
  const away = { id: detail.away?.id || row.away?.id || "", name: awayName, score: num(row.away_score ?? detail.away_score) };
  // Keep full-match totals separate from individual period values.
  // The previous loop overwrote the top-level totals with the last period,
  // which could mislead downstream live models.
  const stats = { home: {}, away: {} }, statsByPeriod = [];
  let hasMatchTotals = false;
  for (const period of statData.periods || []) {
    const periodStats = [], periodHome = {}, periodAway = {};
    for (const group of period.groups || []) for (const stat of group.statistics || []) {
      const label = String(stat.name || "").trim();
      if (!label) continue;
      const h = stat.home_value ?? num(stat.home), a = stat.away_value ?? num(stat.away);
      const valueHome = h === null || h === undefined ? stat.home : h;
      const valueAway = a === null || a === undefined ? stat.away : a;
      if (valueHome !== null && valueHome !== undefined) periodHome[label] = valueHome;
      if (valueAway !== null && valueAway !== undefined) periodAway[label] = valueAway;
      periodStats.push({ category: group.category || null, label, home: valueHome ?? null, away: valueAway ?? null });
    }
    const periodName = String(period.period || "").trim().toLowerCase();
    if (/^(match|full match|total|full time)$/.test(periodName)) {
      Object.assign(stats.home, periodHome);
      Object.assign(stats.away, periodAway);
      hasMatchTotals = true;
    }
    statsByPeriod.push({ period: period.period ?? null, statistics: periodStats });
  }
  // If the source does not expose a match-total tab, do not pretend that
  // the latest period's figures are full-match totals. Period breakdown
  // remains available in stats_by_period for diagnostics and UI.
  const stage = String(row.stage || row.status || detail.stage || "LIVE");
  // The live match-list feed publishes completed period score lines. These
  // are distinct from statistics tabs and can safely identify progression.
  const rawPeriods = Array.isArray(row.periods) ? row.periods : (Array.isArray(detail.periods) ? detail.periods : []);
  const periodScores = rawPeriods.map((item, index) => ({
    name: String(item.name || item.period || `Period ${index + 1}`),
    home: num(item.home), away: num(item.away)
  }));
  // Period score lines are retained as evidence, but never treated as
  // proof of the currently active period: the feed may include partial lines.
  const explicitPeriod = periodNumber(detail.period ?? detail.current_period ?? row.period ?? row.current_period ?? stage);
  const period = explicitPeriod;
  const periodSource = explicitPeriod ? "match_status" : null;
  const rawClock = row.time ?? row.clock ?? detail.time ?? detail.clock ?? detail.status?.display_clock ?? "";
  const clock = typeof rawClock === "string" || typeof rawClock === "number" ? String(rawClock) : String(rawClock?.display || rawClock?.text || rawClock?.value || "");
  return {
    id: `flashscore-${sourceId}`, source: "Flashscore", source_match_id: sourceId,
    league_slug: String((detail.competition?.name || row.competition?.name || "hockey").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")),
    league_name: detail.competition?.name || row.competition?.name || "Hokej",
    name: `${homeName} – ${awayName}`, date: row.start_time || detail.start_time || null,
    status: "live", status_text: stage, period, period_source: periodSource, clock,
    home, away, periods: { home: periodScores.map(p => p.home), away: periodScores.map(p => p.away) },
    period_scores: periodScores, stats, stats_by_period: statsByPeriod,
    available_tabs: detail.available_tabs || [], has_statistics: Boolean(detail.has_statistics || statsByPeriod.some(p => p.statistics.length)),
    collected_at: now
  };
}));
const matches = details.filter(Boolean);
if (liveRows.length && !matches.length) throw new Error("Flashscore returned LIVE hockey fixtures but none could be normalized; previous snapshot preserved.");
const current = {
  source: "Flashscore", collected_at: now, feed_state: matches.length ? "LIVE" : "NO_LIVE",
  live_count: matches.length, raw_live_count: liveRows.length,
  data_quality: {
    matches_with_period: matches.filter(match => match.period !== null).length,
    matches_with_explicit_period: matches.filter(match => match.period_source === "match_status").length,
    matches_with_period_score_lines: matches.filter(match => match.period_scores.length > 0).length,
    matches_with_clock: matches.filter(match => Boolean(match.clock)).length,
    matches_with_match_totals: matches.filter(match => Object.keys(match.stats.home).length || Object.keys(match.stats.away).length).length,
    matches_with_period_stats: matches.filter(match => match.stats_by_period.some(period => period.statistics.length)).length,
    warning: "Statistics tabs are not used to infer the current period."
  },
  matches
};
await fs.mkdir("data", { recursive: true });
await fs.writeFile(paths.current, JSON.stringify(current, null, 2));
const previousArchive = await readJson(paths.archive, { matches: [] });
const archiveMap = new Map((previousArchive.matches || []).map(match => [String(match.source_match_id || match.id), match]));
const historyRows = await readLines(paths.history);
for (const match of matches) {
  const key = String(match.source_match_id), old = archiveMap.get(key);
  archiveMap.set(key, old ? { ...old, ...match } : match);
  historyRows.push({ collected_at: now, match_id: key, match_name: match.name, stage: match.status_text, period: match.period, period_source: match.period_source || null, clock: match.clock || "", home_score: match.home.score, away_score: match.away.score, stats: match.stats, stats_by_period: match.stats_by_period });
}

// Pull recent finished fixtures directly from Flashscore. Store final scores
// separately from live snapshots; regulation totals are only emitted when all
// first three period scores are present and numeric (OT/SO excluded).
const finishedPayloads = await Promise.all([-2, -1, 0].map(async day => {
  try { return await get("/matches", { sport: "hockey", day, status: "finished" }); }
  catch (error) { console.log("HOCKEY FLASHSCORE FINISHED:", day, error.message); return null; }
}));
let finishedAdded = 0, regulationTargets = 0;
for (const payload of finishedPayloads.filter(Boolean)) {
  for (const row of allMatches(payload)) {
    const sourceId = String(row.id || "");
    const homeName = safeName(row.home), awayName = safeName(row.away);
    const homeScore = num(row.home_score), awayScore = num(row.away_score);
    if (!sourceId || !homeName || !awayName || homeScore === null || awayScore === null) continue;
    const periods = Array.isArray(row.periods) ? row.periods : [];
    const firstThree = [1, 2, 3].map(n => periods.find(p => new RegExp(`(?:period\\s*)?${n}\\b`, "i").test(String(p.name || p.period || ""))));
    const regulationValid = firstThree.every(p => p && num(p.home) !== null && num(p.away) !== null);
    const record = {
      id: `flashscore-${sourceId}`, source: "Flashscore", source_match_id: sourceId,
      league_slug: String((row.competition?.name || "hockey").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")),
      league_name: row.competition?.name || "Hokej", name: `${homeName} – ${awayName}`,
      date: row.start_time || null, status: "finished", status_text: row.stage || "Finished",
      home: { id: row.home?.id || "", name: homeName, score: homeScore },
      away: { id: row.away?.id || "", name: awayName, score: awayScore },
      periods: { home: periods.map(p => num(p.home)), away: periods.map(p => num(p.away)) },
      period_scores: periods.map(p => ({ name: p.name || null, home: num(p.home), away: num(p.away) })),
      final_result_confirmed: true,
      regulation_home_goals: regulationValid ? firstThree.reduce((sum,p) => sum + num(p.home), 0) : null,
      regulation_away_goals: regulationValid ? firstThree.reduce((sum,p) => sum + num(p.away), 0) : null,
      regulation_total_goals: regulationValid ? firstThree.reduce((sum,p) => sum + num(p.home) + num(p.away), 0) : null,
      collected_at: now
    };
    if (record.regulation_total_goals !== null) regulationTargets++;
    const old = archiveMap.get(sourceId);
    archiveMap.set(sourceId, old ? { ...old, ...record } : record);
    if (!old?.final_result_confirmed) finishedAdded++;
  }
}
const archiveMatches = [...archiveMap.values()].sort((a,b) => Date.parse(b.date || b.collected_at || 0) - Date.parse(a.date || a.collected_at || 0)).slice(0, 1500);
await fs.writeFile(paths.archive, JSON.stringify({ source: "Flashscore", updated_at: now, count: archiveMatches.length, matches: archiveMatches }, null, 2));
const retention = Date.now() - 7 * 24 * 60 * 60 * 1000;
const retained = historyRows.filter(row => Date.parse(row.collected_at || 0) >= retention).slice(-50000);
await fs.writeFile(paths.history, retained.map(row => JSON.stringify(row)).join("\n") + (retained.length ? "\n" : ""));
console.log("FLASHSCORE HOCKEY COLLECTOR:", JSON.stringify({ collected_at: now, raw_live_count: liveRows.length, live_count: matches.length, with_statistics: matches.filter(match => match.has_statistics).length, with_period: current.data_quality.matches_with_period, with_clock: current.data_quality.matches_with_clock, finished_added: finishedAdded, regulation_targets_available: regulationTargets, archive_count: archiveMatches.length, history_snapshots_7d: retained.length }));

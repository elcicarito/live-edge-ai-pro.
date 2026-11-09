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
  const stats = { home: {}, away: {} }, statsByPeriod = [];
  for (const period of statData.periods || []) {
    const periodStats = [];
    for (const group of period.groups || []) for (const stat of group.statistics || []) {
      const label = String(stat.name || "").trim();
      if (!label) continue;
      const h = stat.home_value ?? num(stat.home), a = stat.away_value ?? num(stat.away);
      const valueHome = h === null || h === undefined ? stat.home : h;
      const valueAway = a === null || a === undefined ? stat.away : a;
      if (valueHome !== null && valueHome !== undefined) stats.home[label] = valueHome;
      if (valueAway !== null && valueAway !== undefined) stats.away[label] = valueAway;
      periodStats.push({ category: group.category || null, label, home: valueHome ?? null, away: valueAway ?? null });
    }
    statsByPeriod.push({ period: period.period ?? null, statistics: periodStats });
  }
  const stage = String(row.stage || row.status || detail.stage || "LIVE");
  return {
    id: `flashscore-${sourceId}`, source: "Flashscore", source_match_id: sourceId,
    league_slug: String((detail.competition?.name || row.competition?.name || "hockey").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")),
    league_name: detail.competition?.name || row.competition?.name || "Hokej",
    name: `${homeName} – ${awayName}`, date: row.start_time || detail.start_time || null,
    status: "live", status_text: stage, period: periodNumber(stage), clock: String(row.time || row.clock || ""),
    home, away, periods: { home: [], away: [] }, stats, stats_by_period: statsByPeriod,
    available_tabs: detail.available_tabs || [], has_statistics: Boolean(detail.has_statistics || statsByPeriod.some(p => p.statistics.length)),
    collected_at: now
  };
}));
const matches = details.filter(Boolean);
if (liveRows.length && !matches.length) throw new Error("Flashscore returned LIVE hockey fixtures but none could be normalized; previous snapshot preserved.");
const current = { source: "Flashscore", collected_at: now, feed_state: matches.length ? "LIVE" : "NO_LIVE", live_count: matches.length, raw_live_count: liveRows.length, matches };
await fs.mkdir("data", { recursive: true });
await fs.writeFile(paths.current, JSON.stringify(current, null, 2));
const previousArchive = await readJson(paths.archive, { matches: [] });
const archiveMap = new Map((previousArchive.matches || []).map(match => [String(match.source_match_id || match.id), match]));
const historyRows = await readLines(paths.history);
for (const match of matches) {
  const key = String(match.source_match_id), old = archiveMap.get(key);
  archiveMap.set(key, old ? { ...old, ...match } : match);
  historyRows.push({ collected_at: now, match_id: key, match_name: match.name, stage: match.status_text, period: match.period, home_score: match.home.score, away_score: match.away.score, stats: match.stats, stats_by_period: match.stats_by_period });
}
const archiveMatches = [...archiveMap.values()].sort((a,b) => Date.parse(b.date || b.collected_at || 0) - Date.parse(a.date || a.collected_at || 0)).slice(0, 1500);
await fs.writeFile(paths.archive, JSON.stringify({ source: "Flashscore", updated_at: now, count: archiveMatches.length, matches: archiveMatches }, null, 2));
const retention = Date.now() - 7 * 24 * 60 * 60 * 1000;
const retained = historyRows.filter(row => Date.parse(row.collected_at || 0) >= retention).slice(-50000);
await fs.writeFile(paths.history, retained.map(row => JSON.stringify(row)).join("\n") + (retained.length ? "\n" : ""));
console.log("FLASHSCORE HOCKEY COLLECTOR:", JSON.stringify({ collected_at: now, raw_live_count: liveRows.length, live_count: matches.length, with_statistics: matches.filter(match => match.has_statistics).length, archive_count: archiveMatches.length, history_snapshots_7d: retained.length }));

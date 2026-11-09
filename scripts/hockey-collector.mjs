import fs from "node:fs/promises";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/hockey";
const LEAGUES = [
  { slug: "nhl", name: "NHL" },
  { slug: "mens-college-hockey", name: "NCAA – muži" },
  { slug: "womens-college-hockey", name: "NCAA – ženy" },
  { slug: "hockey-world-cup", name: "World Cup of Hockey" },
  { slug: "olympics-mens-ice-hockey", name: "Olympijský hokej – muži" },
  { slug: "olympics-womens-ice-hockey", name: "Olympijský hokej – ženy" }
];
const now = new Date().toISOString();
const get = async url => {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "LIVE-EDGE-AI-PRO-HOCKEY/1.0", "cache-control": "no-cache" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.json();
};
const first = (...values) => values.find(v => v !== undefined && v !== null && v !== "");
const teamOf = (event, side) => {
  const comp = event.competitions?.[0] || {};
  return comp.competitors?.find(x => x.homeAway === side) || {};
};
const numberOrNull = value => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace("%",""));
  return Number.isFinite(n) ? n : null;
};
const normalize = (event, league) => {
  const comp = event.competitions?.[0] || {};
  const status = comp.status || event.status || {};
  const type = status.type || {};
  const home = teamOf(event, "home");
  const away = teamOf(event, "away");
  if (!home.team || !away.team) return null;
  const state = String(type.state || "").toLowerCase();
  const statusText = first(type.detail, type.shortDetail, type.description, status.displayClock, "Neznámy stav");
  const period = numberOrNull(status.period);
  const lines = comp.situation?.lastPlay ? [] : (comp.competitors || []).map(x => x.linescores || []);
  const lineScores = {};
  for (const side of [home, away]) {
    const key = side.homeAway === "home" ? "home" : "away";
    lineScores[key] = (side.linescores || []).map(x => numberOrNull(x.displayValue ?? x.value));
  }
  const stats = {};
  for (const side of [home, away]) {
    const key = side.homeAway === "home" ? "home" : "away";
    stats[key] = {};
    for (const s of side.statistics || []) {
      const name = String(s.name || s.abbreviation || "");
      if (!name) continue;
      stats[key][name] = numberOrNull(first(s.displayValue, s.value));
    }
  }
  return {
    id: String(event.id),
    league_slug: league.slug,
    league_name: league.name,
    name: event.name || comp.name || "",
    date: event.date || null,
    status: state === "in" ? "live" : state === "post" ? "finished" : state || "scheduled",
    status_text: String(statusText),
    period,
    clock: String(first(status.displayClock, "")),
    home: { id: String(home.team.id || ""), name: home.team.displayName || home.team.name || "", abbreviation: home.team.abbreviation || "", score: numberOrNull(home.score) },
    away: { id: String(away.team.id || ""), name: away.team.displayName || away.team.name || "", abbreviation: away.team.abbreviation || "", score: numberOrNull(away.score) },
    periods: lineScores,
    stats,
    venue: comp.venue?.fullName || null,
    collected_at: now
  };
};

const settled = await Promise.all(LEAGUES.map(async league => {
  try {
    const data = await get(`${BASE}/${league.slug}/scoreboard?limit=300`);
    const events = (data.events || []).map(event => normalize(event, league)).filter(Boolean);
    return { league, ok: true, events, event_count: events.length };
  } catch (error) {
    console.log(`LEAGUE ERROR ${league.slug}: ${error.message}`);
    return { league, ok: false, events: [], error: error.message };
  }
}));
const all = settled.flatMap(x => x.events);
const live = all.filter(x => x.status === "live");
const finished = all.filter(x => x.status === "finished");
await fs.mkdir("data", { recursive: true });
const current = {
  source: "ESPN public site API",
  collected_at: now,
  feed_state: live.length ? "LIVE" : "NO_LIVE",
  league_checks: settled.map(x => ({ slug: x.league.slug, name: x.league.name, ok: x.ok, event_count: x.event_count, error: x.error || null })),
  live_count: live.length,
  matches: live
};
await fs.writeFile("data/hockey-current.json", JSON.stringify(current, null, 2));
let archive = [];
try { archive = JSON.parse(await fs.readFile("data/hockey-archive.json", "utf8")); } catch {}
const byId = new Map(archive.map(x => [`${x.league_slug}:${x.id}`, x]));
for (const match of finished) {
  const key = `${match.league_slug}:${match.id}`;
  const old = byId.get(key);
  byId.set(key, old ? { ...old, ...match, stats: Object.keys(match.stats.home || {}).length || Object.keys(match.stats.away || {}).length ? match.stats : old.stats } : match);
}
archive = [...byId.values()].sort((a,b) => Date.parse(b.date || b.collected_at) - Date.parse(a.date || a.collected_at)).slice(0, 1500);
await fs.writeFile("data/hockey-archive.json", JSON.stringify({ source: "ESPN public site API", updated_at: now, count: archive.length, matches: archive }, null, 2));
const summary = { collected_at: now, leagues_checked: settled.length, leagues_ok: settled.filter(x=>x.ok).length, live_count: live.length, finished_seen: finished.length, archive_count: archive.length, errors: settled.filter(x=>!x.ok).map(x=>({league:x.league.slug,error:x.error})) };
await fs.writeFile("data/hockey-collector-status.json", JSON.stringify(summary, null, 2));
console.log("HOCKEY COLLECTOR:", JSON.stringify(summary));

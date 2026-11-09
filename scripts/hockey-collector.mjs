import fs from "node:fs/promises";

const CORE = "https://sports.core.api.espn.com/v2/sports/hockey/leagues";
const BASE = "https://site.api.espn.com/apis/site/v2/sports/hockey";
const now = new Date().toISOString();
const readJson = async (path, fallback = null) => {
  try { return JSON.parse(await fs.readFile(path, "utf8")); } catch { return fallback; }
};
const comparable = value => {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).filter(key =>
      !["collected_at", "updated_at", "summary_checked_at"].includes(key)
    ).sort().map(key => [key, comparable(value[key])]));
  }
  return value;
};
const sameData = (a, b) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
const headers = { accept: "application/json", "user-agent": "LIVE-EDGE-AI-PRO-HOCKEY/1.0", "cache-control": "no-cache" };
const get = async url => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.json();
};
const first = (...values) => values.find(v => v !== undefined && v !== null && v !== "");
const numberOrNull = value => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace("%", ""));
  return Number.isFinite(n) ? n : null;
};
const teamOf = (event, side) => (event.competitions?.[0]?.competitors || []).find(x => x.homeAway === side) || {};
const leagueNameOf = data => {
  const item = data.leagues?.[0] || data.league || {};
  return String(first(item.name, item.abbreviation, item.shortName, data.season?.name, data.name) || "");
};

// Zoznam líg sa číta priamo z ESPN adresára. Žiadne vopred vymyslené slugy.
const directory = await get(`${CORE}?limit=100&page=1`);
const refs = [...(directory.items || [])];
const pageCount = Math.max(1, Number(directory.pageCount || 1));
for (let page = 2; page <= pageCount; page++) {
  const result = await get(`${CORE}?limit=100&page=${page}`);
  refs.push(...(result.items || []));
}
const leagueMap = new Map();
for (const item of refs) {
  const ref = item?.$ref || item?.ref || "";
  const slug = ref.match(/\/leagues\/([^/?]+)/)?.[1];
  if (slug) leagueMap.set(slug, { slug, name: slug });
}
const leagues = [...leagueMap.values()];
if (!leagues.length) throw new Error("ESPN hockey league directory returned no league IDs; existing data was not overwritten.");
console.log(`ESPN HOCKEY DIRECTORY: ${leagues.length} leagues discovered`);

const normalize = (event, league) => {
  const comp = event.competitions?.[0] || {};
  const status = comp.status || event.status || {};
  const type = status.type || {};
  const home = teamOf(event, "home");
  const away = teamOf(event, "away");
  if (!home.team || !away.team) return null;
  const state = String(type.state || "").toLowerCase();
  const lineScores = {};
  for (const side of [home, away]) {
    const key = side.homeAway === "home" ? "home" : "away";
    lineScores[key] = (side.linescores || []).map(x => numberOrNull(x.displayValue ?? x.value));
  }
  const stats = {};
  for (const side of [home, away]) {
    const key = side.homeAway === "home" ? "home" : "away";
    stats[key] = {};
    for (const stat of side.statistics || []) {
      const name = String(stat.name || stat.abbreviation || "");
      if (name) stats[key][name] = numberOrNull(first(stat.displayValue, stat.value));
    }
  }
  return {
    id: String(event.id),
    league_slug: league.slug,
    league_name: league.name,
    name: event.name || comp.name || "",
    date: event.date || null,
    status: state === "in" ? "live" : state === "post" ? "finished" : state || "scheduled",
    status_text: String(first(type.detail, type.shortDetail, type.description, status.displayClock, "Neznámy stav")),
    period: numberOrNull(status.period),
    clock: String(first(status.displayClock, "")),
    home: { id: String(home.team.id || ""), name: home.team.displayName || home.team.name || "", abbreviation: home.team.abbreviation || "", score: numberOrNull(home.score) },
    away: { id: String(away.team.id || ""), name: away.team.displayName || away.team.name || "", abbreviation: away.team.abbreviation || "", score: numberOrNull(away.score) },
    periods: lineScores,
    stats,
    venue: comp.venue?.fullName || null,
    collected_at: now
  };
};

// ESPN endpointy sa skúšajú pre každý adresárový league ID. Paralelizácia je obmedzená.
const settled = [];
for (let i = 0; i < leagues.length; i += 4) {
  const batch = leagues.slice(i, i + 4);
  const results = await Promise.all(batch.map(async league => {
    try {
      const data = await get(`${BASE}/${league.slug}/scoreboard?limit=300`);
      const name = leagueNameOf(data) || league.name;
      league.name = name;
      const events = (data.events || []).map(event => normalize(event, league)).filter(Boolean);
      return { league, ok: true, events, event_count: events.length };
    } catch (error) {
      console.log(`LEAGUE SCOREBOARD ERROR ${league.slug}: ${error.message}`);
      return { league, ok: false, events: [], event_count: 0, error: error.message };
    }
  }));
  settled.push(...results);
}
const supported = settled.filter(x => x.ok);
if (!supported.length) throw new Error("No ESPN hockey scoreboard endpoint responded successfully; existing data was not overwritten.");
const all = settled.flatMap(x => x.events);
const live = all.filter(x => x.status === "live");
const finished = all.filter(x => x.status === "finished");

// Detail/boxscore doplní LIVE štatistiky tam, kde ich ESPN pre súťaž poskytuje.
for (let i = 0; i < live.length; i += 5) {
  await Promise.all(live.slice(i, i + 5).map(async match => {
    try {
      const summary = await get(`${BASE}/${match.league_slug}/summary?event=${encodeURIComponent(match.id)}`);
      const teams = summary?.boxscore?.teams || [];
      for (const row of teams) {
        const id = String(row.team?.id || row.teamId || "");
        const side = id && id === String(match.home.id) ? "home" : id && id === String(match.away.id) ? "away" : null;
        if (!side) continue;
        const parsed = {};
        for (const stat of row.statistics || []) {
          const name = String(stat.name || stat.abbreviation || "");
          if (name) parsed[name] = numberOrNull(first(stat.displayValue, stat.value));
        }
        if (Object.keys(parsed).length) match.stats[side] = { ...match.stats[side], ...parsed };
      }
      const competition = summary?.header?.competitions?.[0];
      if (competition?.status?.displayClock) match.clock = String(competition.status.displayClock);
      if (competition?.status?.period) match.period = numberOrNull(competition.status.period);
      match.summary_checked_at = new Date().toISOString();
    } catch (error) {
      console.log(`SUMMARY ERROR ${match.league_slug}/${match.id}: ${error.message}`);
    }
  }));
}
await fs.mkdir("data", { recursive: true });
const current = {
  source: "ESPN public site API",
  collected_at: now,
  feed_state: live.length ? "LIVE" : "NO_LIVE",
  directory_count: leagues.length,
  supported_league_count: supported.length,
  league_checks: settled.map(x => ({ slug: x.league.slug, name: x.league.name, ok: x.ok, event_count: x.event_count, error: x.error || null })),
  live_count: live.length,
  matches: live
};
const previousCurrent = await readJson("data/hockey-current.json", null);
if (previousCurrent && sameData(previousCurrent, current)) {
  current.collected_at = previousCurrent.collected_at || now;
  const previousMatches = new Map((previousCurrent.matches || []).map(match => [`${match.league_slug}:${match.id}`, match]));
  current.matches = current.matches.map(match => {
    const previous = previousMatches.get(`${match.league_slug}:${match.id}`);
    return previous && sameData(previous, match)
      ? { ...match, collected_at: previous.collected_at, summary_checked_at: previous.summary_checked_at }
      : match;
  });
}
await fs.writeFile("data/hockey-current.json", JSON.stringify(current, null, 2));

const stored = await readJson("data/hockey-archive.json", {});
let archive = Array.isArray(stored) ? stored : Array.isArray(stored.matches) ? stored.matches : [];
const byId = new Map(archive.map(x => [`${x.league_slug}:${x.id}`, x]));
for (const match of finished) {
  const key = `${match.league_slug}:${match.id}`;
  const old = byId.get(key);
  const hasStats = Object.keys(match.stats.home || {}).length || Object.keys(match.stats.away || {}).length;
  const merged = old ? { ...old, ...match, stats: hasStats ? match.stats : old.stats } : match;
  if (old && sameData(old, merged)) {
    merged.collected_at = old.collected_at;
    merged.summary_checked_at = old.summary_checked_at;
  }
  byId.set(key, merged);
}
archive = [...byId.values()].sort((a, b) => Date.parse(b.date || b.collected_at) - Date.parse(a.date || a.collected_at)).slice(0, 1500);
const previousArchive = stored && !Array.isArray(stored) ? stored : null;
const archivePayload = { source: "ESPN public site API", updated_at: now, count: archive.length, matches: archive };
if (previousArchive && sameData(previousArchive, archivePayload)) archivePayload.updated_at = previousArchive.updated_at || now;
await fs.writeFile("data/hockey-archive.json", JSON.stringify(archivePayload, null, 2));
const summary = {
  collected_at: now,
  directory_leagues: leagues.length,
  scoreboards_supported: supported.length,
  scoreboards_failed: settled.length - supported.length,
  live_count: live.length,
  finished_seen: finished.length,
  archive_count: archive.length,
  errors: settled.filter(x => !x.ok).map(x => ({ league: x.league.slug, error: x.error }))
};
const previousSummary = await readJson("data/hockey-collector-status.json", null);
if (previousSummary && sameData(previousSummary, summary)) summary.collected_at = previousSummary.collected_at || now;
await fs.writeFile("data/hockey-collector-status.json", JSON.stringify(summary, null, 2));
console.log("HOCKEY COLLECTOR:", JSON.stringify(summary));

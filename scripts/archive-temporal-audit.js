const fs = require("fs");
const path = require("path");
const HISTORY = "data/live-match-history.jsonl";
const OUT = "audit-output";
const norm = v => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const finite = v => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
function parseMinute(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 130) return Number.isInteger(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (/^\d{1,3}$/.test(s)) { const n = Number(s); return n <= 130 ? n : null; }
  const added = s.match(/^(\d{1,2})\s*\+\s*(\d{1,2})$/);
  if (added) { const n = Number(added[1]) + Number(added[2]); return n <= 130 ? n : null; }
  return null;
}
function eventMinute(e) {
  for (const k of ["time", "minute", "elapsed", "elapsed_time", "match_time"]) {
    if (e && e[k] !== undefined && e[k] !== null) {
      const m = parseMinute(e[k]);
      if (m !== null) return { minute: m, field: k, raw: e[k] };
    }
  }
  return { minute: null, field: null, raw: e?.time ?? e?.minute ?? null };
}
function eventsOf(m) {
  for (const k of ["events", "incidents", "timeline", "match_events"]) if (Array.isArray(m?.[k])) return { events: m[k], field: k };
  return { events: [], field: null };
}
function isGoal(e) {
  if (e?.is_goal === true) return true;
  const t = norm(e?.type || e?.event || e?.name || e?.incident_type);
  return t === "goal" || t === "penaltygoal" || t === "owngoal" || t.includes("goal");
}
function scorePair(s) {
  const candidates = [s, s?.raw_match, s?.match, s?.raw_match?.score, s?.score];
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const h = c.home_score ?? c.homeScore ?? c.score_home ?? c.home;
    const a = c.away_score ?? c.awayScore ?? c.score_away ?? c.away;
    if (finite(h) && finite(a)) return [Number(h), Number(a)];
  }
  return null;
}
function goalSide(e, match) {
  const homeName = norm(match?.home || match?.final_match?.home || "");
  const awayName = norm(match?.away || match?.final_match?.away || "");
  for (const raw of [e?.side, e?.team, e?.team_name, e?.participant, e?.competitor]) {
    if (raw === null || raw === undefined || raw === "") continue;
    const v = norm(raw);
    if (["home", "h", "1", "hometeam"].includes(v) || (homeName && v === homeName)) return "home";
    if (["away", "a", "2", "awayteam"].includes(v) || (awayName && v === awayName)) return "away";
  }
  return null;
}
function finalPair(x) {
  const m = String(x.final_score ?? "").match(/^\s*(\d+)\s*[:\-]\s*(\d+)\s*$/);
  if (m) return [Number(m[1]), Number(m[2])];
  return scorePair(x.final_match);
}
function statsOf(s) {
  if (Array.isArray(s?.stats) && s.stats.length) return s.stats;
  if (Array.isArray(s?.raw_stats) && s.raw_stats.length) return s.raw_stats;
  const nested = s?.raw_match || s?.match || {};
  return Array.isArray(nested.stats) ? nested.stats : [];
}
function statFeature(stats, keys) {
  const wanted = keys.map(norm);
  const rows = (stats || []).filter(st => st && (st.label || st.name || st.type));
  const labelOf = st => norm(st.label || st.name || st.type || "");
  let item = rows.find(st => wanted.includes(labelOf(st)));
  if (!item) item = rows.find(st => {
    const label = labelOf(st);
    if (!wanted.some(k => label.includes(k))) return false;
    if (wanted.includes("shots") && (label.includes("shotsontarget") || label.includes("shotsofftarget"))) return false;
    if (wanted.includes("attacks") && label.includes("dangerousattacks")) return false;
    return true;
  });
  if (!item) return { home: null, away: null, label: "" };
  const h = Number(item.home), a = Number(item.away);
  return {
    home: Number.isFinite(h) ? h : null,
    away: Number.isFinite(a) ? a : null,
    label: String(item.label || item.name || item.type || "")
  };
}
function extractFeatures(s) {
  const stats = statsOf(s);
  const defs = {
    shots: ["shots", "total shots", "shots total"],
    shots_on_target: ["shots on target", "on target"],
    shots_off_target: ["shots off target", "off target"],
    dangerous_attacks: ["dangerous attacks"],
    attacks: ["attacks", "total attacks"],
    possession: ["possession"],
    xg: ["expected goals", "xg"],
    corners: ["corners", "corner kicks"]
  };
  const out = {};
  for (const [key, labels] of Object.entries(defs)) {
    const v = statFeature(stats, labels);
    out[key + "_home"] = v.home;
    out[key + "_away"] = v.away;
    out[key + "_label"] = v.label;
  }
  out.raw_stats_json = JSON.stringify(stats);
  return out;
}
function ts(v) { const n = Date.parse(v); return Number.isFinite(n) ? n : null; }
function median(a) {
  if (!a.length) return null;
  const b = [...a].sort((x,y)=>x-y), i = Math.floor(b.length/2);
  return b.length % 2 ? b[i] : (b[i-1]+b[i])/2;
}
function bump(map, key, n=1) { map.set(String(key), (map.get(String(key)) || 0) + n); }
function top(map, limit=30) { return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([value,count])=>({value,count})); }

const raw = fs.readFileSync(HISTORY, "utf8");
const matches = new Map();
let invalidLines = 0, duplicateIds = 0;
for (const line of raw.split(/\r?\n/)) {
  if (!line.trim()) continue;
  try {
    const x = JSON.parse(line);
    if (!x || x.match_id == null) { invalidLines++; continue; }
    const id = String(x.match_id);
    if (matches.has(id)) {
      duplicateIds++;
      if ((x.snapshots || []).length > (matches.get(id).snapshots || []).length) matches.set(id, x);
    } else matches.set(id, x);
  } catch { invalidLines++; }
}

const minuteTypes = new Map(), eventTimeTypes = new Map(), reasonCounts = new Map();
const minuteValues = [], eventMinuteValues = [], goalEventsSamples = [], matchRows = [], allLabeled = [], goalEventAuditRows = [];
const labelCounts = { positive: 0, negative: 0, ambiguous: 0, no_event_list: 0, invalid_final_score: 0 };
let totalSnapshots = 0, parsedSnapshotMinutes = 0, parsedGoalTimes = 0, totalGoals = 0;
let matchesWithEvents = 0, matchesWithCompleteGoalTimeline = 0, matchesWithScoreTimelineAgreement = 0;
let matchesWithValidFinal = 0, goalEventsWithoutTime = 0, nonMonotonicMatches = 0;
let duplicateCollectedAt = 0, snapshotScoreMissing = 0, sameMinuteGoalAmbiguities = 0;
let sideScoreAgreementCount = 0, sideScoreUnverifiable = 0;

for (const [id, x] of matches) {
  const fm = x.final_match || {};
  const eventInfo = eventsOf(fm), events = eventInfo.events;
  const goals = events.filter(isGoal);
  totalGoals += goals.length;
  if (events.length) matchesWithEvents++;
  const final = finalPair(x), finalOK = !!final;
  if (finalOK) matchesWithValidFinal++;
  const finalGoalTotal = finalOK ? final[0] + final[1] : null;
  const goalRecords = goals.map(e => ({ event: e, ...eventMinute(e) }));
  for (const g of goalRecords) {
    bump(eventTimeTypes, g.raw === null ? "missing" : typeof g.raw);
    if (g.minute === null) goalEventsWithoutTime++;
    else { parsedGoalTimes++; eventMinuteValues.push(g.minute); }
    if (goalEventsSamples.length < 12) goalEventsSamples.push({
      match_id: id, event_type: g.event?.type || g.event?.event || g.event?.name || "unknown",
      raw_time: g.raw, parsed_minute: g.minute, time_field: g.field
    });
  }
  const allGoalTimesValid = goalRecords.every(g => g.minute !== null);
  const goalCountAgrees = finalOK && goals.length === finalGoalTotal;
  const timelineComplete = events.length > 0 && finalOK && allGoalTimesValid && goalCountAgrees;
  if (timelineComplete) matchesWithCompleteGoalTimeline++;

  const seen = new Set(), snaps = [];
  for (const s of (Array.isArray(x.snapshots) ? x.snapshots : [])) {
    const key = String(s?.collected_at || "missing-" + seen.size);
    if (seen.has(key)) { duplicateCollectedAt++; continue; }
    seen.add(key); snaps.push(s);
  }
  snaps.sort((a,b) => String(a?.collected_at || "").localeCompare(String(b?.collected_at || "")));
  for (const g of goalRecords) {
    const before = [...snaps].reverse().find(s => {
      const m = parseMinute(s?.minute ?? s?.live_minute ?? s?.raw_match?.live_minute ?? s?.match?.live_minute);
      return m !== null && g.minute !== null && m < g.minute;
    });
    const after = snaps.find(s => {
      const m = parseMinute(s?.minute ?? s?.live_minute ?? s?.raw_match?.live_minute ?? s?.match?.live_minute);
      return m !== null && g.minute !== null && m > g.minute;
    });
    const snapFields = s => {
      if (!s) return {};
      const m = parseMinute(s?.minute ?? s?.live_minute ?? s?.raw_match?.live_minute ?? s?.match?.live_minute);
      const sc = scorePair(s);
      const st = extractFeatures(s);
      return { minute: m, collected_at: s.collected_at || "", home_score: sc?.[0] ?? "", away_score: sc?.[1] ?? "",
        shots_on_target_home: st.shots_on_target_home ?? "", shots_on_target_away: st.shots_on_target_away ?? "",
        dangerous_attacks_home: st.dangerous_attacks_home ?? "", dangerous_attacks_away: st.dangerous_attacks_away ?? "" };
    };
    const b = snapFields(before), a = snapFields(after);
    goalEventAuditRows.push({
      match_id: id, home: x.home || fm.home || "", away: x.away || fm.away || "",
      competition: x.competition || "", event_type: g.event?.type || g.event?.event || g.event?.name || "",
      event_minute_raw: g.raw ?? "", event_minute_parsed: g.minute ?? "", event_minute_field: g.field || "",
      event_team: g.event?.team || g.event?.team_name || g.event?.participant || "",
      event_player: g.event?.player || g.event?.player_name || "",
      snapshot_before_minute: b.minute ?? "", snapshot_before_collected_at: b.collected_at || "",
      snapshot_before_score: b.minute === undefined ? "" : String(b.home_score) + "-" + String(b.away_score),
      snapshot_before_sot_home: b.shots_on_target_home ?? "", snapshot_before_sot_away: b.shots_on_target_away ?? "",
      snapshot_before_dangerous_home: b.dangerous_attacks_home ?? "", snapshot_before_dangerous_away: b.dangerous_attacks_away ?? "",
      snapshot_after_minute: a.minute ?? "", snapshot_after_collected_at: a.collected_at || "",
      snapshot_after_score: a.minute === undefined ? "" : String(a.home_score) + "-" + String(a.away_score),
      snapshot_after_sot_home: a.shots_on_target_home ?? "", snapshot_after_sot_away: a.shots_on_target_away ?? "",
      snapshot_after_dangerous_home: a.dangerous_attacks_home ?? "", snapshot_after_dangerous_away: a.dangerous_attacks_away ?? "",
      event_json: JSON.stringify(g.event || {})
    });
  }
  totalSnapshots += snaps.length;
  // Mark only the regressing snapshot and the uncertain interval until the
  // match minute catches up with the previous high-water mark.
  const minuteAmbiguous = new Array(snaps.length).fill(false);
  let minuteHighWater = null, inRegressionWindow = false, regressionCount = 0;
  for (let i = 0; i < snaps.length; i++) {
    const m = parseMinute(snaps[i]?.minute ?? snaps[i]?.live_minute ?? snaps[i]?.raw_match?.live_minute ?? snaps[i]?.match?.live_minute);
    if (m === null) { minuteAmbiguous[i] = inRegressionWindow; continue; }
    if (minuteHighWater !== null && m < minuteHighWater) {
      inRegressionWindow = true;
      regressionCount++;
    }
    minuteAmbiguous[i] = inRegressionWindow;
    if (inRegressionWindow && m >= minuteHighWater) inRegressionWindow = false;
    minuteHighWater = Math.max(minuteHighWater ?? m, m);
  }
  const hasMinuteRegression = regressionCount > 0;

  let eligible = 0, positives = 0, negatives = 0, ambiguous = 0;
  let agreementCount = 0, matchSideScoreAgreementCount = 0, matchSideScoreUnverifiable = 0;
  for (let snapshotIndex = 0; snapshotIndex < snaps.length; snapshotIndex++) {
    const s = snaps[snapshotIndex];
    const rawMinute = s?.minute ?? s?.live_minute ?? s?.raw_match?.live_minute ?? s?.match?.live_minute;
    const minute = parseMinute(rawMinute);
    bump(minuteTypes, rawMinute === null || rawMinute === undefined ? "missing" : typeof rawMinute);
    if (minute === null) continue;
    parsedSnapshotMinutes++; minuteValues.push(minute);
    const score = scorePair(s);
    if (!score) snapshotScoreMissing++;
    if (timelineComplete && score && !minuteAmbiguous[snapshotIndex]) {
      const beforeEvents = goalRecords.filter(g => g.minute < minute);
      const sameAtMinute = goalRecords.some(g => g.minute === minute);
      const goalsBefore = beforeEvents.length;
      if (!sameAtMinute && score[0] + score[1] === goalsBefore) agreementCount++;
      const sides = beforeEvents.map(g => goalSide(g.event, x));
      if (!sameAtMinute && sides.every(Boolean)) {
        const expected = [sides.filter(v => v === "home").length, sides.filter(v => v === "away").length];
        if (score[0] === expected[0] && score[1] === expected[1]) matchSideScoreAgreementCount++;
      } else if (!sameAtMinute) matchSideScoreUnverifiable++;
    }

    if (!events.length) { labelCounts.no_event_list++; continue; }
    if (!finalOK) { labelCounts.invalid_final_score++; continue; }
    if (!timelineComplete) {
      labelCounts.ambiguous++; ambiguous++;
      bump(reasonCounts, !allGoalTimesValid ? "gólová udalosť bez čitateľnej minúty" : !goalCountAgrees ? "počet gólov v udalostiach nesúhlasí s konečným skóre" : "neúplná časová os");
      continue;
    }
    if (minuteAmbiguous[snapshotIndex]) { labelCounts.ambiguous++; ambiguous++; bump(reasonCounts, "snímka v nejednoznačnom úseku po poklese minúty"); continue; }
    if (!score) { labelCounts.ambiguous++; ambiguous++; bump(reasonCounts, "chýba skóre v LIVE snímke"); continue; }
    if (goalRecords.some(g => g.minute === minute)) {
      sameMinuteGoalAmbiguities++; labelCounts.ambiguous++; ambiguous++;
      bump(reasonCounts, "gól v rovnakej minúte ako LIVE snímka"); continue;
    }
    const goalsBefore = goalRecords.filter(g => g.minute < minute).length;
    const beforeEvents = goalRecords.filter(g => g.minute < minute);
    const sides = beforeEvents.map(g => goalSide(g.event, x));
    if (score[0] + score[1] !== goalsBefore || !sides.every(Boolean) ||
        score[0] !== sides.filter(v => v === "home").length ||
        score[1] !== sides.filter(v => v === "away").length) {
      labelCounts.ambiguous++; ambiguous++;
      bump(reasonCounts, !sides.every(Boolean)
        ? "nemožno určiť stranu všetkých gólových udalostí pred snímkou"
        : "LIVE skóre domácich/hostí nesúhlasí s gólovými udalosťami");
      continue;
    }
    if (minute > 80 || minute + 10 > 90) {
      labelCounts.ambiguous++; ambiguous++;
      bump(reasonCounts, "nedostatočný priestor na celý 10-minútový horizont"); continue;
    }
    const futureGoal = goalRecords.some(g => g.minute > minute && g.minute <= minute + 10);
    const features = extractFeatures(s);
    allLabeled.push({
      match_id: id, archived_at: x.archived_at || "", collected_at: s.collected_at || "",
      home: x.home || fm.home || "", away: x.away || fm.away || "",
      competition: x.competition || "", minute, home_score: score[0], away_score: score[1],
      goal_next_10m: futureGoal ? 1 : 0, ...features
    });
    eligible++;
    if (futureGoal) { positives++; labelCounts.positive++; }
    else { negatives++; labelCounts.negative++; }
  }
  sideScoreAgreementCount += matchSideScoreAgreementCount;
  sideScoreUnverifiable += matchSideScoreUnverifiable;
  if (hasMinuteRegression) nonMonotonicMatches++;
  if (timelineComplete && agreementCount > 0) matchesWithScoreTimelineAgreement++;
  matchRows.push({
    match_id: id, archived_at: x.archived_at || "", final_score: x.final_score || "",
    final_score_valid: finalOK, event_field: eventInfo.field || "", event_count: events.length,
    goal_event_count: goals.length, goal_times_all_valid: allGoalTimesValid,
    goal_count_matches_final: goalCountAgrees, timeline_complete_candidate: timelineComplete,
    snapshot_count: snaps.length, parsed_minute_count: snaps.filter(s => parseMinute(s?.minute ?? s?.live_minute ?? s?.raw_match?.live_minute ?? s?.match?.live_minute) !== null).length,
    non_monotonic_minutes: hasMinuteRegression, minute_regression_count: regressionCount,
    eligible_10m_examples: eligible,
    positive_10m: positives, negative_10m: negatives, ambiguous_10m: ambiguous
  });
}

const chronological = matchRows.filter(r => ts(r.archived_at) !== null).sort((a,b) => ts(a.archived_at) - ts(b.archived_at));
const splitAt = Math.floor(chronological.length * 0.8);
const split = {
  method: "chronological by archived_at; split by whole match, never by snapshot",
  dated_matches: chronological.length, proposed_train_matches: splitAt,
  proposed_test_matches: chronological.length - splitAt,
  train_end_archived_at: chronological[splitAt - 1]?.archived_at || null,
  test_start_archived_at: chronological[splitAt]?.archived_at || null,
  train_labeled_snapshots: 0, test_labeled_snapshots: 0,
  train_positive: 0, test_positive: 0, train_negative: 0, test_negative: 0
};
const trainIds = new Set(chronological.slice(0, splitAt).map(r=>r.match_id));
for (const r of allLabeled) {
  if (trainIds.has(r.match_id)) {
    split.train_labeled_snapshots++;
    if (r.goal_next_10m) split.train_positive++; else split.train_negative++;
  } else {
    split.test_labeled_snapshots++;
    if (r.goal_next_10m) split.test_positive++; else split.test_negative++;
  }
}

const report = {
  generated_at_utc: new Date().toISOString(), read_only: true, source: HISTORY,
  parsing_rules: {
    accepted_minute_formats: ["integer number", "integer string", "stoppage-time string such as 45+2 (normalized to 47)"],
    rejected_minute_formats: ["clock strings", "period labels", "unrecognized text"],
    goal_detection: "is_goal === true or event type/name containing goal",
    label_definition: "goal event strictly after snapshot minute and at or before minute+10",
    conservative_eligibility: "requires event list, valid final score, every goal event timed, goal-event count equal to final goals, snapshot score equal to goal events strictly before snapshot minute, no goal in same minute, and full 10-minute window within 0–90"
  },
  archive: { unique_matches: matches.size, duplicate_ids: duplicateIds, invalid_jsonl_lines: invalidLines },
  time_schema: {
    total_snapshots: totalSnapshots, snapshots_with_parseable_minute: parsedSnapshotMinutes,
    snapshot_minute_types: top(minuteTypes),
    snapshot_minute_min: minuteValues.length ? Math.min(...minuteValues) : null,
    snapshot_minute_max: minuteValues.length ? Math.max(...minuteValues) : null,
    snapshot_minute_median: median(minuteValues),
    goal_events_total: totalGoals, goal_events_with_parseable_minute: parsedGoalTimes,
    goal_events_without_parseable_minute: goalEventsWithoutTime,
    goal_event_time_types: top(eventTimeTypes),
    goal_event_minute_min: eventMinuteValues.length ? Math.min(...eventMinuteValues) : null,
    goal_event_minute_max: eventMinuteValues.length ? Math.max(...eventMinuteValues) : null,
    sample_goal_event_times: goalEventsSamples, matches_with_event_list: matchesWithEvents,
    matches_with_valid_final_score: matchesWithValidFinal,
    matches_with_complete_goal_timeline_candidate: matchesWithCompleteGoalTimeline,
    matches_with_at_least_one_snapshot_score_timeline_agreement: matchesWithScoreTimelineAgreement,
    snapshots_with_home_away_score_and_event_side_agreement: sideScoreAgreementCount,
    snapshots_with_unverifiable_goal_event_sides: sideScoreUnverifiable,
    matches_with_non_monotonic_snapshot_minutes: nonMonotonicMatches,
    note: "A minute regression now excludes only the ambiguous interval until the minute catches up; earlier safe snapshots remain eligible. Training labels require independently resolved home/away goal sides.",
    duplicate_collected_at_snapshots: duplicateCollectedAt, snapshots_missing_score: snapshotScoreMissing
  },
  ten_minute_labels: {
    positive: labelCounts.positive, negative: labelCounts.negative,
    ambiguous_or_excluded: labelCounts.ambiguous,
    no_event_list_snapshot_count: labelCounts.no_event_list,
    invalid_final_score_snapshot_count: labelCounts.invalid_final_score,
    same_minute_goal_ambiguities: sameMinuteGoalAmbiguities,
    exclusion_reasons: top(reasonCounts, 30),
    total_usable_labeled_snapshots: allLabeled.length,
    positive_rate_percent: allLabeled.length ? Number((100 * labelCounts.positive / allLabeled.length).toFixed(2)) : null,
    warning: "Candidate labels only; not model accuracy or proof that the source timeline is complete."
  },
  chronological_split: split,
  readiness: allLabeled.length >= 200 && split.test_labeled_snapshots >= 30 && split.test_positive >= 5
    ? "CANDIDATE_DATA_AVAILABLE_REQUIRES_MANUAL_REVIEW_AND_BASELINE"
    : "INSUFFICIENT_OR_UNVERIFIED_DATA_FOR_MODEL_TRAINING",
  match_coverage: matchRows
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "live-edge-temporal-audit.json"), JSON.stringify(report, null, 2) + "\n");
const cols = Object.keys(matchRows[0] || { match_id: "", archived_at: "", final_score: "" });
const csv = [cols.join(","), ...matchRows.map(r => cols.map(k => '"' + String(r[k] ?? "").replace(/"/g,'""') + '"').join(","))].join("\n") + "\n";
fs.writeFileSync(path.join(OUT, "live-edge-temporal-match-coverage.csv"), csv);

const goalAuditCols = Object.keys(goalEventAuditRows[0] || { match_id: "", event_minute_parsed: "" });
const goalAuditCsv = [goalAuditCols.join(","), ...goalEventAuditRows.map(r =>
  goalAuditCols.map(k => '"' + String(r[k] ?? "").replace(/"/g,'""') + '"').join(",")
)].join("\n") + "\n";
fs.writeFileSync(path.join(OUT, "live-edge-goal-event-timing-audit.csv"), goalAuditCsv);

// Sample-level, feature-enriched dataset for offline analysis only.
const featureKeys = ["shots_home","shots_away","shots_on_target_home","shots_on_target_away",
  "shots_off_target_home","shots_off_target_away","dangerous_attacks_home","dangerous_attacks_away",
  "attacks_home","attacks_away","possession_home","possession_away","xg_home","xg_away",
  "corners_home","corners_away"];
const featureCoverage = Object.fromEntries(featureKeys.map(k => [k, allLabeled.filter(r => finite(r[k])).length]));
const featureCols = ["match_id","archived_at","collected_at","home","away","competition","minute",
  "home_score","away_score","goal_next_10m", ...featureKeys,
  "shots_label","shots_on_target_label","shots_off_target_label","dangerous_attacks_label",
  "attacks_label","possession_label","xg_label","corners_label","raw_stats_json"];
const featureCsv = [featureCols.join(","), ...allLabeled.map(r =>
  featureCols.map(k => '"' + String(r[k] ?? "").replace(/"/g,'""') + '"').join(",")
)].join("\n") + "\n";
fs.writeFileSync(path.join(OUT, "live-edge-goal-10m-feature-dataset.csv"), featureCsv);
fs.writeFileSync(path.join(OUT, "live-edge-goal-10m-feature-coverage.json"), JSON.stringify({
  generated_at_utc: report.generated_at_utc, read_only: true,
  rows: allLabeled.length, feature_coverage: featureCoverage,
  note: "Sample-level candidate labels; raw stats retained for manual schema review. Not a trained model."
}, null, 2) + "\n");

const summary = [
  "# LIVE EDGE – časový audit predikcie gólu", "",
  "Vygenerované UTC: " + report.generated_at_utc,
  "Režim: iba čítanie; archív a produkčné pravidlá sa nemenia.", "",
  "- Zápasy: **" + matches.size + "**",
  "- LIVE snímky: **" + totalSnapshots + "**",
  "- Snímky s čitateľnou minútou: **" + parsedSnapshotMinutes + "**",
  "- Gólové udalosti: **" + totalGoals + "**",
  "- Gólové udalosti s čitateľnou minútou: **" + parsedGoalTimes + "**",
  "- Zápasy s kandidátsky kompletnou časovou osou: **" + matchesWithCompleteGoalTimeline + "**",
  "- Zápasy so zhodou aspoň jednej LIVE snímky so skóre udalostí: **" + matchesWithScoreTimelineAgreement + "**", "",
  "## Kandidátske štítky gólu do 10 minút", "",
  "- Pozitívne: **" + labelCounts.positive + "**",
  "- Negatívne: **" + labelCounts.negative + "**",
  "- Nejednoznačné/vylúčené: **" + labelCounts.ambiguous + "**",
  "- Použiteľné kandidátske príklady: **" + allLabeled.length + "**",
  "- Podiel pozitívnych: **" + (report.ten_minute_labels.positive_rate_percent ?? "N/A") + " %**", "",
  "## Pokrytie štatistík v označených LIVE snímkach", "",
  ...Object.entries(featureCoverage).map(([k,v]) => "- " + k + ": **" + v + " / " + allLabeled.length + "**"), "",
  "## Časové rozdelenie po zápasoch", "",
  "- Tréning: **" + split.train_labeled_snapshots + "** snímok z " + split.proposed_train_matches + " zápasov",
  "- Test: **" + split.test_labeled_snapshots + "** snímok z " + split.proposed_test_matches + " zápasov",
  "- Hranica: " + (split.train_end_archived_at || "N/A") + " → " + (split.test_start_archived_at || "N/A"), "",
  "## Stav: " + report.readiness, "",
  "Výsledok nie je presnosť modelu. Pred tréningom treba skontrolovať reprezentatívne zápasy a potvrdiť časovanie udalostí.", ""
].join("\n");
fs.writeFileSync(path.join(OUT, "live-edge-temporal-audit.md"), summary);
console.log("LIVE EDGE TEMPORAL AUDIT", JSON.stringify({
  archive: report.archive, time_schema: report.time_schema,
  ten_minute_labels: report.ten_minute_labels, chronological_split: split,
  readiness: report.readiness
}, null, 2));

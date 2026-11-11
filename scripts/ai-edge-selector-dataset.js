"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const DEFAULT_DATA = path.resolve(__dirname, "..", "data");
const DEFAULT_OUT = path.resolve(process.cwd(), "audit-output");
const LAG_MINUTES = 5;
const HORIZONS = [15, 25];
const FEATURE_KEYS = [
  "xg_home", "xg_away",
  "shots_on_target_home", "shots_on_target_away",
  "total_shots_home", "total_shots_away",
  "corners_home", "corners_away",
  "possession_home", "possession_away",
  "big_chances_home", "big_chances_away",
  "xgot_home", "xgot_away",
  "saves_home", "saves_away",
  "yellow_cards_home", "yellow_cards_away",
  "red_cards_home", "red_cards_away"
];

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function parseJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function parseGzipJsonl(file) {
  const raw = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8").trim();
  return raw ? raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
}
function stageIsUsable(stage) {
  const value = String(stage || "").toLowerCase();
  return !/(half.?time|\bht\b|finished|full.?time|\bft\b|after penalties|penalty shootout|postponed|cancelled|abandoned)/i.test(value);
}
function scoreOf(row) {
  const h = finite(row?.score?.home);
  const a = finite(row?.score?.away);
  return h === null || a === null || h < 0 || a < 0 ? null : [h, a];
}
function scoreTotal(score) { return score[0] + score[1]; }
function outcomeFor(outcomes, matchId) {
  const id = String(matchId || "").replace(/^flashscore:/, "");
  return outcomes?.matches?.[id] || null;
}
function csvCell(value) {
  return '"' + String(value === null || value === undefined ? "" : value).replace(/"/g, '""') + '"';
}
function snapshotFeatures(row) {
  const out = {
    minute: finite(row.minute),
    home_score: finite(row.score?.home),
    away_score: finite(row.score?.away),
    score_difference: finite(row.score?.home) === null || finite(row.score?.away) === null
      ? null : finite(row.score.home) - finite(row.score.away),
    total_goals: finite(row.score?.home) === null || finite(row.score?.away) === null
      ? null : finite(row.score.home) + finite(row.score.away),
    stats_available: row.stats_available === true ? 1 : 0,
    stats_count: finite(row.stats_count) ?? 0
  };
  const features = row.features || {};
  for (const key of FEATURE_KEYS) out[key] = finite(features[key]);
  return out;
}
function transitionsFor(rows) {
  const transitions = [];
  for (let i = 1; i < rows.length; i++) {
    const before = rows[i - 1], after = rows[i];
    const a = scoreOf(before), b = scoreOf(after);
    if (!a || !b) continue;
    if (b[0] < a[0] || b[1] < a[1]) return { transitions: [], invalid: true };
    const goals = scoreTotal(b) - scoreTotal(a);
    if (goals > 0) {
      transitions.push({
        from_minute: finite(before.minute),
        to_minute: finite(after.minute),
        goals,
        home_goals: b[0] - a[0],
        away_goals: b[1] - a[1]
      });
    }
  }
  return { transitions, invalid: false };
}
function labelWindow(sample, rows, transitions, finalScore, horizon, lagMinutes = LAG_MINUTES) {
  const minute = finite(sample.minute);
  const sampleScore = scoreOf(sample);
  if (minute === null || !sampleScore) return { status: "invalid_sample" };
  const start = minute + lagMinutes;
  const end = start + horizon;

  // A goal in the unseen delay means the displayed state is already obsolete.
  for (const t of transitions) {
    if (t.from_minute < start && t.to_minute <= start && t.to_minute > minute) {
      return { status: "goal_during_delay" };
    }
    if (t.from_minute < start && t.to_minute > start) {
      return { status: "ambiguous_start_boundary" };
    }
    if (t.from_minute < end && t.to_minute > end) {
      return { status: "ambiguous_end_boundary" };
    }
  }

  const inWindow = transitions.filter(t =>
    t.from_minute >= start && t.to_minute <= end
  );
  const last = rows[rows.length - 1];
  const lastMinute = finite(last?.minute);
  const lastScore = scoreOf(last);
  const finalMatchesLast = lastScore && finalScore &&
    lastScore[0] === finalScore[0] && lastScore[1] === finalScore[1];
  const coveredToEnd = lastMinute !== null && lastMinute >= end;

  if (inWindow.length) {
    return {
      status: "labeled",
      label: 1,
      goals_in_window: inWindow.reduce((sum, t) => sum + t.goals, 0),
      horizon_start_minute: start,
      horizon_end_minute: end
    };
  }
  if (coveredToEnd || finalMatchesLast) {
    return {
      status: "labeled",
      label: 0,
      goals_in_window: 0,
      horizon_start_minute: start,
      horizon_end_minute: end
    };
  }
  return { status: "insufficient_future_coverage" };
}
function buildDataset(observations, outcomes, holdoutAfterUtc, options = {}) {
  const lag = Number.isFinite(options.lagMinutes) ? options.lagMinutes : LAG_MINUTES;
  const horizons = Array.isArray(options.horizons) ? options.horizons : HORIZONS;
  const grouped = new Map();
  const rejects = {};
  const reject = key => { rejects[key] = (rejects[key] || 0) + 1; };
  for (const row of observations) {
    if (!row || row.source !== "Flashscore" || !String(row.match_id || "").startsWith("flashscore:")) {
      reject("non_flashscore_or_invalid_match_id");
      continue;
    }
    const id = row.match_id;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(row);
  }

  const matchData = new Map();
  const rowsOut = [];
  for (const [matchId, rows] of grouped) {
    const outcome = outcomeFor(outcomes, matchId);
    if (!outcome || outcome.source !== "Flashscore" ||
        outcome.status !== "CONFIRMED" ||
        outcome.status_confirmation !== "confirmed_finished" ||
        outcome.final_status !== "FINISHED") {
      reject("match_without_confirmed_flashscore_finish");
      continue;
    }
    const statusText = String(outcome.final_match?.status_text || "");
    if (/penalt/i.test(statusText)) {
      reject("penalty_shootout_match");
      continue;
    }
    const finalHome = finite(outcome.home_score);
    const finalAway = finite(outcome.away_score);
    if (finalHome === null || finalAway === null) {
      reject("invalid_final_score");
      continue;
    }
    rows.sort((a, b) =>
      String(a.collected_at || "").localeCompare(String(b.collected_at || "")) ||
      (finite(a.minute) ?? 0) - (finite(b.minute) ?? 0)
    );
    const usable = rows.filter(r =>
      finite(r.minute) !== null && finite(r.minute) >= 1 &&
      finite(r.minute) <= 130 && stageIsUsable(r.stage) && scoreOf(r)
    );
    if (usable.length < 2) {
      reject("insufficient_match_snapshots");
      continue;
    }
    const transitionResult = transitionsFor(usable);
    if (transitionResult.invalid) {
      reject("score_regression_in_match");
      continue;
    }
    const transitions = transitionResult.transitions;
    const finalScore = [finalHome, finalAway];
    const lastScore = scoreOf(usable[usable.length - 1]);
    if (!lastScore || lastScore[0] > finalHome || lastScore[1] > finalAway) {
      reject("snapshot_score_exceeds_confirmed_final");
      continue;
    }
    const firstSeen = usable.reduce((min, r) => {
      const t = Date.parse(r.collected_at || "");
      return Number.isFinite(t) && (min === null || t < min) ? t : min;
    }, null);
    if (firstSeen === null) {
      reject("missing_first_observation_timestamp");
      continue;
    }
    const firstSeenIso = new Date(firstSeen).toISOString();
    const split = firstSeen <= Date.parse(holdoutAfterUtc) ? "train" : "test";
    matchData.set(matchId, { split, firstSeenIso });

    for (const sample of usable) {
      const sampleScore = scoreOf(sample);
      if (!sampleScore || sampleScore[0] > finalHome || sampleScore[1] > finalAway) continue;
      for (const horizon of horizons) {
        const label = labelWindow(sample, usable, transitions, finalScore, horizon, lag);
        if (label.status !== "labeled") {
          reject("h" + horizon + "_" + label.status);
          continue;
        }
        rowsOut.push({
          match_id: matchId,
          observation_id: sample.observation_id || null,
          source: "Flashscore",
          first_seen_at: firstSeenIso,
          collected_at: sample.collected_at,
          split,
          horizon_minutes: horizon,
          assumed_data_lag_minutes: lag,
          effective_minute_estimate: finite(sample.minute) + lag,
          home: sample.home || "",
          away: sample.away || "",
          competition: sample.competition || "",
          ...snapshotFeatures(sample),
          label_goal_within_horizon: label.label,
          goals_in_horizon: label.goals_in_window
        });
      }
    }
  }
  rowsOut.sort((a, b) =>
    a.first_seen_at.localeCompare(b.first_seen_at) ||
    a.match_id.localeCompare(b.match_id) ||
    a.minute - b.minute ||
    a.horizon_minutes - b.horizon_minutes
  );
  const uniqueMatches = [...matchData.entries()];
  const trainMatches = uniqueMatches.filter(([, v]) => v.split === "train").length;
  const testMatches = uniqueMatches.length - trainMatches;
  const summaries = {};
  for (const horizon of horizons) {
    const subset = rowsOut.filter(r => r.horizon_minutes === horizon);
    const positives = subset.filter(r => r.label_goal_within_horizon === 1).length;
    summaries[horizon] = {
      observations: subset.length,
      unique_matches: new Set(subset.map(r => r.match_id)).size,
      train_observations: subset.filter(r => r.split === "train").length,
      test_observations: subset.filter(r => r.split === "test").length,
      positive: positives,
      negative: subset.length - positives,
      positive_rate_pct: subset.length ? Number((100 * positives / subset.length).toFixed(2)) : null
    };
  }
  return {
    rows: rowsOut,
    report: {
      generated_at_utc: new Date().toISOString(),
      dataset_version: "flashscore-delay-aware-goal-horizon-v1",
      source: "Flashscore",
      read_only: true,
      model_status: "DATASET_ONLY_NOT_TRAINED",
      training_ready: false,
      assumed_data_lag_minutes: lag,
      horizons_minutes: horizons,
      holdout_after_utc: holdoutAfterUtc,
      split_rule: "All observations from a match remain in one split. First archived observation at or before the frozen cutoff is train; later matches are forward test.",
      matches: {
        confirmed_unique_matches_used: uniqueMatches.length,
        train_matches: trainMatches,
        test_matches: testMatches
      },
      horizon_summaries: summaries,
      exclusions: rejects,
      safeguards: [
        "Flashscore-only rows and explicitly confirmed Flashscore full-time outcomes are required.",
        "The assumed five-minute delay is applied to the prediction horizon; goals during the unseen delay are excluded.",
        "Score-change intervals crossing either horizon boundary are excluded as ambiguous.",
        "Final score is used only to confirm labels and future coverage, never as a feature.",
        "No bookmaker odds, ROI, or profitability claims are inferred.",
        "This is a shadow dataset; it does not create or modify production signals."
      ],
      limitations: [
        "The five-minute delay is an operating assumption, not a measured per-match source-latency value.",
        "Score changes are bounded by two snapshots; exact goal timestamps are not inferred.",
        "A positive label requires a score change wholly inside the target window; ambiguous boundary cases are discarded."
      ]
    }
  };
}
function main(args = process.argv.slice(2)) {
  const arg = name => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const dataDir = path.resolve(arg("--data-dir") || DEFAULT_DATA);
  const outDir = path.resolve(arg("--output-dir") || DEFAULT_OUT);
  const observationsPath = path.join(dataDir, "flashscore-live-observations.jsonl.gz");
  const statusPath = path.join(dataDir, "flashscore-live-observations-status.json");
  const outcomesPath = path.join(dataDir, "flashscore-confirmed-outcomes.json");
  const holdoutPath = path.join(dataDir, "match-intelligence-holdout.json");
  for (const file of [observationsPath, statusPath, outcomesPath, holdoutPath]) {
    if (!fs.existsSync(file)) throw new Error("Required Flashscore input missing: " + file);
  }
  const status = parseJson(statusPath);
  const outcomes = parseJson(outcomesPath);
  const holdout = parseJson(holdoutPath);
  if (status.source !== "Flashscore" || status.dataset_version !== "flashscore-observations-v1") {
    throw new Error("Observation status is not the expected Flashscore-only dataset.");
  }
  if (outcomes.source !== "Flashscore" || !outcomes.matches || typeof outcomes.matches !== "object") {
    throw new Error("Confirmed outcomes archive is not Flashscore-only.");
  }
  const cutoff = String(holdout.holdout_after_utc || "");
  if (!Number.isFinite(Date.parse(cutoff))) throw new Error("Frozen forward holdout cutoff is invalid.");
  const observations = parseGzipJsonl(observationsPath);
  const built = buildDataset(observations, outcomes, cutoff);
  fs.mkdirSync(outDir, { recursive: true });
  const columns = Object.keys(built.rows[0] || {
    match_id: "", horizon_minutes: "", minute: "", label_goal_within_horizon: ""
  });
  fs.writeFileSync(path.join(outDir, "ai-edge-selector-dataset.json"),
    JSON.stringify({ report: built.report, rows: built.rows }, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "ai-edge-selector-dataset.csv"),
    [columns.join(","), ...built.rows.map(row => columns.map(key => csvCell(row[key])).join(","))].join("\n") + "\n");
  const reportLines = [
    "# AI EDGE SELECTOR – Flashscore delay-aware dataset audit", "",
    "Generated UTC: " + built.report.generated_at_utc,
    "Source: Flashscore only",
    "Assumed data delay: " + LAG_MINUTES + " minutes",
    "Forward holdout cutoff: " + cutoff,
    "",
    "- Confirmed unique matches: **" + built.report.matches.confirmed_unique_matches_used + "**",
    "- Train/test matches: **" + built.report.matches.train_matches + " / " + built.report.matches.test_matches + "**",
    ...Object.entries(built.report.horizon_summaries).map(([h, s]) =>
      "- " + h + "-minute horizon: **" + s.observations + " observations**, **" + s.unique_matches +
      " matches**, positive rate **" + (s.positive_rate_pct === null ? "n/a" : s.positive_rate_pct + "%") + "**"
    ),
    "",
    "**Status: dataset only; no model trained, no probability or profitability claim.**",
    "",
    "## Exclusions",
    ...Object.entries(built.report.exclusions).map(([key, value]) => "- " + key + ": **" + value + "**"),
    "",
    "## Limitations",
    ...built.report.limitations.map(item => "- " + item),
    ""
  ];
  fs.writeFileSync(path.join(outDir, "ai-edge-selector-report.md"), reportLines.join("\n"));
  console.log("AI EDGE SELECTOR DATASET:", JSON.stringify(built.report, null, 2));
}
if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error("AI EDGE SELECTOR DATASET FAILED:", error.message);
    process.exit(1);
  }
}
module.exports = { finite, stageIsUsable, scoreOf, transitionsFor, labelWindow, buildDataset };

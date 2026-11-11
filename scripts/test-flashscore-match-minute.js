"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "..", "scanner.js"), "utf8");
const start = source.indexOf("const minuteOf = snapshot => {");
assert.notEqual(start, -1, "minuteOf parser must exist in scanner.js");
const end = source.indexOf("\n    };", start);
assert.notEqual(end, -1, "minuteOf parser must be closed");
const expression = source.slice(start + "const minuteOf = ".length, end + 6).trim();
const minuteOf = vm.runInNewContext("const minuteOf = " + expression + "; minuteOf");

const cases = [
  [{ live_minute: 49 }, 49],
  [{ live_minute: "49′" }, 49],
  [{ live_clock: "49:23" }, 49],
  [{ live_clock: "45+2′" }, 47],
  [{ live_clock: "HT" }, null],
  [{ minute: "45:00" }, 45],
  [{ live_minute: "45+2" }, 47],
  [{ live_minute: "45+2′" }, 47],
  [{ live_minute: "90+4" }, 94],
  [{ live_minute: 120 }, 120],
  [{ live_minute: "HT" }, null],
  [{ live_minute: "FT" }, null],
  [{ live_minute: "2nd Half" }, null],
  [{ live_minute: "LIVE" }, null],
  [{ live_minute: "45+99" }, null],
  [{ live_minute: 0 }, 0]
];
for (const [snapshot, expected] of cases) {
  assert.equal(minuteOf(snapshot), expected, JSON.stringify(snapshot));
}
const pairStart = source.indexOf("const activityIntervalForPair = (");
assert.notEqual(pairStart, -1, "activity interval attribution helper must exist");
const pairEnd = source.indexOf("\n    };", pairStart);
assert.notEqual(pairEnd, -1, "activity interval attribution helper must be closed");
const pairExpression = source.slice(pairStart + "const activityIntervalForPair = ".length, pairEnd + 6).trim();
const activityIntervalForPair = vm.runInNewContext("const activityIntervalForPair = " + pairExpression + "; activityIntervalForPair");

const definitions = [
  { start: 1, end: 15, label: "01–15′" },
  { start: 16, end: 30, label: "16–30′" },
  { start: 31, end: 45, label: "31–45′" },
  { start: 46, end: 60, label: "46–60′" },
  { start: 61, end: 75, label: "61–75′" },
  { start: 76, end: 90, label: "76–90′" },
  { start: 91, end: 120, label: "90+′" }
];
assert.equal(activityIntervalForPair(0, 2, definitions).interval.label, "01–15′");
assert.equal(activityIntervalForPair(0, 16, definitions).reason, "crosses-interval-boundary");
assert.equal(activityIntervalForPair(12, 15, definitions).interval.label, "01–15′");
assert.equal(activityIntervalForPair(14, 15, definitions).interval.label, "01–15′");
assert.equal(activityIntervalForPair(15, 16, definitions).reason, "crosses-interval-boundary");
assert.equal(activityIntervalForPair(30, 31, definitions).reason, "crosses-interval-boundary");
assert.equal(activityIntervalForPair(46, 49, definitions).interval.label, "46–60′");
assert.equal(activityIntervalForPair(null, 47, definitions).reason, "unknown-start-minute");
assert.equal(activityIntervalForPair(45, null, definitions).reason, "unknown-current-minute");


const analysisStart = source.indexOf("const analyzeScoreChanges = (");
assert.notEqual(analysisStart, -1, "score-change diagnostics helper must exist");
const analysisEnd = source.indexOf("\n    };", analysisStart);
assert.notEqual(analysisEnd, -1, "score-change diagnostics helper must be closed");
const analysisExpression = source.slice(analysisStart + "const analyzeScoreChanges = ".length, analysisEnd + 6).trim();
const analyzeScoreChanges = vm.runInNewContext("const analyzeScoreChanges = " + analysisExpression + "; analyzeScoreChanges");
const deriveScoreChanges = (rows, officialEvents = []) => analyzeScoreChanges(rows, officialEvents).events;
const snapshots = [
  { time: 1000, match: { home_score: 1, away_score: 1, live_minute: "43′", home: "Home", away: "Away" } },
  { time: 2000, match: { home_score: 3, away_score: 1, live_minute: "55′", home: "Home", away: "Away" } }
];
const inferred = deriveScoreChanges(snapshots);
assert.equal(inferred.length, 1);
assert.equal(inferred[0].minute, "medzi 43′–55′");
assert.equal(inferred[0].detail, "Home · +2 · skóre 1:1 → 3:1");
assert.equal(inferred[0].derived, true);
assert.equal(deriveScoreChanges([snapshots[0], { time: 2000, match: { home_score: 1, away_score: 1, live_minute: "55′" } }]).length, 0,
  "unchanged score must not create a goal");
assert.equal(deriveScoreChanges([snapshots[0], { time: 2000, match: { home_score: 0, away_score: 1, live_minute: "55′" } }]).length, 0,
  "score reversals must not create a goal");
assert.equal(deriveScoreChanges(snapshots, [{ kind: "⚽ Gól", minute: "50′" }]).length, 0,
  "an official goal in the same interval must suppress a duplicate inferred goal");
const noMinute = deriveScoreChanges([
  { time: Date.parse("2026-11-11T12:46:00"), match: { home_score: 1, away_score: 1 } },
  { time: Date.parse("2026-11-11T13:14:00"), match: { home_score: 2, away_score: 1 } }
]);
assert.match(noMinute[0].minute, /12:46–13:14/, "missing match minute must use observation-time range");


const threeGoals = analyzeScoreChanges([
  { time: 1000, match: { home_score: 0, away_score: 0, live_minute: "27′" } },
  { time: 2000, match: { home_score: 0, away_score: 1, live_minute: "39′" } },
  { time: 3000, match: { home_score: 1, away_score: 1, live_minute: "HT" } },
  { time: 4000, match: { home_score: 1, away_score: 2, live_minute: "56′" } }
]);
assert.equal(threeGoals.scoreChanges, 3);
assert.equal(threeGoals.events.length, 3);
assert.equal(threeGoals.suppressedDuplicates, 0);
assert.equal(threeGoals.unclassifiedChanges, 0);
const suppressed = analyzeScoreChanges(snapshots, [{ kind: "⚽ Gól", minute: "50′" }]);
assert.equal(suppressed.suppressedDuplicates, 1);
assert.equal(suppressed.events.length, 0);
const unclassified = analyzeScoreChanges([
  { time: 2000, match: { home_score: 0, away_score: 0, live_minute: "55′" } },
  { time: 1000, match: { home_score: 1, away_score: 0, live_minute: "56′" } }
]);
assert.equal(unclassified.unclassifiedChanges, 1);

const repeatedTransition = analyzeScoreChanges([
  { time: 1000, match: { home_score: 0, away_score: 0, live_minute: "10′" } },
  { time: 2000, match: { home_score: 1, away_score: 0, live_minute: "12′" } },
  { time: 3000, match: { home_score: 2, away_score: 0, live_minute: "20′" } },
  { time: 4000, match: { home_score: 1, away_score: 0, live_minute: "22′" } },
  { time: 5000, match: { home_score: 2, away_score: 0, live_minute: "24′" } },
  { time: 6000, match: { home_score: 3, away_score: 0, live_minute: "26′" } }
]);
assert.equal(repeatedTransition.events.length, 3, "a repeated score transition after a stale score rollback must not create a duplicate goal");
assert.equal(repeatedTransition.suppressedDuplicates, 1, "repeated score transitions must be counted as suppressed duplicates");
assert.equal(repeatedTransition.events.map(event => event.detail).join("|"), [
  "Domáci · +1 · skóre 0:0 → 1:0",
  "Domáci · +1 · skóre 1:0 → 2:0",
  "Domáci · +1 · skóre 2:0 → 3:0"
].join("|"));


const momentumClassifyStart = source.indexOf("const classifyMomentumActivity = (");
assert.notEqual(momentumClassifyStart, -1, "momentum activity interpretation helper must exist");
const momentumClassifyEnd = source.indexOf("\n  };", momentumClassifyStart);
assert.notEqual(momentumClassifyEnd, -1, "momentum activity interpretation helper must be closed");
const momentumClassifyExpression = source.slice(momentumClassifyStart + "const classifyMomentumActivity = ".length, momentumClassifyEnd + 5).trim();
const classifyMomentumActivity = vm.runInNewContext("const classifyMomentumActivity = " + momentumClassifyExpression + "; classifyMomentumActivity");
const stoppedMomentum = classifyMomentumActivity({ home: 79, away: 21 }, { homeRate: 0, awayRate: 0 }, { homeState: "SPOMAĽUJE", awayState: "STABILNÉ" });
assert.equal(stoppedMomentum.dominance, "DOMÁCI");
assert.equal(stoppedMomentum.current, "BEZ NOVEJ SLEDOVANEJ AKTIVITY");
assert.equal(stoppedMomentum.noActivity, true);
assert.equal(stoppedMomentum.lowSample, false);
const oneEventMomentum = classifyMomentumActivity({ home: 99, away: 1 }, { homeRate: 4.9, awayRate: 0, used: [{ key: "off", home: 1, away: 0 }] }, null);
assert.equal(oneEventMomentum.lowSample, true);
assert.equal(oneEventMomentum.sampleCount, 1);
const threeEventMomentum = classifyMomentumActivity({ home: 90, away: 10 }, { homeRate: 8, awayRate: 0, used: [{ key: "off", home: 3, away: 0 }] }, null);
assert.equal(threeEventMomentum.lowSample, false);
assert.ok(source.includes("MALÁ VZORKA"), "small activity samples must be explicitly qualified in the UI");
assert.ok(source.includes("POSLEDNÉ HISTORICKÉ MERANIE"), "zero-activity chart must label its last point as historical");
assert.ok(source.includes("Historické rozdelenie momenta z posledného platného merania – nejde o aktuálny tlak."), "zero-activity chart must explain the historical ratio");
assert.ok(source.includes('"Historické merania momenta":"Merania momenta z platných intervalov"'), "chart range must distinguish historical momentum from active intervals");
assert.ok(source.includes("pomer tlaku sa nezobrazuje."), "zero activity must not display a stale pressure ratio");
assert.match(stoppedMomentum.development, /SPOMAĽUJE/);
const activeMomentum = classifyMomentumActivity({ home: 45, away: 55 }, { homeRate: 2.5, awayRate: 0.5 }, null);
assert.equal(activeMomentum.dominance, "HOSTIA");
assert.equal(activeMomentum.current, "DOMÁCI");
assert.equal(activeMomentum.noActivity, false);
const waitingMomentum = classifyMomentumActivity(null, null, null);
assert.equal(waitingMomentum.current, "ČAKÁM NA PLATNÝ INTERVAL");

const coverageStart = source.indexOf("const reconcileActivityCoverage = (");
assert.notEqual(coverageStart, -1, "activity coverage reconciliation helper must exist");
const coverageEnd = source.indexOf("\n    });", coverageStart);
assert.notEqual(coverageEnd, -1, "activity coverage reconciliation helper must be closed");
const coverageExpression = source.slice(coverageStart + "const reconcileActivityCoverage = ".length, coverageEnd + 7).trim();
const reconcileActivityCoverage = vm.runInNewContext("const reconcileActivityCoverage = " + coverageExpression + "; reconcileActivityCoverage");
const coverageDefinitions = [
  { key: "shots", label: "Strely" },
  { key: "sot", label: "Na bránu" },
  { key: "corners", label: "Rohy" }
];
const coverageRows = [
  { match: { stats: { shots: { home: 0, away: 0 }, sot: { home: 0, away: 0 }, corners: { home: 0, away: 0 } } } },
  { match: { stats: { shots: { home: 8, away: 2 }, sot: { home: 5, away: 1 }, corners: { home: 3, away: 1 } } } }
];
const coverageBins = [{ values: {
  shots: { home: 7, away: 1 },
  sot: { home: 4, away: 0 },
  corners: { home: 3, away: 1 }
} }];
const coverageResult = reconcileActivityCoverage(coverageRows, coverageBins, coverageDefinitions, (match, definition) => match.stats[definition.key] || null);
assert.deepEqual(JSON.parse(JSON.stringify(coverageResult[0].unassigned)), { home: 1, away: 1 });
assert.deepEqual(JSON.parse(JSON.stringify(coverageResult[0].coverage)), { home: 88, away: 50 });
assert.deepEqual(JSON.parse(JSON.stringify(coverageResult[1].unassigned)), { home: 1, away: 1 });
assert.deepEqual(JSON.parse(JSON.stringify(coverageResult[2].unassigned)), { home: 0, away: 0 });
assert.equal(coverageResult[2].coverage.home, 100);
const skippedPairSamples = [
  { key: "shots", label: "Strely", reason: "crosses-interval-boundary", delta: { home: 0, away: 2 }, fromMinute: 30, toMinute: 31, fromAt: "14:00", toAt: "14:02", gap: 2 },
  { key: "sot", label: "Na bránu", reason: "crosses-interval-boundary", delta: { home: 0, away: 1 }, fromMinute: 30, toMinute: 31, fromAt: "14:00", toAt: "14:02", gap: 2 },
  { key: "shots", label: "Strely", reason: "gap-over-7", delta: { home: 1, away: 0 }, fromMinute: 43, toMinute: 50, fromAt: "14:10", toAt: "14:18", gap: 8 }
];
const skippedMetricNotes = [
  { key: "shots", label: "Strely", reason: "missing-metric-value", fromMinute: 31, toMinute: 34, fromAt: "14:02", toAt: "14:05", gap: 3 },
  { key: "sot", label: "Na bránu", reason: "reset-metric-value", fromMinute: 46, toMinute: 49, fromAt: "14:17", toAt: "14:20", gap: 3 }
];
const tracedCoverage = reconcileActivityCoverage(coverageRows, coverageBins, coverageDefinitions, (match, definition) => match.stats[definition.key] || null, skippedPairSamples, skippedMetricNotes);
assert.equal(tracedCoverage[0].causes.length, 3, "coverage should retain skipped-pair causes and unquantified metric notes");
assert.equal(tracedCoverage[0].causes.find(item => item.reason === "crosses-interval-boundary").away, 2);
assert.equal(tracedCoverage[0].causes.find(item => item.reason === "gap-over-7").home, 1);
assert.equal(tracedCoverage[0].causes[0].samples[0].fromMinute, 30);
assert.equal(tracedCoverage[0].causes.find(item => item.reason === "missing-metric-value").count, 1);
assert.equal(tracedCoverage[0].causes.find(item => item.reason === "missing-metric-value").unquantified, true);
assert.equal(tracedCoverage[0].causes.find(item => item.reason === "missing-metric-value").samples[0].fromMinute, 31);
assert.equal(tracedCoverage[1].causes.find(item => item.reason === "reset-metric-value").count, 1);
assert.equal(tracedCoverage[1].causes[0].delta, undefined, "cause aggregation must expose totals and samples, not fake exact attribution");
const overCaptured = reconcileActivityCoverage(coverageRows, [{ values: { shots: { home: 9, away: 2 } } }], [coverageDefinitions[0]], (match, definition) => match.stats[definition.key] || null);
assert.equal(overCaptured[0].status, "over-captured", "captured increments above cumulative total must be flagged");
const missingCoverage = reconcileActivityCoverage(coverageRows, [], [coverageDefinitions[0]], () => null);
assert.equal(missingCoverage[0].status, "missing", "missing endpoint stats must not produce a coverage percentage");

assert.match(source, /Vážený index: strely na bránu × 3 \+ strely mimo bránu, prepočítané na 10 minút/);
assert.match(source, /Platné intervaly v celej načítanej histórii/);
assert.match(source, /najviac 10 posledných platných intervalov z posledných 45 minút/);
console.log("Flashscore match-minute clock, activity-bin, score-change and activity-coverage diagnostics tests passed.");

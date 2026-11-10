"use strict";
const assert = require("node:assert/strict");
const { classify, buildEvaluation } = require("./flashscore-btts-archive-evaluation");

const qualifyingSnapshot = {
  live_minute:76, stage:"2nd Half", home_score:1, away_score:0,
  stats:[
    {name:"Shots on target",period:"Match",home:3,away:2},
    {name:"Total shots",period:"Match",home:7,away:5}
  ],
  collected_at:"2026-11-10T12:00:00.000Z"
};
assert.equal(classify(qualifyingSnapshot).tierKey,"10_sot5_shots12");
assert.equal(classify({...qualifyingSnapshot,live_minute:70}),null);
assert.equal(classify({...qualifyingSnapshot,stage:"1st Half"}),null);

const signals = [
  {model:"BTTS",source:"Flashscore",matchId:"early",startMinute:48,startScore:"1:0",tierKey:"test",combinedSot:5,combinedShots:10,createdAt:"2026-11-10T11:00:00.000Z"},
  {model:"BTTS",source:"Flashscore",matchId:"late",startMinute:50,startScore:"0:1",tierKey:"test",combinedSot:6,combinedShots:10,createdAt:"2026-11-10T11:05:00.000Z"},
  {model:"BTTS",source:"Flashscore",matchId:"loss",startMinute:47,startScore:"0:1",tierKey:"test",createdAt:"2026-11-10T11:10:00.000Z"},
  {model:"BTTS",source:"Flashscore",matchId:"too-early",startMinute:45}
];
const timelineRecords = [
  {match_id:"early",snapshot:{live_minute:65,home_score:1,away_score:1,collected_at:"2026-11-10T11:04:00.000Z"}},
  {match_id:"late",snapshot:{live_minute:76,home_score:1,away_score:1,collected_at:"2026-11-10T11:08:00.000Z"}},
  {match_id:"loss",snapshot:{live_minute:78,home_score:0,away_score:1,collected_at:"2026-11-10T11:15:00.000Z"}}
];
const built=buildEvaluation({
  index:{source:"Flashscore",weeks:[]},
  outcomes:{matches:{
    early:{status:"CONFIRMED",home_score:2,away_score:1},
    late:{status:"CONFIRMED",home_score:1,away_score:2},
    loss:{status:"CONFIRMED",home_score:0,away_score:2}
  }},
  bttsArchive:{source:"Flashscore",signals,after70_analysis:{sample:999}},
  timelineRecords,
  now:"2026-11-10T13:00:00.000Z"
});
const retrospective=built.captured_signals_after70_analysis;
assert.equal(Object.hasOwn(built,"after70_analysis"),false);
assert.equal(retrospective.schema_version,3);
assert.equal(retrospective.ready,true);
assert.equal(retrospective.captured_signal_count,3);
assert.equal(retrospective.completed_by_70_count,1);
assert.equal(retrospective.completed_after_70_count,1);
assert.equal(retrospective.not_completed_count,1);
assert.equal(retrospective.wins,2);
assert.equal(retrospective.losses,1);
assert.equal(retrospective.win_rate,2/3);

const early=retrospective.entries.find(x=>x.matchId==="early");
assert.equal(early.completionStatus,"COMPLETED_BY_70");
assert.equal(early.bttsCompletedMinute,65);
const late=retrospective.entries.find(x=>x.matchId==="late");
assert.equal(late.completionStatus,"COMPLETED_AFTER_70");
assert.equal(late.bttsCompletedMinute,76);
assert.equal(late.status,"WIN");
const loss=retrospective.entries.find(x=>x.matchId==="loss");
assert.equal(loss.completionStatus,"NOT_COMPLETED");
assert.equal(loss.status,"LOSS");

console.log("Flashscore captured BTTS completion-time retrospective tests passed.");

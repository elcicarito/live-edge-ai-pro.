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
assert.equal(classify({...qualifyingSnapshot,stats:[{name:"Shots on target",home:3,away:2}]}),null);

const signals = [
  {model:"BTTS",source:"Flashscore",matchId:"qualified-1",startMinute:48,startScore:"1:0",tierKey:"10_sot5_shots8",tier:"1:0 · SOT ≥5 · strely ≥8",combinedSot:5,combinedShots:10,createdAt:"2026-11-10T11:00:00.000Z"},
  {model:"BTTS",source:"Flashscore",matchId:"mijas-1",startMinute:50,startScore:"0:1",tierKey:"01_sot6_shots8",tier:"0:1 · SOT ≥6 · strely ≥8",combinedSot:6,combinedShots:10,createdAt:"2026-11-10T11:05:00.000Z"},
  {model:"BTTS",source:"Flashscore",matchId:"no-post70-1",startMinute:47,startScore:"0:1",tierKey:"01_sot6_shots8",createdAt:"2026-11-10T11:10:00.000Z"},
  {model:"BTTS",source:"Flashscore",matchId:"too-early-1",startMinute:45,tierKey:"01_sot6_shots8"}
];
const timelineRecords = [
  {match_id:"qualified-1",home:"Home A",away:"Away A",competition:"Test League",snapshot:qualifyingSnapshot},
  {match_id:"mijas-1",home:"Mijas Las Lagunas",away:"Jaen",competition:"Copa del Rey",snapshot:{
    live_minute:76,stage:"2nd Half",home_score:0,away_score:1,
    stats:[
      {name:"Shots on target",period:"Match",home:3,away:2},
      {name:"Total shots",period:"Match",home:4,away:3}
    ],
    collected_at:"2026-11-10T12:05:00.000Z"
  }}
];
const built=buildEvaluation({
  index:{source:"Flashscore",weeks:[]},
  outcomes:{matches:{
    "qualified-1":{status:"CONFIRMED",home_score:1,away_score:1},
    "mijas-1":{status:"CONFIRMED",home_score:1,away_score:2},
    "no-post70-1":{status:"CONFIRMED",home_score:0,away_score:2}
  }},
  bttsArchive:{source:"Flashscore",signals,after70_analysis:{sample:999,entries:[{matchId:"old-unrelated"}]}},
  timelineRecords,
  now:"2026-11-10T13:00:00.000Z"
});
const retrospective=built.captured_signals_after70_analysis;
assert.equal(Object.hasOwn(built,"after70_analysis"),false);
assert.equal(retrospective.schema_version,2);
assert.equal(retrospective.ready,true);
assert.equal(retrospective.captured_signal_count,3);
assert.equal(retrospective.sample,3);
assert.equal(retrospective.qualifying_match_count,1);
assert.equal(retrospective.not_qualifying_match_count,1);
assert.equal(retrospective.no_post70_data_match_count,1);
assert.equal(retrospective.wins,2);
assert.equal(retrospective.losses,1);
assert.equal(retrospective.win_rate,2/3);
assert.equal(retrospective.qualified_sample,1);
assert.equal(retrospective.qualified_wins,1);
assert.equal(retrospective.qualified_win_rate,1);

const mijas=retrospective.entries.find(row=>row.matchId==="mijas-1");
assert.ok(mijas);
assert.equal(mijas.after70Status,"NOT_QUALIFIED");
assert.equal(mijas.status,"WIN");
assert.equal(mijas.finalScore,"1:2");
assert.equal(mijas.signalStartMinute,50);
assert.equal(mijas.post70Minute,null);

const noData=retrospective.entries.find(row=>row.matchId==="no-post70-1");
assert.equal(noData.after70Status,"NO_POST70_DATA");
assert.equal(noData.status,"LOSS");

console.log("Flashscore captured BTTS retrospective tests passed.");

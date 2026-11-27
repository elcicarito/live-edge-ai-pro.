"use strict";
const assert=require("node:assert/strict");
const trainer=require("./ai-edge-ft-early-shadow-trainer");
const stat=(label,h,a)=>({label,home_numeric:h,away_numeric:a,period:"match"});
const snapshots=[
 [44,0,0,4,2],[46,0,0,5,2],[51,0,0,6,3],[56,0,0,7,3],[61,1,0,8,4],[66,1,0,9,4],[90,1,0,9,4]
].map(([minute,home,away,sotH,sotA],i)=>({match_id:"flashscore:test-early-1",snapshot:{
 collected_at:new Date(Date.UTC(2026,0,1,12,minute)).toISOString(),live_minute:minute,
 home_score:home,away_score:away,stage:minute===90?"Finished":"LIVE",
 stats:[stat("Shots on target",sotH,sotA),stat("Total shots",sotH+4,sotA+3),stat("Corner kicks",2,1),stat("Ball possession",55,45)]
}}));
const outcomes={matches:{"test-early-1":{source:"Flashscore",status:"CONFIRMED",status_confirmation:"confirmed_finished",final_status:"FINISHED",final_match:{status_text:"Finished"}}}};
const samples=trainer.buildSamples(snapshots,outcomes,Date.UTC(2025,0,1));
assert.ok(samples.length>=2,"should produce at least two five-minute bucket samples");
for(const row of samples){assert.equal(row.x.length,37,"FT EARLY vector must match late FT's 37 features");assert.equal(row.x[22],1,"early time band must be fixed to the first band");assert.deepEqual(row.x.slice(23,26),[0,0,0]);assert.equal(row.y,1,"goal after the five-minute lag must be positive");}

const {addPredictions,minimumOddsSimulationSummary,buildStrategyDataset}=require("./ai-edge-live-prediction-ledger");
const now=Date.parse("2026-11-26T18:00:00Z");
const liveStats=[stat("Shots on target",5,2),stat("Total shots",12,7),stat("Corner kicks",4,2),stat("Ball possession",55,45)];
const currentMatch={id:"fixture-early-live",source:"Flashscore",status:"live",home:"Home",away:"Away",competition:"Test league",live_minute:50,home_score:1,away_score:0,stats_collected_at:new Date(now).toISOString(),stats:liveStats};
const previous={time:now-5*60000,match:{...currentMatch,live_minute:45,collected_at:new Date(now-5*60000).toISOString(),stats:liveStats}};
const liveFeed={source:"Flashscore",collected_at:new Date(now).toISOString(),recent_history:[previous],records:[{collected_at:new Date(now).toISOString(),match:currentMatch}]};
const shadowModel={source:"Flashscore",mode:"HISTORICAL_AUDIT_LOCKED_FT_EARLY_45_55",status:"SHADOW_VALIDATED",updated_at:new Date(now).toISOString(),model:{status:"NOT_VALIDATED",weights:Array(38).fill(0),counts:{train:600,validation:320,train_matches:120,validation_matches:60},metrics:{calibration:{bins:[{range:"50-60",matches_weight:10,absolute_error:0.02}]}}}};
const predictions=[];
addPredictions(predictions,liveFeed,now,null,null,shadowModel);
const early=predictions.find(x=>x.target==="FT_EARLY_45_55");
assert.ok(early,"FT EARLY prediction should enter the prediction ledger");
assert.equal(early.actionableAfterMinute,55);
assert.equal(early.deadlineMinute,120,"FT EARLY must remain open until regular-time full-time");
assert.equal(early.modelStatus,"SHADOW_VALIDATED","historically validated early model must be directly tracked");
assert.equal(early.separateTracking,true);
assert.equal(early.modelFairOdds,2,"fair odds must be reciprocal of the model probability");
assert.equal(early.modelMinimumOdds,2.19,"minimum odds must include calibration error and safety margin");

const roiRows=[
 {target:"FT_EARLY_45_55",matchId:"roi-hit",createdAt:"2026-11-25T18:00:00Z",status:"HIT",modelProbability:0.7,modelMinimumOdds:2.2,simulationMinimumOdds:2.2},
 {target:"FT_EARLY_45_55",matchId:"roi-miss",createdAt:"2026-11-25T19:00:00Z",status:"MISS",modelProbability:0.65,modelMinimumOdds:1.9,simulationMinimumOdds:1.9}
];
const earlyRoi=minimumOddsSimulationSummary(roiRows,"FT_EARLY_45_55");
assert.equal(earlyRoi.decided,2,"FT EARLY ROI must include settled predictions");
assert.equal(earlyRoi.net_profit,0.2,"FT EARLY ROI must use each prediction's locked minimum odds");
assert.equal(earlyRoi.roi,10,"FT EARLY ROI must be expressed against total 1-unit stakes");
assert.equal(buildStrategyDataset(roiRows).length,2,"FT EARLY settled rows must enter strategy simulation dataset");

console.log("FT EARLY 45-55 tests passed:",samples.length,"samples, live candidate generation and individual-minimum-odds ROI");

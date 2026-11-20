"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),zlib=require("node:zlib");
const {addPredictions,evaluate,buildLedger,modelCalibrationGate,minimumOddsThreshold,buildStrategyDataset,simulateStrategy}=require("./ai-edge-live-prediction-ledger");
const now=Date.parse("2026-11-12T20:00:00Z");
const stats=[
 {label:"Shots on target",home:5,away:2},
 {label:"Total shots",home:12,away:7},
 {label:"Shots off target",home:7,away:5},
 {label:"Corner kicks",home:6,away:2},
 {label:"Big chances",home:2,away:1},
 {label:"Expected goals (xG)",home:1.4,away:0.7},
 {label:"Ball possession",home:58,away:42}
];
const match={id:"fixture-1",source:"Flashscore",status:"live",home:"Home",away:"Away",competition:"Test league",live_minute:50,home_score:1,away_score:0,stats_collected_at:new Date(now).toISOString(),stats};
const feed={source:"Flashscore",collected_at:new Date(now).toISOString(),records:[{collected_at:new Date(now).toISOString(),match}],recent_history:[]};
const rows=[];
addPredictions(rows,feed,now);
assert(rows.some(p=>p.target===15),"15-minute prediction created");
assert(rows.some(p=>p.target===25),"25-minute prediction created");
assert(rows.some(p=>p.target==="FT"),"FT prediction created");
assert(rows.some(p=>p.target==="NEXT_TEAM"),"next-team prediction created");
assert(rows.some(p=>p.target==="BTTS"),"BTTS prediction created");
const validatedModel={
 source:"Flashscore",mode:"FORWARD_ONLY_LIVE_TRAINING",
 validation_policy:{min_train_matches:100,min_validation_matches:50,min_relative_log_loss_gain:0.01,min_relative_brier_gain:0.005},
 models:{"15":{status:"SHADOW_VALIDATED",counts:{train_matches:120,validation_matches:58},metrics:{relative_log_loss_gain:0.0109,relative_brier_gain:0.0154,calibration:{bins:[{range:"50-60",matches_weight:12,absolute_error:0.02}]}},weights:Array(17).fill(0)},"25":{
  status:"SHADOW_VALIDATED",
  counts:{train_matches:120,validation_matches:58},
  metrics:{relative_log_loss_gain:0.0197,relative_brier_gain:0.025,calibration:{bins:[{range:"50-60",matches_weight:12,absolute_error:0.02}]}},
  weights:Array(17).fill(0)
 }}
};
const modelRows=[];
addPredictions(modelRows,feed,now,validatedModel);
assert.equal(modelCalibrationGate({metrics:{calibration:{bins:[{range:"50-60",matches_weight:4,absolute_error:0.01}]}}},0.55,{}).allowed,false,"low-support bins force abstention");
assert.equal(modelCalibrationGate({metrics:{calibration:{bins:[{range:"50-60",matches_weight:12,absolute_error:0.12}]}}},0.55,{}).allowed,false,"poor calibration forces abstention");
assert.equal(modelCalibrationGate({metrics:{calibration:{bins:[{range:"50-60",matches_weight:12,absolute_error:0.02}]}}},0.55,{}).allowed,true,"reliable bins allow prediction");
assert.equal(minimumOddsThreshold(0.55,0.02,0.05),1.99,"minimum odds use a conservative probability and five-percent edge");
assert.equal(minimumOddsThreshold(0.55,0.12,0.05),2.45,"threshold helper remains conservative even with a large calibration error");
assert.equal(minimumOddsThreshold(0.55,0.02,0),1.89,"zero safety margin returns conservative fair odds");
assert.equal(minimumOddsThreshold(0.55,0.02,1),null,"invalid safety margin is rejected");
const model15=modelRows.find(p=>p.target==="MODEL_15");
const model25=modelRows.find(p=>p.target==="MODEL_25");
assert(model15,"validated 15-minute shadow model creates a prediction");
assert.equal(model15.modelProbability,0.5,"15-minute model probability is calculated from stored weights");
assert.equal(model15.modelMinimumOdds,2.19,"model prediction stores conservative minimum odds with five-percent edge");
assert.equal(model15.deadlineMinute,70,"15-minute model uses the five-minute delay buffer");
assert(model25,"validated 25-minute shadow model creates a prediction");

const lateFtModel={
 source:"Flashscore",mode:"FORWARD_ONLY_LIVE_TRAINING_LATE_FT",updated_at:new Date(now).toISOString(),
 validation_policy:{min_train_matches:100,min_validation_matches:50,min_relative_log_loss_gain:0.01,min_relative_brier_gain:0.005},
 model:{status:"SHADOW_VALIDATED",counts:{train:600,validation:350,train_matches:120,validation_matches:60},metrics:{relative_log_loss_gain:0.02,relative_brier_gain:0.015,calibration:{bins:[{range:"50-60",matches_weight:12,absolute_error:0.02}]}},weights:Array(38).fill(0)}
};
const ftRows=[];
addPredictions(ftRows,{...feed,records:[{collected_at:new Date(now).toISOString(),match:{...match,live_minute:75}}]},now,null,lateFtModel);
const modelFT=ftRows.find(p=>p.target==="MODEL_FT");
assert(modelFT,"independently validated full-time model creates its own prediction");
assert.equal(modelFT.modelProbability,0.5);
assert.equal(modelFT.actionableAfterMinute,80,"full-time model includes the five-minute data lag");
assert.equal(modelFT.deadlineMinute,120,"full-time target remains open through regulation stoppage time");
const ftEarlyRows=[];
addPredictions(ftEarlyRows,{...feed,records:[{collected_at:new Date(now).toISOString(),match:{...match,live_minute:65}}]},now,null,lateFtModel);
assert(ftEarlyRows.some(p=>p.target==="MODEL_FT"),"validated full-time model also predicts from the 65th minute");
const blockedFt=[];
addPredictions(blockedFt,{...feed,records:[{collected_at:new Date(now).toISOString(),match:{...match,live_minute:75}}]},now,null,{...lateFtModel,model:{...lateFtModel.model,status:"WARMUP"}});
assert.equal(blockedFt.some(p=>p.target==="MODEL_FT"),false,"unvalidated full-time model never emits a prediction");
const ftHit={...modelFT,status:"OPEN",snapshots:[...modelFT.snapshots]};
evaluate([ftHit],{source:"Flashscore",collected_at:new Date(now+40*60000).toISOString(),records:[],recent_history:[
 {time:now+32*60000,match:{...match,live_minute:82,home_score:2,away_score:0,stage:"2nd Half"}}
]},{matches:{}},now+40*60000);
assert.equal(ftHit.status,"HIT","full-time model is hit only by a goal after the actionable lag");
const ftMiss={...modelFT,status:"OPEN",snapshots:[...modelFT.snapshots]};
evaluate([ftMiss],{source:"Flashscore",collected_at:new Date(now+45*60000).toISOString(),records:[],recent_history:[
 {time:now+45*60000,match:{...match,live_minute:90,stage:"2nd Half"}}
]},{matches:{"fixture-1":{status:"CONFIRMED",home_score:1,away_score:0,confirmed_at:new Date(now+46*60000).toISOString(),final_match:{status_text:"Finished",stage:"2nd Half"}}}},now+46*60000);
assert.equal(ftMiss.status,"MISS","confirmed regulation full-time with no later goal is a miss");
const ftExtra={...modelFT,status:"OPEN",snapshots:[...modelFT.snapshots]};
evaluate([ftExtra],{source:"Flashscore",collected_at:new Date(now+45*60000).toISOString(),records:[],recent_history:[
 {time:now+45*60000,match:{...match,live_minute:91,home_score:2,away_score:0,stage:"Extra Time",status_text:"After extra time"}}
]},{matches:{"fixture-1":{status:"CONFIRMED",home_score:2,away_score:0,confirmed_at:new Date(now+46*60000).toISOString(),final_match:{status_text:"After extra time",stage:"Extra Time"}}}},now+46*60000);
assert.equal(ftExtra.status,"UNRESOLVED","extra-time outcomes are excluded from the regulation full-time model");

assert.equal(model25.modelProbability,0.5,"model probability is calculated from stored weights");
assert.equal(model25.actionableAfterMinute,55,"model uses the five-minute buffer");
assert.equal(model25.deadlineMinute,80,"model horizon ends 25 minutes after the delay buffer");
const blockedRows=[];
addPredictions(blockedRows,feed,now,{...validatedModel,models:{"25":{...validatedModel.models["25"],status:"NOT_VALIDATED"}}});
assert.equal(blockedRows.some(p=>p.target==="MODEL_25"||p.target==="MODEL_15"),false,"unvalidated model must never issue a probability");
const p15=rows.find(p=>p.target===15),p25=rows.find(p=>p.target===25),next=rows.find(p=>p.target==="NEXT_TEAM");
assert.equal(p15.actionableAfterMinute,55,"five-minute delay buffer applied");
assert.equal(p15.deadlineMinute,70,"15-minute horizon starts after the delay buffer");
assert.equal(p25.deadlineMinute,80,"25-minute horizon starts after the delay buffer");
const later={source:"Flashscore",collected_at:new Date(now+600000).toISOString(),records:[],recent_history:[
 {time:now+300000,match:{...match,live_minute:55,home_score:1,away_score:0}},
 {time:now+600000,match:{...match,live_minute:60,home_score:2,away_score:0}}
]};
evaluate([p15,p25,next],later,{matches:{}},now+600000);
assert.equal(p15.status,"HIT");
assert.equal(p25.status,"HIT");
const model25Hit={...model25,status:"OPEN",snapshots:[...model25.snapshots]};
evaluate([model25Hit],later,{matches:{}},now+600000);
const model15Hit={...model15,status:"OPEN",snapshots:[...model15.snapshots]};
evaluate([model15Hit],later,{matches:{}},now+600000);
assert.equal(model15Hit.status,"HIT","validated 15-minute model prediction is automatically evaluated");
assert.equal(model25Hit.status,"HIT","validated model prediction is automatically evaluated on the 25-minute horizon");
assert.equal(next.status,"HIT");
assert.equal(next.actualTeam,"Home");
assert.equal(p15.startStats.sot.home,5,"prediction-time statistics are recorded");
const tied={...match,home_score:1,away_score:1};
const p1x2={...p15,target:"RESULT_1X2",predictedOutcome:"HOME",startMinute:65,startHome:1,startAway:0,status:"OPEN"};
evaluate([p1x2],{...later,recent_history:[]},{matches:{"fixture-1":{status:"CONFIRMED",home_score:1,away_score:1,confirmed_at:new Date(now+900000).toISOString(),final_match:{status_text:"Finished"}}}},now+900000);
assert.equal(p1x2.status,"MISS");
const extra={...p1x2,status:"OPEN"};
evaluate([extra],{...later,recent_history:[]},{matches:{"fixture-1":{status:"CONFIRMED",home_score:2,away_score:1,confirmed_at:new Date(now+900000).toISOString(),final_match:{status_text:"After extra time"}}}},now+900000);
assert.equal(extra.status,"UNRESOLVED");

const btts={...p15,target:"BTTS",startHome:1,startAway:0,startGoals:1,status:"OPEN"};
const bttsFeed={source:"Flashscore",collected_at:new Date(now+900000).toISOString(),records:[],recent_history:[
 {time:now+300000,match:{...match,live_minute:55,home_score:1,away_score:0}},
 {time:now+900000,match:{...match,live_minute:65,home_score:1,away_score:1}}
]};
evaluate([btts],bttsFeed,{matches:{}},now+900000);
assert.equal(btts.status,"HIT","BTTS is hit when both teams score in separate snapshots");


const delayedMiss={...p15,status:"OPEN",snapshots:[{time:now,minute:50,home_score:1,away_score:0,status:"live",status_text:"1st Half",stage:"1st Half"}]};
const delayedTimeline={source:"Flashscore",collected_at:new Date(now+4000000).toISOString(),records:[],recent_history:[
 {time:now+180000,match:{...match,live_minute:53,home_score:2,away_score:0}},
 {time:now+2400000,match:{...match,live_minute:90,home_score:2,away_score:0}}
]};
evaluate([delayedMiss],delayedTimeline,{matches:{"fixture-1":{status:"CONFIRMED",home_score:2,away_score:0,confirmed_at:new Date(now+4000000).toISOString(),final_match:{status_text:"Finished"}}}},now+4000000);
assert.equal(delayedMiss.status,"MISS","a goal inside the assumed data-delay buffer is not counted as a hit");
const delayedBtts={...p15,target:"BTTS",status:"OPEN",startGoals:1};
evaluate([delayedBtts],{source:"Flashscore",recent_history:[
 {time:now+180000,match:{...match,live_minute:53,home_score:1,away_score:1}}
]},{matches:{"fixture-1":{status:"CONFIRMED",home_score:1,away_score:1,confirmed_at:new Date(now+4000000).toISOString(),final_match:{status_text:"Finished"}}}},now+4000000);
assert.equal(delayedBtts.status,"UNRESOLVED","BTTS completed within the data-delay buffer is not claimed as actionable");



const lateRows=[];
addPredictions(lateRows,{...feed,records:[{collected_at:new Date(now).toISOString(),match:{...match,live_minute:96}}]},now);
assert.equal(lateRows.length,0,"no new predictions are issued when less than the delay buffer remains");
const lateFt={...p15,target:"FT",startMinute:96,status:"OPEN"};
evaluate([lateFt],{source:"Flashscore",records:[],recent_history:[]},{matches:{}},now+1000);
assert.equal(lateFt.status,"UNRESOLVED","late predictions are excluded from accuracy");

const temp=fs.mkdtempSync(path.join(os.tmpdir(),"ai-edge-ledger-test-"));
try{
 fs.writeFileSync(path.join(temp,"flashscore-primary-current.json"),JSON.stringify(feed));
 fs.writeFileSync(path.join(temp,"flashscore-confirmed-outcomes.json"),JSON.stringify({matches:{}}));
 const result=buildLedger(temp,new Date(now));
 const historyPath=path.join(temp,"ai-edge-prediction-history.json");
 const compressedPath=historyPath+".gz";
 assert.equal(fs.existsSync(historyPath),false,"uncompressed permanent history is removed after compression");
 assert.equal(fs.existsSync(compressedPath),true,"permanent history is stored as gzip");
 const saved=JSON.parse(zlib.gunzipSync(fs.readFileSync(compressedPath)).toString("utf8"));
 const view=JSON.parse(fs.readFileSync(path.join(temp,"ai-edge-prediction-live.json"),"utf8"));
 assert.equal(saved.mode,"LIVE_PREDICTION_LEDGER");
 assert(saved.by_target["15"],"per-target summary saved");
 assert.equal(result.total,saved.total_predictions);
 assert(saved.predictions.every(p=>Array.isArray(p.snapshots)&&p.snapshots.length===1),"baseline match snapshots are persisted");
 assert.equal(view.mode,"LIVE_PREDICTION_LEDGER_VIEW");
 assert.equal(view.total_predictions,saved.total_predictions);
 assert(view.predictions.length>0,"compact live view includes recent predictions");
 assert(view.predictions.every(p=>!Object.prototype.hasOwnProperty.call(p,"snapshots")),"compact live view excludes large evaluation timelines");
 const second=buildLedger(temp,new Date(now+60000));
 const savedAgain=JSON.parse(zlib.gunzipSync(fs.readFileSync(compressedPath)).toString("utf8"));
 assert.equal(savedAgain.total_predictions,saved.total_predictions,"gzip history is reloaded without losing existing prediction rows");
 assert.equal(second.total,saved.total_predictions,"subsequent runs continue from compressed permanent history");
}finally{fs.rmSync(temp,{recursive:true,force:true});}


const bttsAfter={...p15,target:"BTTS",status:"OPEN",startHome:1,startAway:0,startGoals:1,actionableAfterMinute:55,snapshots:[{time:now,minute:50,home_score:1,away_score:0,status:"live",status_text:"1st Half",stage:"1st Half"}]};
evaluate([bttsAfter],{source:"Flashscore",recent_history:[{time:now+600000,match:{...match,live_minute:60,home_score:1,away_score:1}}]},{matches:{}},now+700000);
assert.equal(bttsAfter.status,"HIT","BTTS is hit when the previously scoreless team scores after the delay buffer");
const bttsInside={...p15,target:"BTTS",status:"OPEN",startHome:1,startAway:0,startGoals:1,actionableAfterMinute:55,snapshots:[{time:now,minute:50,home_score:1,away_score:0,status:"live",status_text:"1st Half",stage:"1st Half"}]};
evaluate([bttsInside],{source:"Flashscore",recent_history:[
 {time:now+180000,match:{...match,live_minute:53,home_score:1,away_score:1}},
 {time:now+900000,match:{...match,live_minute:65,home_score:2,away_score:1}}
]},{matches:{}},now+1000000);
assert.equal(bttsInside.status,"OPEN","a BTTS goal inside the delay buffer is not treated as an actionable hit");


const btts00={...p15,target:"BTTS",status:"OPEN",startHome:0,startAway:0,startGoals:0,actionableAfterMinute:55,snapshots:[{time:now,minute:50,home_score:0,away_score:0,status:"live",status_text:"1st Half",stage:"1st Half"}]};
evaluate([btts00],{source:"Flashscore",recent_history:[
 {time:now+600000,match:{...match,live_minute:60,home_score:1,away_score:0}},
 {time:now+900000,match:{...match,live_minute:65,home_score:1,away_score:1}}
]},{matches:{}},now+1000000);
assert.equal(btts00.status,"HIT","0-0 BTTS requires both teams to score after the delay buffer");
const btts00One={...p15,target:"BTTS",status:"OPEN",startHome:0,startAway:0,startGoals:0,actionableAfterMinute:55,snapshots:[{time:now,minute:50,home_score:0,away_score:0,status:"live",status_text:"1st Half",stage:"1st Half"}]};
evaluate([btts00One],{source:"Flashscore",recent_history:[
 {time:now+600000,match:{...match,live_minute:60,home_score:1,away_score:0}}
]},{matches:{}},now+1000000);
assert.equal(btts00One.status,"OPEN","one goal after the buffer does not settle a 0-0 BTTS prediction");

const simRows=buildStrategyDataset([
 {matchId:"match-a",target:"MODEL_15",status:"MISS",createdAt:1,modelMinimumOdds:2.1,modelProbability:.5},
 {matchId:"match-a",target:"MODEL_15",status:"HIT",createdAt:2,modelMinimumOdds:2.2,modelProbability:.45},
 {matchId:"match-open",target:"MODEL_25",status:"OPEN",createdAt:3,modelMinimumOdds:2.3,modelProbability:.4},
 {matchId:"match-ignored",target:15,status:"HIT",createdAt:4,modelMinimumOdds:2.0,modelProbability:.6},
 {matchId:"match-b",target:"MODEL_25",status:"HIT",createdAt:5,modelMinimumOdds:2.2,modelProbability:.55},
 {matchId:"match-c",target:"MODEL_25",status:"MISS",createdAt:6,modelMinimumOdds:2.5,modelProbability:.45}
]);
assert.equal(simRows.length,4,"only resolved model predictions enter the simulator");
assert.deepEqual(simRows.map(x=>x.createdAt),[1,2,5,6],"simulation data is chronological");
assert.equal(simRows[0].matchId,"match-a","match identity is retained for deduplication");
const sim=simulateStrategy(simRows,{odds:2.3,bankroll:100,baseStake:2,multiplier:1.5,maxStakeMultiple:5});
assert.equal(sim.flat.bets,2,"at most one bet is counted per match");
assert.equal(sim.flat.wins,1);assert.equal(sim.flat.losses,1);assert.equal(sim.flat.skipped,2);assert.equal(sim.flat.skippedDuplicateMatches,1);assert.equal(sim.flat.net,0.6);
assert.equal(sim.progressive.bets,2);assert.equal(sim.progressive.net,1.9,"progression raises next stake after loss");assert.equal(sim.progressive.maxLosingStreak,1);
assert.throws(()=>simulateStrategy(simRows,{odds:1,bankroll:100,baseStake:1}),/Neplatné/);
const {matchLevelSummary,minimumOddsSimulationSummary}=require("./ai-edge-live-prediction-ledger");
const matchLevel=matchLevelSummary([
 {id:"m1-first",matchId:"m1",target:"MODEL_25",createdAt:100,status:"MISS"},
 {id:"m1-later",matchId:"m1",target:"MODEL_25",createdAt:200,status:"HIT"},
 {id:"m2-first",matchId:"m2",target:"MODEL_25",createdAt:150,status:"HIT"},
 {id:"m3-first",matchId:"m3",target:"MODEL_25",createdAt:250,status:"OPEN"},
 {id:"m1-15",matchId:"m1",target:"MODEL_15",createdAt:90,status:"HIT"},
 {id:"missing-id",target:"MODEL_25",createdAt:50,status:"HIT"}
],"MODEL_25");
assert.equal(matchLevel.method,"first_prediction_per_match_and_target");
assert.equal(matchLevel.total,3,"one earliest prediction per unique match and target is counted");
assert.equal(matchLevel.HIT,1);
assert.equal(matchLevel.MISS,1,"the earliest result wins; a later repeated hit cannot overwrite it");
assert.equal(matchLevel.OPEN,1);
assert.equal(matchLevel.decided,2);
assert.equal(matchLevel.accuracy,0.5);
const minimumOddsSummary=minimumOddsSimulationSummary([
 {matchId:"sim-a",target:"MODEL_25",createdAt:10,status:"HIT",modelMinimumOdds:2.0},
 {matchId:"sim-a",target:"MODEL_25",createdAt:20,status:"MISS",modelMinimumOdds:2.5},
 {matchId:"sim-b",target:"MODEL_25",createdAt:30,status:"MISS",simulationMinimumOdds:2.2},
 {matchId:"sim-c",target:"MODEL_25",createdAt:40,status:"OPEN",simulationMinimumOdds:1.8},
 {matchId:"sim-d",target:"MODEL_FT",createdAt:50,status:"HIT",simulationMinimumOdds:2.1}
],"MODEL_25");
assert.equal(minimumOddsSummary.total,3,"one earliest eligible prediction per match and model is selected");
assert.equal(minimumOddsSummary.HIT,1);
assert.equal(minimumOddsSummary.MISS,1);
assert.equal(minimumOddsSummary.OPEN,1);
assert.equal(minimumOddsSummary.net_profit,0,"at 2.00 one win earns +1 and one loss loses -1");
assert.equal(minimumOddsSummary.roi,0,"ROI uses one unit staked on each settled match");
console.log("AI Edge live prediction ledger tests passed.");
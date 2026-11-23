"use strict";
const assert=require("node:assert/strict");
const {MARKET_LINES,buildMarketPredictions,calibrationGate,minimumOdds,settleMarketEntries,summarizeMarketGroup,sigmoid}=require("./ai-edge-market-top-predictions");
const now=new Date("2026-11-20T20:00:00.000Z");
const stats=[
 {label:"Yellow Cards",home:1,away:1},
 {label:"Fouls",home:8,away:10},
 {label:"Total Shots",home:7,away:6},
 {label:"Shots on target",home:2,away:2},
 {label:"Ball Possession",home:51,away:49},
 {label:"Red Cards",home:0,away:0},
 {label:"Corner Kicks",home:3,away:2}
];
const history=[58,61,64].map((minute,index)=>({
 time:Date.parse("2026-11-20T19:50:00.000Z")+index*60000,
 match:{id:"match-1",source:"Flashscore",status:"live",stage:"2nd half",live_minute:minute,home_score:1,away_score:0,stats}
}));
const record={collected_at:"2026-11-20T19:55:00.000Z",match:{id:"match-1",source:"Flashscore",status:"live",stage:"2nd half",live_minute:70,home:"Home FC",away:"Away FC",competition:"Test League",home_score:1,away_score:0,stats}};
function validatedModel(mode,key,featureCount){
 return {source:"Flashscore",mode,updated_at:now.toISOString(),observation_minute_range:mode.includes("CORNERS")?[55,75]:[55,80],
 validation_policy:{min_train_samples:500,min_validation_samples:300,min_train_matches:100,min_validation_matches:50,min_relative_log_loss_gain:.01,min_relative_brier_gain:.005,min_effective_match_weight_per_calibration_bin:8,max_absolute_calibration_error:.08},
 models:{[key]:{status:"SHADOW_VALIDATED",probability_calibration:{method:"platt_train_match_holdout",intercept:0,slope:1,matches:50,samples:300},counts:{train:500,validation:300,train_matches:100,validation_matches:50},metrics:{relative_log_loss_gain:.02,relative_brier_gain:.01,calibration:{bins:[{range:"50-60",matches_weight:9,absolute_error:.03}]}},weights:Array(featureCount+1).fill(0)}}};
}
const rawP=sigmoid([0,1],[1]);
const calibratedP=sigmoid([0,1],[1],{method:"platt_train_match_holdout",intercept:0,slope:0.5});
assert.ok(calibratedP<rawP&&calibratedP>0.5,"market inference must apply the stored Platt calibration");
const cards=validatedModel("FORWARD_ONLY_LIVE_CARDS_SHADOW","OVER_2_5",16);
const corners=validatedModel("FORWARD_ONLY_LIVE_CORNERS_UNDER_SHADOW","UNDER_8_5",17);
const feed={source:"Flashscore",collected_at:record.collected_at,records:[record],recent_history:history};
const predictions=buildMarketPredictions(feed,{corners,cards},[],now);
assert.equal(predictions.length,2);
assert(predictions.some(x=>x.target==="CARDS_OVER_2_5"));
assert(predictions.some(x=>x.target==="CORNERS_UNDER_8_5"));
for(const p of predictions){
 assert.equal(p.status,"OPEN");
 assert.equal(p.modelStatus,"SHADOW_VALIDATED");
 assert.equal(p.actionableAfterMinute,69);
 assert.equal(p.capturedMinute,64);
 assert(p.modelMinimumOdds>1);
 assert.equal(p.modelProbability,.5);
}
assert.equal(minimumOdds(.5,.03),2.24);
assert.equal(calibrationGate({metrics:{calibration:{bins:[{range:"50-60",matches_weight:7,absolute_error:.01}]}}},.5,{validation_policy:{}}).allowed,false);
const entries=[...predictions];
const outcomes={matches:{"match-1":{
 source:"Flashscore",status:"CONFIRMED",status_confirmation:"confirmed_finished",final_status:"FINISHED",
 corners_status:"CONFIRMED",final_corners:{total_corners:9},
 yellow_cards_status:"CONFIRMED",final_yellow_cards:{total_yellow_cards:4},
 home_score:2,away_score:1,confirmed_at:now.toISOString(),final_match:{status_text:"Finished"}
}}};
settleMarketEntries(entries,outcomes,now);
const cardEntry=entries.find(x=>x.target==="CARDS_OVER_2_5");
const cornerEntry=entries.find(x=>x.target==="CORNERS_UNDER_8_5");
assert.equal(cardEntry.status,"HIT");
assert.equal(cornerEntry.status,"MISS");
assert.equal(summarizeMarketGroup(entries,"CARDS_OU").HIT,1);
assert.equal(summarizeMarketGroup(entries,"CORNERS_UNDER").MISS,1);
assert.equal(MARKET_LINES.length,10);
console.log("AI Edge validated corners/cards TOP prediction tests passed.");

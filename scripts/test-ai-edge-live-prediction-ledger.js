"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {addPredictions,evaluate,buildLedger}=require("./ai-edge-live-prediction-ledger");
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


const temp=fs.mkdtempSync(path.join(os.tmpdir(),"ai-edge-ledger-test-"));
try{
 fs.writeFileSync(path.join(temp,"flashscore-primary-current.json"),JSON.stringify(feed));
 fs.writeFileSync(path.join(temp,"flashscore-confirmed-outcomes.json"),JSON.stringify({matches:{}}));
 const result=buildLedger(temp,new Date(now));
 const saved=JSON.parse(fs.readFileSync(path.join(temp,"ai-edge-prediction-history.json"),"utf8"));
 assert.equal(saved.mode,"LIVE_PREDICTION_LEDGER");
 assert(saved.by_target["15"],"per-target summary saved");
 assert.equal(result.total,saved.total_predictions);
 assert(saved.predictions.every(p=>Array.isArray(p.snapshots)&&p.snapshots.length===1),"baseline match snapshots are persisted");
}finally{fs.rmSync(temp,{recursive:true,force:true});}

console.log("AI Edge live prediction ledger tests passed.");
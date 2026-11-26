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
console.log("FT EARLY 45-55 tests passed:",samples.length,"samples");

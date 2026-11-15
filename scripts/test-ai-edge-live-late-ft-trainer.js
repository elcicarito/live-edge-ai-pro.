"use strict";
const assert=require("node:assert/strict");
const {labelLateFT,buildLateFTSamples}=require("./ai-edge-live-late-ft-trainer");
const base=require("./ai-edge-live-online-trainer");
const outcome={source:"Flashscore",status:"CONFIRMED",status_confirmation:"confirmed_finished",final_status:"FINISHED",final_match:{status_text:"Finished"}};
const stats=[
 {label:"Shots on target",period:"Match",home:5,away:2,home_numeric:5,away_numeric:2},
 {label:"Total shots",period:"Match",home:12,away:7,home_numeric:12,away_numeric:7},
 {label:"Expected goals (xG)",period:"Match",home:1.2,away:0.5,home_numeric:1.2,away_numeric:0.5}
];
const row=(minute,homeScore=0)=>({match_id:"flashscore:test-1",snapshot:{collected_at:new Date(Date.UTC(2026,10,15,12,minute)).toISOString(),live_minute:minute,stage:"2nd Half",home_score:homeScore,away_score:0,stats}});
const sample=row(75), rows=[row(70),sample,row(80),row(90)];
assert.equal(labelLateFT(sample,rows,[],outcome),0,"confirmed full-time with no later goal is negative");
const positiveRows=[row(70),sample,row(80),row(85),row(90,1)];
const positiveTransitions=base.goalTransitions(positiveRows).transitions;
assert.equal(labelLateFT(sample,positiveRows,positiveTransitions,outcome),1,"goal after effective 80' boundary is positive");
const ambiguousRows=[row(70),sample,row(82,1),row(90,1)];
const ambiguousTransitions=base.goalTransitions(ambiguousRows).transitions;
assert.equal(labelLateFT(sample,ambiguousRows,ambiguousTransitions,outcome),null,"goal interval crossing the 5-minute lag boundary is excluded");
const extraTime={...outcome,final_match:{status_text:"Extra time"}};
assert.equal(labelLateFT(sample,rows,[],extraTime),null,"extra-time matches are excluded from the regular-time target");
const abandoned={...outcome,final_match:{status_text:"Abandoned"}};
assert.equal(labelLateFT(sample,rows,[],abandoned),null,"abandoned match is never a negative");
const many=[];
for(let i=0;i<5;i++)many.push({...row(70),match_id:"flashscore:m"+i,snapshot:{...row(70).snapshot,collected_at:new Date(Date.UTC(2026,10,15,12,i)).toISOString()}});
const grouped=[];
for(let i=0;i<5;i++){
 const id="flashscore:m"+i;
 for(const minute of [70,75,80,85,90])grouped.push({match_id:id,snapshot:{...row(minute).snapshot,collected_at:new Date(Date.UTC(2026,10,15,12,i+minute)).toISOString()}});
}
const outcomes={matches:Object.fromEntries(Array.from({length:5},(_,i)=>["m"+i,outcome]))};
const samples=buildLateFTSamples(grouped,outcomes,Date.UTC(2026,10,15,0));
assert.ok(samples.length<=5,"at most one sample is emitted per match");
assert.ok(samples.every(x=>x.id.endsWith("|70_FT")),"late FT target has independent sample IDs");
console.log("AI Edge late FT trainer tests passed.");

"use strict";
const assert=require("node:assert/strict");
const {labelLateFT,lateFTFeatureVector,buildLateFTSamples}=require("./ai-edge-live-late-ft-trainer");
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
const earlySample=row(65);
assert.equal(labelLateFT(earlySample,[row(65),row(70),row(90)],[],outcome),0,"65th-minute capture uses the five-minute decision lag and full-time label");
const positiveRows=[row(70),sample,row(80),row(85),row(90,1)];
const positiveTransitions=base.goalTransitions(positiveRows).transitions;
assert.equal(labelLateFT(sample,positiveRows,positiveTransitions,outcome),1,"goal after effective 80' boundary is positive");
const ambiguousRows=[row(70),sample,row(82,1),row(90,1)];
const ambiguousTransitions=base.goalTransitions(ambiguousRows).transitions;
assert.equal(labelLateFT(sample,ambiguousRows,ambiguousTransitions,outcome),null,"goal interval crossing the 5-minute lag boundary is excluded");
const exactBoundaryRows=[row(75),row(80,1),row(90,1)];
const exactBoundaryTransitions=base.goalTransitions(exactBoundaryRows).transitions;
assert.equal(labelLateFT(exactBoundaryRows[0],exactBoundaryRows,exactBoundaryTransitions,outcome),null,"goal first observed exactly at the lag boundary is ambiguous and excluded");
const trendRows=[65,70,75,80].map((minute)=>({
 ...row(minute),
 snapshot:{...row(minute).snapshot,stats:stats.map(item=>{
  const value=item.label==="Shots on target"?Math.floor((minute-65)/5)*2+2:item.label==="Total shots"?minute-65+8:item.label==="Expected goals (xG)"?1+(minute-65)*0.05:item.home_numeric;
  return {...item,home:value,home_numeric:value};
 })}
}));
const ftVector=lateFTFeatureVector(trendRows[2],trendRows,2);
assert.equal(ftVector.length,37,"late FT v2 adds 21 match-state and recent-pressure features to the 16 core features");
assert.equal(ftVector[17],1,"draw state is represented explicitly");
assert.equal(ftVector[24],1,"75-80 minute band is represented explicitly");
assert.ok(Math.abs(ftVector[26]-(2/3))<1e-9,"five-minute shots-on-target growth is captured");
const shortFit=base.fit([{match_id:"a",x:[0,1],y:0},{match_id:"b",x:[1,0],y:1}],[1,1]);
assert.equal(shortFit.length,3,"shared trainer fit supports an isolated custom feature dimension");
assert.throws(()=>base.fit([{match_id:"a",x:[0],y:0},{match_id:"b",x:[1,2],y:1}],[1,1]),/Inconsistent feature-vector dimensions/,"mixed feature dimensions are rejected");

const extraTime={...outcome,final_match:{status_text:"Extra time"}};
assert.equal(labelLateFT(sample,rows,[],extraTime),null,"extra-time matches are excluded from the regular-time target");
const aet={...outcome,final_match:{status_text:"Finished",stage:"AET"}};
assert.equal(labelLateFT(sample,rows,[],aet),null,"AET matches are excluded from the regular-time target");
const abandoned={...outcome,final_match:{status_text:"Abandoned"}};
assert.equal(labelLateFT(sample,rows,[],abandoned),null,"abandoned match is never a negative");
const many=[];
for(let i=0;i<5;i++)many.push({...row(70),match_id:"flashscore:m"+i,snapshot:{...row(70).snapshot,collected_at:new Date(Date.UTC(2026,10,15,12,i)).toISOString()}});
const grouped=[];
for(let i=0;i<5;i++){
 const id="flashscore:m"+i;
 for(const minute of [65,70,75,80,85,90])grouped.push({match_id:id,snapshot:{...row(minute).snapshot,collected_at:new Date(Date.UTC(2026,10,15,12,i+minute)).toISOString()}});
}
const outcomes={matches:Object.fromEntries(Array.from({length:5},(_,i)=>["m"+i,outcome]))};
const samples=buildLateFTSamples(grouped,outcomes,Date.UTC(2026,10,15,0));
assert.equal(samples.length,25,"five five-minute decision windows from 65' to 85' are sampled for each of five matches");
assert.ok(samples.every(x=>/\|(65|70|75|80|85)_FT$/.test(x.id)),"late FT target uses distinct five-minute window IDs");
assert.equal(new Set(samples.map(x=>x.match_id+"|"+x.id.split("|").slice(-1)[0])).size,samples.length,"a match contributes at most one sample per decision window");
console.log("AI Edge late FT trainer tests passed.");

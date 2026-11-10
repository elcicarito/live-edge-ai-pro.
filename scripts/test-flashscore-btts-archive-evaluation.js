"use strict";
const assert = require("node:assert/strict");
const { classify, buildEvaluation } = require("./flashscore-btts-archive-evaluation");
const snap = {
  live_minute:72, stage:"2nd Half", home_score:1, away_score:0,
  stats:[
    {name:"Shots on target",period:"Match",home:3,away:2},
    {name:"Total shots",period:"Match",home:6,away:6},
    {name:"Shots on target",period:"1st Half",home:0,away:0},
    {name:"Total shots",period:"1st Half",home:0,away:0}
  ]
};
assert.equal(classify(snap).tierKey,"10_sot5_shots12");
assert.equal(classify({...snap,live_minute:70}),null);
assert.equal(classify({...snap,stage:"1st Half"}),null);
assert.equal(classify({...snap,stats:[{name:"Shots on target",home:3,away:2}]}),null);
const built=buildEvaluation({
 index:{source:"Flashscore",weeks:[]},
 outcomes:{matches:{}},
 bttsArchive:{source:"Flashscore",signals:[]},
 now:"2026-11-10T00:00:00.000Z"
});
assert.equal(built.after70_analysis.sample,0);
assert.equal(built.after70_analysis.odds_available,false);
console.log("Flashscore BTTS archive evaluation tests passed.");

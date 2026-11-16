"use strict";
const assert=require("node:assert/strict");
const {summarize}=require("./ai-edge-top-opportunity-ledger");
const rows=[
 {target:"MODEL_25",status:"HIT",capturedAt:100,minimumOdds:2,stake:1},
 {target:"MODEL_25",status:"MISS",capturedAt:200,minimumOdds:1.8,stake:1},
 {target:"MODEL_25",status:"OPEN",capturedAt:300,minimumOdds:2.1,stake:1},
 {target:"MODEL_FT",status:"HIT",capturedAt:400,minimumOdds:2.2,stake:1}
];
const s=summarize(rows,"MODEL_25");
assert.equal(s.total,3);
assert.equal(s.HIT,1);
assert.equal(s.MISS,1);
assert.equal(s.OPEN,1);
assert.equal(s.decided,2);
assert.equal(s.totalStaked,2);
assert.equal(s.netProfit,-0.2);
assert.equal(s.roi,-10);
assert.equal(s.maxDrawdown,1);
assert.equal(s.stakePerPick,1);
assert.equal(summarize(rows,"MODEL_FT").netProfit,1.2);
console.log("AI Edge TOP opportunity ledger tests passed.");

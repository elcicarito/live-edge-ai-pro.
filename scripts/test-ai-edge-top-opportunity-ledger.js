"use strict";
const assert=require("node:assert/strict");
const {summarize,topEntryKey,hasCaptured}=require("./ai-edge-top-opportunity-ledger");
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
assert.equal(s.netProfit,0);
assert.equal(s.roi,0);
assert.equal(s.maxDrawdown,1);
assert.equal(s.stakePerPick,1);
assert.equal(summarize(rows,"MODEL_FT").netProfit,1.2);
const sameMatch=[
 {matchId:"match-1",target:"MODEL_25"},
 {matchId:"match-1",target:"MODEL_FT"}
];
assert.equal(topEntryKey("match-1","MODEL_25"),"match-1|MODEL_25");
assert.equal(hasCaptured(sameMatch,"match-1","MODEL_25"),true);
assert.equal(hasCaptured(sameMatch,"match-1","MODEL_FT"),true);
assert.equal(hasCaptured(sameMatch,"match-1","MODEL_15"),false);
assert.equal(new Set(sameMatch.map(x=>topEntryKey(x.matchId,x.target))).size,2);
assert.equal(hasCaptured([{matchId:"match-2",target:"MODEL_25"}],"match-2","MODEL_25"),true);
console.log("AI Edge TOP opportunity ledger tests passed.");

const assert=require("node:assert/strict");
require("../momentum-engine.js");
const engine=globalThis.LiveMomentumEngine;
assert.ok(engine&&typeof engine.analyse==="function","engine exports analyse");
const t0=Date.parse("2026-11-08T12:00:00Z");
const make=(time,stats)=>({time,match:{stats}});
const stats=(sotH,sotA,offH,offA,cH=0,cA=0)=>[
 {label:"Shots on Target",home:sotH,away:sotA},
 {label:"Shots Off Target",home:offH,away:offA},
 {label:"Possession",home:55,away:45},
 {label:"Corners",home:cH,away:cA},
 {label:"Dangerous Attacks",home:999,away:1}
];
let r=engine.analyse({stats:stats(3,1,4,2,3,1)},[
 make(t0,stats(1,1,2,1,1,1)),
 make(t0+300000,stats(2,1,3,2,2,1))
],"2026-11-08T12:10:00Z");
assert.equal(r.ready,true);
assert.ok(r.pressure&&r.recent);
assert.equal(r.recent.minutes,5);
assert.equal(r.recent.used.find(x=>x.key==="sot").home,1);
assert.equal(r.recent.used.find(x=>x.key==="off").home,1);
assert.equal(r.recent.used.find(x=>x.key==="corners").home,1);
assert.ok(r.recent.homeRate>r.recent.awayRate);
assert.equal(r.reliability.coreCoverage,100);
assert.equal(r.reliability.shotCoverage,100);
// Dangerous attacks alone must never create momentum.
r=engine.analyse({stats:[{label:"Dangerous Attacks",home:50,away:2}]},[
 make(t0,{stats:[{label:"Dangerous Attacks",home:40,away:1}]})
],"2026-11-08T12:05:00Z");
assert.equal(r.recent,null);
assert.equal(r.pressure,null);
// Reset counters are ignored per metric; another valid counter can still be used.
r=engine.analyse({stats:stats(1,2,2,2)},[
 make(t0,stats(3,1,1,1))
],"2026-11-08T12:05:00Z");
assert.ok(r.recent);
assert.ok(!r.recent.used.some(x=>x.key==="sot"));
assert.ok(r.recent.used.some(x=>x.key==="off"));
// Too-short and too-long intervals are not used.
r=engine.analyse({stats:stats(2,1,3,2)},[
 make(t0,stats(1,1,2,1))
],"2026-11-08T12:02:00Z");
assert.equal(r.recent,null);
r=engine.analyse({stats:stats(2,1,3,2)},[
 make(t0,stats(1,1,2,1))
],"2026-11-08T12:20:00Z");
assert.equal(r.recent,null);
console.log("Momentum engine tests passed.");

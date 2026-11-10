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
// Period-aware Flashscore rows: Match must win even when 1st Half appears first.
const byPeriod=(sotH,sotA,offH,offA,cornerH,cornerA,possH,possA,halfSotH,halfSotA)=>[
 {label:"Shots on target",period:"1st Half",home:halfSotH,away:halfSotA},
 {label:"Shots on target",period:"Match",home:sotH,away:sotA},
 {label:"Shots off target",period:"1st Half",home:0,away:5},
 {label:"Shots off target",period:"Match",home:offH,away:offA},
 {label:"Corner kicks",period:"1st Half",home:0,away:4},
 {label:"Corner kicks",period:"Match",home:cornerH,away:cornerA},
 {label:"Ball possession",period:"1st Half",home:20,away:80},
 {label:"Ball possession",period:"Match",home:possH,away:possA}
];
r=engine.analyse({stats:byPeriod(3,1,2,1,2,0,60,40,0,5)},[
 make(t0,byPeriod(2,1,1,1,1,0,60,40,0,4))
],"2026-11-08T12:05:00Z");
assert.equal(r.recent.used.find(x=>x.key==="sot").home,1);
assert.equal(r.recent.used.find(x=>x.key==="off").home,1);
assert.equal(r.recent.used.find(x=>x.key==="corners").home,1);
assert.ok(r.pressure.home>60,"cumulative pressure must use Match rows, not 1st Half rows");

// Raw Flashscore timeline schema uses name plus numeric value fields.
const rawFlashscoreStats=(sotH,sotA,offH,offA)=>[
 {name:"Shots on target",period:"Match",home:""+sotH,away:""+sotA,home_numeric:sotH,away_numeric:sotA},
 {name:"Shots off target",period:"Match",home:""+offH,away:""+offA,home_numeric:offH,away_numeric:offA},
 {name:"Ball possession",period:"Match",home:"58%",away:"42%",home_numeric:58,away_numeric:42}
];
r=engine.analyse({stats:rawFlashscoreStats(4,1,5,2)},[
 make(t0,rawFlashscoreStats(2,1,3,2))
], "2026-11-08T12:05:00Z");
assert.equal(r.recent.minutes,5);
assert.equal(r.recent.used.find(x=>x.key==="sot").home,2);
assert.equal(r.recent.used.find(x=>x.key==="off").home,2);
assert.ok(r.pressure,"raw name/home_numeric Flashscore stats must be usable");

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
// The 2-minute collector cadence is valid; only intervals below 1.5 min are rejected.
r=engine.analyse({stats:stats(2,1,3,2)},[
 make(t0,stats(1,1,2,1))
],"2026-11-08T12:02:00Z");
assert.equal(r.recent.minutes,2);
r=engine.analyse({stats:stats(2,1,3,2)},[
 make(t0,stats(1,1,2,1))
],"2026-11-08T12:01:00Z");
assert.equal(r.recent,null);
r=engine.analyse({stats:stats(2,1,3,2)},[
 make(t0,stats(1,1,2,1))
],"2026-11-08T12:20:00Z");
assert.equal(r.recent,null);
// A previously valid interval must not be reused as if it were the current one.
r=engine.analyse({stats:stats(3,1,4,2)},[
 make(t0,stats(1,1,2,1)),
 make(t0+300000,stats(2,1,3,2))
],"2026-11-08T12:25:00Z");
assert.equal(r.recent,null);
assert.equal(r.acceleration,null);
// Acceleration must not compare valid intervals separated by a rejected time gap.
r=engine.analyse({stats:stats(4,1,5,2)},[
 make(t0,stats(1,1,2,1)),
 make(t0+300000,stats(2,1,3,2)),
 make(t0+1500000,stats(3,1,4,2))
],"2026-11-08T12:27:00Z");
assert.equal(r.recent.minutes,2);
assert.equal(r.acceleration,null,"a rejected interval breaks acceleration continuity");
// Three consecutive snapshots with valid 5-minute intervals should enable acceleration.
r=engine.analyse({stats:stats(4,1,5,2)},[
 make(t0,stats(1,1,2,1)),
 make(t0+300000,stats(2,1,3,2))
],"2026-11-08T12:10:00Z");
assert.ok(r.acceleration,"two adjacent valid intervals should enable acceleration");
console.log("Momentum engine tests passed.");

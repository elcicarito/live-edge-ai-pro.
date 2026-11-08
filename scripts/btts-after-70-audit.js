const fs = require("fs");
const zlib = require("zlib");
const HISTORY = "data/live-match-history.jsonl.gz";
const LEGACY = "data/live-match-history.jsonl";
const OUT = "audit-output";
const finite = v => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const norm = v => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function minuteOf(v) {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 130) return v;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^\d{1,3}$/.test(s)) return Number(s) <= 130 ? Number(s) : null;
  const m = s.match(/^(\d{1,2})\s*\+\s*(\d{1,2})$/);
  if (m) { const n = Number(m[1]) + Number(m[2]); return n <= 130 ? n : null; }
  return null;
}
function goalsOf(m) {
  for (const k of ["events","incidents","timeline","match_events"]) if (Array.isArray(m?.[k])) {
    return m[k].filter(e => e && (e.is_goal === true || /goal/i.test(String(e.type || e.event || e.name || e.incident_type || "")) || Number(e.type_id) === 1));
  }
  return null;
}
function goalMinute(e) {
  for (const k of ["time","minute","elapsed","elapsed_time","match_time"]) {
    const n = minuteOf(e?.[k]);
    if (n !== null) return n;
  }
  return null;
}
function sideOf(e,x) {
  const h=norm(x.home || x.final_match?.home), a=norm(x.away || x.final_match?.away);
  for (const v of [e.side,e.team,e.team_name,e.participant,e.competitor]) {
    const s=norm(v);
    if (["home","h","1","hometeam"].includes(s) || (h && s===h)) return "home";
    if (["away","a","2","awayteam"].includes(s) || (a && s===a)) return "away";
  }
  return null;
}
function scoreOf(s) {
  const candidates=[s,s?.raw_match,s?.match];
  for(const c of candidates) {
    if(!c || typeof c!=="object") continue;
    const h=c.home_score ?? c.homeScore ?? c.score_home;
    const a=c.away_score ?? c.awayScore ?? c.score_away;
    if(finite(h)&&finite(a)) return [Number(h),Number(a)];
  }
  return null;
}
function finalOf(x) {
  const m=String(x.final_score ?? "").match(/^\s*(\d+)\s*[:\-]\s*(\d+)\s*$/);
  if(m) return [Number(m[1]),Number(m[2])];
  return scoreOf(x.final_match);
}
function statsOf(s) {
  if(Array.isArray(s?.stats)&&s.stats.length) return s.stats;
  if(Array.isArray(s?.raw_stats)&&s.raw_stats.length) return s.raw_stats;
  const m=s?.raw_match||s?.match||{};
  return Array.isArray(m.stats)?m.stats:[];
}
function statPair(stats, names) {
  const wanted=names.map(norm);
  const item=(stats||[]).find(v=>wanted.includes(norm(v?.label||v?.name||v?.type)));
  if(!item || !finite(item.home) || !finite(item.away)) return null;
  return [Number(item.home),Number(item.away)];
}
function band(m) { return m<75?"70–74":m<80?"75–79":m<85?"80–84":"85–90"; }
function summarize(rows, keyFn) {
  const groups=new Map();
  for(const r of rows) { const k=keyFn(r); if(!groups.has(k))groups.set(k,[]); groups.get(k).push(r); }
  return [...groups.entries()].map(([group,a])=>({group,n:a.length,wins:a.filter(x=>x.btts_yes).length,rate_pct:Number((100*a.filter(x=>x.btts_yes).length/a.length).toFixed(2))})).sort((a,b)=>b.n-a.n);
}
function wilson(w,n) {
  if(!n)return null;
  const z=1.96,p=w/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,r=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return [Number((100*(c-r)).toFixed(2)),Number((100*(c+r)).toFixed(2))];
}
const raw=fs.existsSync(HISTORY)?zlib.gunzipSync(fs.readFileSync(HISTORY)).toString("utf8"):fs.existsSync(LEGACY)?fs.readFileSync(LEGACY,"utf8"):"";
if(!raw) throw new Error("LIVE match history archive is missing or empty.");
const matches=new Map();let invalid=0,duplicates=0;
for(const line of raw.split(/\r?\n/)){if(!line.trim())continue;try{const x=JSON.parse(line);if(!x||x.match_id==null){invalid++;continue;}const id=String(x.match_id);if(matches.has(id)){duplicates++;if((x.snapshots||[]).length>(matches.get(id).snapshots||[]).length)matches.set(id,x);}else matches.set(id,x);}catch{invalid++;}}
const chosen=[], allEligible=[], excluded={};
const reject=k=>excluded[k]=(excluded[k]||0)+1;
for(const [id,x] of matches) {
  const fm=x.final_match||{}, final=finalOf(x), goals=goalsOf(fm);
  if(!goals || !goals.length){reject("missing_goal_event_list");continue;}
  if(!final){reject("missing_final_score");continue;}
  const g=goals.map(e=>({minute:goalMinute(e),side:sideOf(e,x)}));
  if(g.some(v=>v.minute===null)){reject("goal_without_minute");continue;}
  if(g.length!==final[0]+final[1]){reject("goal_count_disagrees_with_final_score");continue;}
  if(g.some(v=>!v.side)){reject("goal_side_unresolved");continue;}
  if(g.filter(v=>v.side==="home").length!==final[0] || g.filter(v=>v.side==="away").length!==final[1]){reject("goal_sides_disagree_with_final_score");continue;}
  const snaps=[],seen=new Set();
  for(const s of (Array.isArray(x.snapshots)?x.snapshots:[])){const k=String(s?.collected_at||"missing-"+seen.size);if(seen.has(k))continue;seen.add(k);snaps.push(s);}
  snaps.sort((a,b)=>String(a?.collected_at||"").localeCompare(String(b?.collected_at||"")));
  let high=null,regression=false;
  const local=[];
  for(const s of snaps) {
    const rawMin=s?.minute ?? s?.live_minute ?? s?.raw_match?.live_minute ?? s?.match?.live_minute;
    const m=minuteOf(rawMin);if(m===null)continue;
    if(high!==null && m<high){regression=true;continue;}
    high=Math.max(high??m,m);
    if(m<70||m>90)continue;
    const sc=scoreOf(s);if(!sc){reject("snapshot_missing_score");continue;}
    if(sc[0]>0&&sc[1]>0)continue; // BTTS is already achieved; not a remaining BTTS opportunity.
    if(g.some(v=>v.minute===m)) {reject("goal_same_minute_as_snapshot");continue;}
    const before=g.filter(v=>v.minute<m);
    if(before.length!==sc[0]+sc[1] || before.filter(v=>v.side==="home").length!==sc[0] || before.filter(v=>v.side==="away").length!==sc[1]) {reject("snapshot_score_not_confirmed_by_goal_timeline");continue;}
    const stats=statsOf(s);
    const sot=statPair(stats,["shots on target","on target"]);
    const shots=statPair(stats,["shots","total shots","shots total"]);
    const dangerous=statPair(stats,["dangerous attacks"]);
    const xg=statPair(stats,["expected goals","xg"]);
    const corners=statPair(stats,["corners","corner kicks"]);
    const r={
      match_id:id,home:x.home||fm.home||"",away:x.away||fm.away||"",competition:x.competition||"",
      minute:m,minute_band:band(m),score:sc[0]+":"+sc[1],home_score:sc[0],away_score:sc[1],
      final_score:final[0]+":"+final[1],btts_yes:final[0]>0&&final[1]>0,
      combined_sot:sot?sot[0]+sot[1]:null,home_sot:sot?sot[0]:null,away_sot:sot?sot[1]:null,
      combined_shots:shots?shots[0]+shots[1]:null,home_shots:shots?shots[0]:null,away_shots:shots?shots[1]:null,
      combined_dangerous_attacks:dangerous?dangerous[0]+dangerous[1]:null,
      combined_xg:xg?Number((xg[0]+xg[1]).toFixed(3)):null,
      combined_corners:corners?corners[0]+corners[1]:null,
      collected_at:s.collected_at||""
    };
    local.push(r);allEligible.push(r);
  }
  if(regression) reject("match_had_minute_regression");
  if(local.length) {
    local.sort((a,b)=>a.minute-b.minute);
    chosen.push(local[0]); // one independent observation per match
  }
}
const minuteRows=summarize(chosen,r=>r.minute_band);
const scoreRows=summarize(chosen,r=>r.score);
const statRows=[];
for(const [name,fn] of [
  ["combined SOT ≥ 2",r=>r.combined_sot!==null&&r.combined_sot>=2],
  ["combined SOT ≥ 4",r=>r.combined_sot!==null&&r.combined_sot>=4],
  ["combined SOT ≥ 6",r=>r.combined_sot!==null&&r.combined_sot>=6],
  ["combined shots ≥ 10",r=>r.combined_shots!==null&&r.combined_shots>=10],
  ["combined shots ≥ 15",r=>r.combined_shots!==null&&r.combined_shots>=15],
  ["combined dangerous attacks ≥ 50",r=>r.combined_dangerous_attacks!==null&&r.combined_dangerous_attacks>=50],
  ["combined xG ≥ 1.0",r=>r.combined_xg!==null&&r.combined_xg>=1]
]){const a=chosen.filter(fn);statRows.push({condition:name,n:a.length,wins:a.filter(r=>r.btts_yes).length,rate_pct:a.length?Number((100*a.filter(r=>r.btts_yes).length/a.length).toFixed(2)):null});}
const wins=chosen.filter(r=>r.btts_yes).length;
const report={
 generated_at_utc:new Date().toISOString(),read_only:true,source:HISTORY,
 definition:"Retrospective remaining-BTTS opportunity: first valid snapshot per match from minute 70 through 90, only while at least one team has not scored. WIN means both teams scored by the confirmed final result.",
 archive:{unique_matches:matches.size,duplicate_ids:duplicates,invalid_jsonl_lines:invalid},
 quality:{matches_with_valid_final_and_complete_goal_timeline:matches.size-Object.keys(excluded).reduce((n,k)=>n,0),excluded_reasons:excluded},
 independent_match_sample:{n:chosen.length,wins,losses:chosen.length-wins,success_rate_pct:chosen.length?Number((100*wins/chosen.length).toFixed(2)):null,wilson_95_ci_pct:wilson(wins,chosen.length)},
 all_eligible_snapshots:{n:allEligible.length,wins:allEligible.filter(r=>r.btts_yes).length,success_rate_pct:allEligible.length?Number((100*allEligible.filter(r=>r.btts_yes).length/allEligible.length).toFixed(2)):null,note:"Repeated snapshots from the same match are not independent; use the one-per-match sample for the headline result."},
 by_minute_band:minuteRows,by_start_score:scoreRows,stat_thresholds:statRows,
 odds_context:"No historical bookmaker odds are included in this archive. Success rate alone is not ROI or evidence of positive betting value.",
 sample:chosen
};
fs.mkdirSync(OUT,{recursive:true});
fs.writeFileSync(OUT+"/btts-after-70-audit.json",JSON.stringify(report,null,2)+"\n");
const cols=Object.keys(chosen[0]||{match_id:"",minute:"",score:"",final_score:"",btts_yes:""});
const csv=[cols.join(","),...chosen.map(r=>cols.map(k=>'"'+String(r[k]??"").replace(/"/g,'""')+'"').join(","))].join("\n")+"\n";
fs.writeFileSync(OUT+"/btts-after-70-sample.csv",csv);
console.log("BTTS AFTER 70 AUDIT",JSON.stringify({archive:report.archive,quality:report.quality,independent_match_sample:report.independent_match_sample,all_eligible_snapshots:report.all_eligible_snapshots,by_minute_band:minuteRows,by_start_score:scoreRows,stat_thresholds:statRows},null,2));

"use strict";
// Independent forward-only model: probability of >=1 goal after the 5-minute
// observation lag from a LIVE snapshot at 65'-85' until regulation full-time.
const fs=require("node:fs"),path=require("node:path");
const base=require("./ai-edge-live-online-trainer");
const DATA=path.resolve(__dirname,"..","data");
const FILE="ai-edge-live-late-ft-model.json";
const LAG=5,MINUTE_FROM=65,MINUTE_TO=85;
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(e){if(e.code==="ENOENT")return fallback;throw e;}}
function write(file,value){const tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify(value,null,2)+"\n");fs.renameSync(tmp,file);}
function validStage(stage){return !/(half.?time|\bht\b|finished|full.?time|\bft\b|after extra time|penalt|abandoned|cancelled|postponed|suspended)/i.test(String(stage||""));}
function confirmedRegular(outcome){
 const t=[outcome?.final_match?.status_text,outcome?.final_match?.stage,outcome?.final_match?.status].filter(Boolean).join(" ");
 return outcome?.source==="Flashscore"&&outcome?.status==="CONFIRMED"&&
 outcome?.status_confirmation==="confirmed_finished"&&outcome?.final_status==="FINISHED"&&
 !/penalt|extra time|\baet\b|abandoned|cancelled|postponed|suspended/i.test(t);
}
function labelLateFT(sample,rows,transitions,outcome){
 const minute=base.finite(sample?.snapshot?.live_minute);
 if(minute===null||minute<MINUTE_FROM||minute>MINUTE_TO||!confirmedRegular(outcome))return null;
 const effectiveStart=minute+LAG;
 for(const t of transitions){
  // A score change spanning the lag boundary cannot be assigned safely.
  if(t.from<effectiveStart&&t.to>=effectiveStart)return null;
  if(t.from>=effectiveStart)return 1;
 }
 const last=rows[rows.length-1],lastMinute=base.finite(last?.snapshot?.live_minute);
 // A negative is accepted only after a confirmed regular-time finish and
 // a final timeline observation at/after 90'. Otherwise it remains unresolved.
 if(lastMinute!==null&&lastMinute>=90)return 0;
 return null;
}

const FT_STATS={
 sot:/shots on target/i,shots:/^total shots$/i,corners:/corner kicks|^corners$/i,
 xg:/expected goals\\s*\\(xg\\)|^expected goals$|^xg$/i,
 big:/big chances/i,xgot:/xg on target|xgot/i,red:/red cards/i
};
function findPriorIndex(rows,index,minGap,maxGap){
 const current=base.finite(rows[index]?.snapshot?.live_minute);
 if(current===null)return -1;
 let best=-1,bestMinute=-Infinity;
 for(let i=0;i<index;i++){
  const m=base.finite(rows[i]?.snapshot?.live_minute),gap=current-m;
  if(m!==null&&gap>=minGap&&gap<=maxGap&&m>=bestMinute){best=i;bestMinute=m;}
 }
 return best;
}
function deltaStat(now,old){
 if(!now||!old)return 0;
 return Math.max(0,now.home-old.home)+Math.max(0,now.away-old.away);
}
function pressureDelta(d){
 const shotsOff=Math.max(0,d.shots-d.sot);
 return 3*d.sot+0.7*shotsOff+1.2*d.corners+2*d.xg;
}
function lateFTFeatureVector(row,rows,index){
 const core=base.featureVector(row,rows[index-1]||null);
 if(!core)return null;
 const minute=base.finite(row?.snapshot?.live_minute);
 const scoreHome=base.finite(row?.snapshot?.home_score),scoreAway=base.finite(row?.snapshot?.away_score);
 if(minute===null||scoreHome===null||scoreAway===null)return null;
 const currentStats=row?.snapshot?.stats||[];
 const current=Object.fromEntries(Object.entries(FT_STATS).map(([k,p])=>[k,base.statValue(currentStats,p)]));
 const fiveIndex=findPriorIndex(rows,index,4,8);
 const tenIndex=findPriorIndex(rows,index,9,13);
 const statsAt=i=>i<0?{}:Object.fromEntries(Object.entries(FT_STATS).map(([k,p])=>[k,base.statValue(rows[i]?.snapshot?.stats||[],p)]));
 const five=statsAt(fiveIndex),ten=statsAt(tenIndex);
 const keys=["sot","shots","corners","xg","big","xgot"];
 const d5=Object.fromEntries(keys.map(k=>[k,deltaStat(current[k],five[k])]));
 const dPrev=Object.fromEntries(keys.map(k=>[k,deltaStat(five[k],ten[k])]));
 const p5=pressureDelta(d5),pPrev=pressureDelta(dPrev);
 const lead=scoreHome>scoreAway?1:scoreAway>scoreHome?-1:0;
 const band=Math.min(3,Math.floor((minute-65)/5));
 const red=current.red;
 return core.concat([
  lead===1?1:0,lead===0?1:0,lead===-1?1:0,
  Math.max(-1,Math.min(1,(scoreHome-scoreAway)/3)),
  Math.min(1,Math.abs(scoreHome-scoreAway)/3),
  Math.max(0,Math.min(1,(90-minute)/25)),
  band===0?1:0,band===1?1:0,band===2?1:0,band===3?1:0,
  Math.min(1,d5.sot/3),Math.min(1,d5.shots/8),Math.min(1,d5.corners/3),
  Math.min(1,d5.xg/1.5),Math.min(1,d5.big/2),Math.min(1,d5.xgot/2),
  Math.max(-1,Math.min(1,(d5.sot-dPrev.sot)/3)),
  Math.max(-1,Math.min(1,(d5.shots-dPrev.shots)/8)),
  Math.max(-1,Math.min(1,(p5-pPrev)/15)),
  Math.min(1,p5/15),
  red?Math.max(-1,Math.min(1,(red.home-red.away)/2)):0
 ]);
}
function buildLateFTSamples(rows,outcomes,startedAt){
 const grouped=new Map();
 for(const row of rows){
  const id=String(row?.match_id||""),time=Date.parse(row?.snapshot?.collected_at||"");
  if(!id||!Number.isFinite(time)||time<startedAt||!validStage(row?.snapshot?.stage))continue;
  if(!grouped.has(id))grouped.set(id,[]);
  grouped.get(id).push(row);
 }
 const samples=[];
 for(const [matchId,matchRows] of grouped){
  matchRows.sort((a,b)=>Date.parse(a.snapshot.collected_at)-Date.parse(b.snapshot.collected_at));
  const outcome=outcomes?.matches?.[matchId.replace(/^flashscore:/,"")];
  if(!confirmedRegular(outcome))continue;
  const tr=base.goalTransitions(matchRows);
  if(tr.invalid)continue;
  // One latest usable observation per five-minute window, matching the live selector's capture cadence.
  const chosenByWindow=new Map();
  for(let i=0;i<matchRows.length;i++){
   const minute=base.finite(matchRows[i]?.snapshot?.live_minute);
   if(minute>=MINUTE_FROM&&minute<=MINUTE_TO&&lateFTFeatureVector(matchRows[i],matchRows,i))
    chosenByWindow.set(Math.floor(minute/5)*5,i);
  }
  for(const [windowStart,chosen] of chosenByWindow){
   const row=matchRows[chosen],y=labelLateFT(row,matchRows,tr.transitions,outcome);
   if(y===null)continue;
   samples.push({id:matchId+"|"+row.snapshot.collected_at+"|"+windowStart+"_FT",match_id:matchId,
    x:lateFTFeatureVector(row,matchRows,chosen),y,
    split:base.stableValidationMatch(matchId)?"validation":"train"});
  }
 }
 return samples;
}
async function run(dataDir=DATA,nowDate=new Date()){
 const modelPath=path.join(dataDir,FILE),existing=read(modelPath,null);
 if(existing&&(existing.source!=="Flashscore"||existing.mode!=="FORWARD_ONLY_LIVE_TRAINING_LATE_FT"))
  throw new Error("Neplatný samostatný late FT model; odmietam prepísať.");
 const startedAt=existing?Date.parse(existing.started_at):nowDate.getTime();
 if(!Number.isFinite(startedAt))throw new Error("Neplatný čas aktivácie late FT tréningu.");
 const timeline=await base.readTimeline(dataDir,startedAt);
 const outcomes=read(path.join(dataDir,"flashscore-confirmed-outcomes.json"),{matches:{}});
 const samples=buildLateFTSamples(timeline,outcomes,startedAt);
 const trained=base.trainHorizon(samples);
 const output={schema_version:1,source:"Flashscore",mode:"FORWARD_ONLY_LIVE_TRAINING_LATE_FT",
  target:"At least one goal after the 5-minute effective decision lag until confirmed regular-time full-time",
  started_at:new Date(startedAt).toISOString(),updated_at:nowDate.toISOString(),
  lag_minutes:LAG,observation_minute_range:[MINUTE_FROM,MINUTE_TO],
  sample_policy:"One latest eligible snapshot per five-minute window from 65' to 85', captured after activation. No historical backfill. Goals observed at or crossing the lag boundary and non-regular-time/abandoned matches are excluded.",
  feature_version:"late_ft_pressure_v2: 16 core live features plus score state, time bands, five-minute stat deltas, pressure acceleration and red-card balance; no future snapshots are used.",
  validation_policy:trained.validation_policy||{min_train_samples:500,min_validation_samples:300,min_train_matches:100,min_validation_matches:50,min_relative_log_loss_gain:0.01,min_relative_brier_gain:0.005,metrics_weighted_per_match:true},
  calibration_policy:{min_effective_match_weight:8,max_absolute_error:0.08,abstain_outside_reliable_bins:true},
  total_labeled_samples:samples.length,total_labeled_matches:new Set(samples.map(row=>row.match_id)).size,model:trained,
  status:trained.status==="SHADOW_VALIDATED"?"SHADOW_VALIDATED":"COLLECTING_OR_NOT_VALIDATED"};
 write(modelPath,output);
 return {started_at:output.started_at,total_labeled_matches:samples.length,status:output.status,model:trained};
}
if(require.main===module)run().then(x=>console.log("AI EDGE LATE FT TRAINER",JSON.stringify(x))).catch(e=>{console.error("AI EDGE LATE FT TRAINER FAILED:",e.message);process.exit(1);});
module.exports={confirmedRegular,labelLateFT,lateFTFeatureVector,buildLateFTSamples,run};

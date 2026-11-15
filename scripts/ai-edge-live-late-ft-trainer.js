"use strict";
// Independent forward-only model: probability of >=1 goal after the 5-minute
// observation lag from a LIVE snapshot at 70'-85' until regulation full-time.
const fs=require("node:fs"),path=require("node:path");
const base=require("./ai-edge-live-online-trainer");
const DATA=path.resolve(__dirname,"..","data");
const FILE="ai-edge-live-late-ft-model.json";
const LAG=5,MINUTE_FROM=70,MINUTE_TO=85;
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(e){if(e.code==="ENOENT")return fallback;throw e;}}
function write(file,value){const tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify(value,null,2)+"\n");fs.renameSync(tmp,file);}
function validStage(stage){return !/(half.?time|\bht\b|finished|full.?time|\bft\b|after extra time|penalt|abandoned|cancelled|postponed|suspended)/i.test(String(stage||""));}
function confirmedRegular(outcome){
 const t=String(outcome?.final_match?.status_text||"");
 return outcome?.source==="Flashscore"&&outcome?.status==="CONFIRMED"&&
 outcome?.status_confirmation==="confirmed_finished"&&outcome?.final_status==="FINISHED"&&
 !/penalt|extra time|\\baet\\b|abandoned|cancelled|postponed|suspended/i.test(t);
}
function labelLateFT(sample,rows,transitions,outcome){
 const minute=base.finite(sample?.snapshot?.live_minute);
 if(minute===null||minute<MINUTE_FROM||minute>MINUTE_TO||!confirmedRegular(outcome))return null;
 const effectiveStart=minute+LAG;
 for(const t of transitions){
  // A score change spanning the lag boundary cannot be assigned safely.
  if(t.from<effectiveStart&&t.to>effectiveStart)return null;
  if(t.from>=effectiveStart)return 1;
 }
 const last=rows[rows.length-1],lastMinute=base.finite(last?.snapshot?.live_minute);
 // A negative is accepted only after a confirmed regular-time finish and
 // a final timeline observation at/after 90'. Otherwise it remains unresolved.
 if(lastMinute!==null&&lastMinute>=90)return 0;
 return null;
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
  // One sample per match: latest usable observation between 70' and 85'.
  let chosen=-1;
  for(let i=0;i<matchRows.length;i++){
   const minute=base.finite(matchRows[i]?.snapshot?.live_minute);
   if(minute>=MINUTE_FROM&&minute<=MINUTE_TO&&base.featureVector(matchRows[i],matchRows[i-1]))chosen=i;
  }
  if(chosen<0)continue;
  const row=matchRows[chosen],y=labelLateFT(row,matchRows,tr.transitions,outcome);
  if(y===null)continue;
  samples.push({id:matchId+"|"+row.snapshot.collected_at+"|70_FT",match_id:matchId,
   x:base.featureVector(row,matchRows[chosen-1]),y,
   split:base.stableValidationMatch(matchId)?"validation":"train"});
 }
 return samples;
}
async function run(dataDir=DATA,nowDate=new Date()){
 const modelPath=path.join(dataDir,FILE),existing=read(modelPath,null);
 if(existing&&(existing.source!=="Flashscore"||existing.mode!=="FORWARD_ONLY_LIVE_TRAINING_LATE_FT"))
  throw new Error("Neplatný samostatný 70+ FT model; odmietam prepísať.");
 const startedAt=existing?Date.parse(existing.started_at):nowDate.getTime();
 if(!Number.isFinite(startedAt))throw new Error("Neplatný čas aktivácie 70+ FT tréningu.");
 const timeline=await base.readTimeline(dataDir,startedAt);
 const outcomes=read(path.join(dataDir,"flashscore-confirmed-outcomes.json"),{matches:{}});
 const samples=buildLateFTSamples(timeline,outcomes,startedAt);
 const trained=base.trainHorizon(samples);
 const output={schema_version:1,source:"Flashscore",mode:"FORWARD_ONLY_LIVE_TRAINING_LATE_FT",
  target:"At least one goal after the 5-minute effective decision lag until confirmed regular-time full-time",
  started_at:new Date(startedAt).toISOString(),updated_at:nowDate.toISOString(),
  lag_minutes:LAG,observation_minute_range:[MINUTE_FROM,MINUTE_TO],
  sample_policy:"One latest eligible snapshot per match, captured after activation. No historical backfill. Ambiguous goals crossing the lag boundary and non-regular-time/abandoned matches are excluded.",
  validation_policy:trained.validation_policy||{min_train_samples:500,min_validation_samples:300,min_train_matches:100,min_validation_matches:50,min_relative_log_loss_gain:0.01,min_relative_brier_gain:0.005,metrics_weighted_per_match:true},
  calibration_policy:{min_effective_match_weight:8,max_absolute_error:0.08,abstain_outside_reliable_bins:true},
  total_labeled_matches:samples.length,model:trained,
  status:trained.status==="SHADOW_VALIDATED"?"SHADOW_VALIDATED":"COLLECTING_OR_NOT_VALIDATED"};
 write(modelPath,output);
 return {started_at:output.started_at,total_labeled_matches:samples.length,status:output.status,model:trained};
}
if(require.main===module)run().then(x=>console.log("AI EDGE LATE FT TRAINER",JSON.stringify(x))).catch(e=>{console.error("AI EDGE LATE FT TRAINER FAILED:",e.message);process.exit(1);});
module.exports={confirmedRegular,labelLateFT,buildLateFTSamples,run};

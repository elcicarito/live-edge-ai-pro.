"use strict";
// Independent FT EARLY shadow trainer: goal after a 5-minute decision lag
// from a Flashscore snapshot in minutes 45-55 until regular-time full-time.
const fs=require("node:fs"),path=require("node:path");
const base=require("./ai-edge-live-online-trainer");
const late=require("./ai-edge-live-late-ft-trainer");
const DEFAULT_DATA=path.resolve(__dirname,"..","data");
const FILE="ai-edge-ft-early-shadow-model.json";
const FROM=45,TO=55,LAG=5;
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(e){if(e.code==="ENOENT")return fallback;throw e;}}
function write(file,value){const tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify(value,null,2)+"\n");fs.renameSync(tmp,file);}
function label(sample,rows,transitions,outcome){
 const minute=base.finite(sample?.snapshot?.live_minute);
 if(minute===null||minute<FROM||minute>TO||!late.confirmedRegular(outcome))return null;
 const start=minute+LAG;
 for(const t of transitions){
  if(t.from<start&&t.to>=start)return null;
  if(t.from>=start)return 1;
 }
 const last=base.finite(rows.at(-1)?.snapshot?.live_minute);
 return last!==null&&last>=90?0:null;
}
function buildSamples(rows,outcomes,startedAt){
 const grouped=new Map();
 for(const row of rows){
  const id=String(row?.match_id||""),ts=Date.parse(row?.snapshot?.collected_at||"");
  if(!id||!Number.isFinite(ts)||ts<startedAt||!row.snapshot)continue;
  if(!grouped.has(id))grouped.set(id,[]);
  grouped.get(id).push(row);
 }
 const samples=[];
 for(const [matchId,matchRows] of grouped){
  matchRows.sort((a,b)=>Date.parse(a.snapshot.collected_at)-Date.parse(b.snapshot.collected_at));
  const outcome=outcomes?.matches?.[matchId.replace(/^flashscore:/,"")];
  if(!late.confirmedRegular(outcome))continue;
  const transitions=base.goalTransitions(matchRows);if(transitions.invalid)continue;
  const buckets=new Map();
  for(let i=0;i<matchRows.length;i++){
   const minute=base.finite(matchRows[i]?.snapshot?.live_minute);
   if(minute===null||minute<FROM||minute>TO)continue;
   const x=late.lateFTFeatureVector(matchRows[i],matchRows,i);if(!x)continue;
   buckets.set(Math.floor(minute/5)*5,i);
  }
  for(const [bucket,i] of buckets){
   const row=matchRows[i],y=label(row,matchRows,transitions.transitions,outcome);
   if(y===null)continue;
   const x=late.lateFTFeatureVector(row,matchRows,i);
   // The inherited four-band feature is intentionally pinned to band 0
   // (the earliest band) for all 45-55 observations.
   const core=base.featureVector(row,matchRows[i-1]||null);
   const offset=core?core.length+6:-1;
   if(offset>=0&&offset+3<x.length){x.fill(0,offset,offset+4);x[offset]=1;}
   samples.push({id:matchId+"|"+row.snapshot.collected_at+"|"+bucket+"_FT_EARLY",match_id:matchId,x,y,split:base.stableValidationMatch(matchId)?"validation":"train",minute});
  }
 }
 return samples;
}
async function run(dataDir=DEFAULT_DATA,nowDate=new Date()){
 fs.mkdirSync(dataDir,{recursive:true});
 const modelPath=path.join(dataDir,FILE),existing=read(modelPath,null);
 if(existing&&(existing.source!=="Flashscore"||existing.mode!=="FORWARD_ONLY_LIVE_TRAINING_FT_EARLY_45_55"))
  throw new Error("Invalid FT EARLY shadow model; refusing to overwrite.");
 const startedAt=existing?Date.parse(existing.started_at):nowDate.getTime();
 if(!Number.isFinite(startedAt))throw new Error("Invalid FT EARLY activation timestamp.");
 const timeline=await base.readTimeline(dataDir,startedAt);
 const outcomes=read(path.join(dataDir,"flashscore-confirmed-outcomes.json"),{matches:{}});
 const samples=buildSamples(timeline,outcomes,startedAt);
 const trained=base.trainHorizon(samples);
 const output={schema_version:1,source:"Flashscore",mode:"FORWARD_ONLY_LIVE_TRAINING_FT_EARLY_45_55",
  target:"At least one goal after the 5-minute effective decision lag until confirmed regular-time full-time",
  started_at:new Date(startedAt).toISOString(),updated_at:nowDate.toISOString(),lag_minutes:LAG,
  observation_minute_range:[FROM,TO],sample_policy:"Prospective only: snapshots captured after activation; latest eligible snapshot in each five-minute bucket; forward-only labels; goals crossing the five-minute decision boundary and non-regular-time matches excluded.",
  feature_version:"late_ft_pressure_v2_early_band0; same 38-feature family as late FT; no future snapshots used.",
  validation_policy:trained.validation_policy||{min_train_samples:500,min_validation_samples:300,min_train_matches:100,min_validation_matches:50,min_relative_log_loss_gain:0.01,min_relative_brier_gain:0.005,metrics_weighted_per_match:true},
  calibration_policy:{min_effective_match_weight:8,max_absolute_error:0.08,abstain_outside_reliable_bins:true},
  total_labeled_samples:samples.length,total_labeled_matches:new Set(samples.map(x=>x.match_id)).size,
  training_samples:samples.filter(x=>x.split==="train").length,validation_samples:samples.filter(x=>x.split==="validation").length,
  model:trained,status:trained.status==="SHADOW_VALIDATED"?"SHADOW_VALIDATED":"COLLECTING_OR_NOT_VALIDATED",
  live_tips_enabled:false,production_model_modified:false};
 write(modelPath,output);
 return {started_at:output.started_at,updated_at:output.updated_at,samples:output.total_labeled_samples,matches:output.total_labeled_matches,status:output.status,live_tips_enabled:false};
}
if(require.main===module)run(process.argv[2]||DEFAULT_DATA).then(x=>console.log("FT EARLY 45-55 SHADOW",JSON.stringify(x))).catch(e=>{console.error("FT EARLY SHADOW FAILED:",e.stack||e);process.exit(1);});
module.exports={buildSamples,run};

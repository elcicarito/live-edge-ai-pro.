"use strict";
// One-time frozen FT EARLY 45-55 model built from the historical Flashscore audit.
// Once written to the permanent data branch, the model is never retrained by the live collector.
const fs=require("node:fs"),path=require("node:path");
const base=require("./ai-edge-live-online-trainer");
const late=require("./ai-edge-live-late-ft-trainer");
const DATA=path.resolve(__dirname,"..","data"),FILE="ai-edge-ft-early-shadow-model.json";
const FROM=45,TO=55,LAG=5,MODE="HISTORICAL_AUDIT_LOCKED_FT_EARLY_45_55";
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(e){if(e.code==="ENOENT")return fallback;throw e;}}
function write(file,value){const tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify(value,null,2)+"\\n");fs.renameSync(tmp,file);}
function buildSamples(rows,outcomes,startedAt){
 const grouped=new Map();
 for(const row of rows){
  const id=String(row?.match_id||""),time=Date.parse(row?.snapshot?.collected_at||"");
  if(!id||!Number.isFinite(time)||time<startedAt||!row.snapshot)continue;
  if(!grouped.has(id))grouped.set(id,[]);
  grouped.get(id).push(row);
 }
 const samples=[];
 for(const [matchId,matchRows] of grouped){
  matchRows.sort((a,b)=>Date.parse(a.snapshot.collected_at)-Date.parse(b.snapshot.collected_at));
  const outcome=outcomes?.matches?.[matchId.replace(/^flashscore:/,"")];
  if(!late.confirmedRegular(outcome))continue;
  const tr=base.goalTransitions(matchRows);if(tr.invalid)continue;
  const chosen=new Map();
  for(let i=0;i<matchRows.length;i++){
   const minute=base.finite(matchRows[i]?.snapshot?.live_minute);
   if(minute===null||minute<FROM||minute>=TO)continue;
   if(late.lateFTFeatureVector(matchRows[i],matchRows,i))chosen.set(Math.floor(minute/5)*5,i);
  }
  for(const [bucket,index] of chosen){
   const row=matchRows[index],minute=base.finite(row.snapshot.live_minute),effective=minute+LAG;
   let y=null,crossed=false;
   for(const t of tr.transitions){
    if(t.from<effective&&t.to>=effective){crossed=true;break;}
    if(t.from>=effective){y=1;break;}
    y=0;
   }
   if(y===null&&!crossed){
    const last=base.finite(matchRows.at(-1)?.snapshot?.live_minute);
    if(last!==null&&last>=90)y=0;
   }
   if(y===null)continue;
   const x=late.lateFTFeatureVector(row,matchRows,index);if(!x)continue;
   // Same historical audit vector: 16 core + 6 score/time + 4 time-band features.
   x.fill(0,22,26);x[22]=1;
   samples.push({id:matchId+"|"+row.snapshot.collected_at+"|"+bucket+"_FT_EARLY",match_id:matchId,x,y,split:base.stableValidationMatch(matchId)?"validation":"train",minute});
  }
 }
 return samples;
}
async function run(dataDir=DATA,nowDate=new Date()){
 fs.mkdirSync(dataDir,{recursive:true});
 const modelPath=path.join(dataDir,FILE),existing=read(modelPath,null);
 if(existing){
  if(existing.source!=="Flashscore"||existing.mode!==MODE||!Array.isArray(existing.model?.weights))throw new Error("Invalid frozen FT EARLY audit model; refusing to overwrite.");
  return{created:false,started_at:existing.started_at,updated_at:existing.updated_at,samples:existing.total_labeled_samples,matches:existing.total_labeled_matches,status:existing.status};
 }
 const lateModel=read(path.join(dataDir,"ai-edge-live-late-ft-model.json"),null);
 if(lateModel?.source!=="Flashscore"||lateModel?.mode!=="FORWARD_ONLY_LIVE_TRAINING_LATE_FT")throw new Error("Missing Flashscore late-FT audit baseline.");
 const startedAt=Date.parse(lateModel.started_at);
 if(!Number.isFinite(startedAt))throw new Error("Invalid historical audit start timestamp.");
 const timeline=await base.readTimeline(dataDir,startedAt);
 const outcomes=read(path.join(dataDir,"flashscore-confirmed-outcomes.json"),{matches:{}});
 const samples=buildSamples(timeline,outcomes,startedAt),trained=base.trainHorizon(samples);
 if(trained.status!=="SHADOW_VALIDATED"||!Array.isArray(trained.weights)||trained.weights.length!==38) {
  throw new Error("Historical FT EARLY 45-55 audit did not reproduce its validated model: "+JSON.stringify({samples:samples.length,status:trained.status,counts:trained.counts,calibration_gate:trained.calibration_gate}));
 }
 const validation=samples.filter(x=>x.split==="validation"),positive=validation.filter(x=>x.y===1).length;
 const output={
  schema_version:1,source:"Flashscore",mode:MODE,target:"At least one goal after the five-minute decision lag until confirmed regular-time full-time",
  started_at:new Date(startedAt).toISOString(),updated_at:nowDate.toISOString(),lag_minutes:LAG,observation_minute_range:[FROM,TO],
  sample_policy:"Frozen historical audit model: latest eligible Flashscore snapshot in each five-minute bucket from 45' inclusive to 55' exclusive; confirmed regular-time outcomes only; score changes crossing the five-minute decision boundary excluded; match-level deterministic train/validation split.",
  feature_version:"late_ft_pressure_v2 with fixed 45-55 minute band; 38 features identical to the historical FT capture-window audit.",
  historical_audit:{samples:samples.length,matches:new Set(samples.map(x=>x.match_id)).size,validation_samples:validation.length,validation_matches:new Set(validation.map(x=>x.match_id)).size,validation_accuracy:trained.metrics?.accuracy??null,validation_goal_rate:validation.length?Number((positive/validation.length).toFixed(4)):null,metrics:trained.metrics,calibration_gate:trained.calibration_gate},
  validation_policy:trained.validation_policy,
  calibration_policy:{min_effective_match_weight:8,max_absolute_error:0.08,abstain_outside_reliable_bins:true},
  total_labeled_samples:samples.length,total_labeled_matches:new Set(samples.map(x=>x.match_id)).size,
  model:trained,status:"SHADOW_VALIDATED",live_tips_enabled:false,production_model_modified:false,model_frozen:true
 };
 write(modelPath,output);
 return{created:true,started_at:output.started_at,updated_at:output.updated_at,samples:output.total_labeled_samples,matches:output.total_labeled_matches,status:output.status,validation_matches:trained.counts.validation_matches};
}
if(require.main===module)run(process.argv[2]||DATA).then(x=>console.log("FT EARLY HISTORICAL AUDIT MODEL",JSON.stringify(x))).catch(e=>{console.error("FT EARLY HISTORICAL MODEL FAILED:",e.stack||e);process.exit(1);});
module.exports={buildSamples,run,MODE};

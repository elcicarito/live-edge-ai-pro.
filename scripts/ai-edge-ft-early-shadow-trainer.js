"use strict";
// Independent prospective FT EARLY 45-55 shadow model.
const fs=require("node:fs"),path=require("node:path");
const base=require("./ai-edge-live-online-trainer");
const late=require("./ai-edge-live-late-ft-trainer");
const DATA=path.resolve(__dirname,"..","data"),FILE="ai-edge-ft-early-shadow-model.json";
const FROM=45,TO=55,LAG=5;
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(e){if(e.code==="ENOENT")return fallback;throw e;}}
function write(file,value){const tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify(value,null,2)+"\n");fs.renameSync(tmp,file);}
function buildSamples(rows,outcomes,startedAt){
 const grouped=new Map();
 for(const row of rows){const id=String(row?.match_id||""),time=Date.parse(row?.snapshot?.collected_at||"");if(!id||!Number.isFinite(time)||time<startedAt)continue;if(!grouped.has(id))grouped.set(id,[]);grouped.get(id).push(row);}
 const samples=[];
 for(const [matchId,matchRows] of grouped){
  matchRows.sort((a,b)=>Date.parse(a.snapshot.collected_at)-Date.parse(b.snapshot.collected_at));
  const outcome=outcomes?.matches?.[matchId.replace(/^flashscore:/,"")];if(!late.confirmedRegular(outcome))continue;
  const tr=base.goalTransitions(matchRows);if(tr.invalid)continue;
  const chosen=new Map();
  for(let i=0;i<matchRows.length;i++){const minute=base.finite(matchRows[i]?.snapshot?.live_minute);if(minute===null||minute<FROM||minute>TO)continue;if(late.lateFTFeatureVector(matchRows[i],matchRows,i))chosen.set(Math.floor(minute/5)*5,i);}
  for(const [bucket,index] of chosen){
   const row=matchRows[index],minute=base.finite(row.snapshot.live_minute),effective=minute+LAG;let y=null;
   for(const t of tr.transitions){if(t.from<effective&&t.to>=effective){y=null;break;}if(t.from>=effective){y=1;break;}}
   if(y===null&&!tr.transitions.some(t=>t.from<effective&&t.to>=effective)){
    const last=base.finite(matchRows.at(-1)?.snapshot?.live_minute);if(last!==null&&last>=90)y=0;
   }
   if(y===null)continue;
   const x=late.lateFTFeatureVector(row,matchRows,index);if(!x)continue;
   // late FT vector: core 16, score-state 6, time-band one-hot 4 at 22..25.
   x.fill(0,22,26);x[22]=1;
   samples.push({id:matchId+"|"+row.snapshot.collected_at+"|"+bucket+"_FT_EARLY",match_id:matchId,x,y,split:base.stableValidationMatch(matchId)?"validation":"train",minute});
  }
 }
 return samples;
}
async function run(dataDir=DATA,nowDate=new Date()){
 fs.mkdirSync(dataDir,{recursive:true});const modelPath=path.join(dataDir,FILE),old=read(modelPath,null);
 if(old&&(old.source!=="Flashscore"||old.mode!=="FORWARD_ONLY_LIVE_TRAINING_FT_EARLY_45_55"))throw new Error("Invalid FT EARLY model state; refusing to overwrite.");
 const startedAt=old?Date.parse(old.started_at):nowDate.getTime();if(!Number.isFinite(startedAt))throw new Error("Invalid FT EARLY activation timestamp.");
 const timeline=await base.readTimeline(dataDir,startedAt),outcomes=read(path.join(dataDir,"flashscore-confirmed-outcomes.json"),{matches:{}});
 const samples=buildSamples(timeline,outcomes,startedAt),trained=base.trainHorizon(samples);
 const output={schema_version:1,source:"Flashscore",mode:"FORWARD_ONLY_LIVE_TRAINING_FT_EARLY_45_55",
  target:"At least one goal after a five-minute decision lag until confirmed regular-time full-time",
  started_at:new Date(startedAt).toISOString(),updated_at:nowDate.toISOString(),lag_minutes:LAG,observation_minute_range:[FROM,TO],
  sample_policy:"Prospective only; snapshots captured after activation; latest usable snapshot in each five-minute bucket; goals at or crossing the five-minute decision boundary and non-regular-time matches excluded.",
  feature_version:"late_ft_pressure_v2 with fixed 45-55 minute band; same 38-feature family as late FT.",
  validation_policy:trained.validation_policy||{min_train_samples:500,min_validation_samples:300,min_train_matches:100,min_validation_matches:50,min_relative_log_loss_gain:0.01,min_relative_brier_gain:0.005},
  calibration_policy:{min_effective_match_weight:8,max_absolute_error:0.08,experimental_max_absolute_error:0.5},
  total_labeled_samples:samples.length,total_labeled_matches:new Set(samples.map(x=>x.match_id)).size,
  model:trained,status:trained.status==="SHADOW_VALIDATED"?"SHADOW_VALIDATED":trained.status==="NOT_VALIDATED"?"NOT_VALIDATED":"COLLECTING",
  live_tips_enabled:false,production_model_modified:false};
 write(modelPath,output);
 return{started_at:output.started_at,updated_at:output.updated_at,samples:output.total_labeled_samples,matches:output.total_labeled_matches,status:output.status,live_tips_enabled:false};
}
if(require.main===module)run(process.argv[2]||DATA).then(x=>console.log("FT EARLY 45-55 SHADOW",JSON.stringify(x))).catch(e=>{console.error("FT EARLY SHADOW FAILED:",e.stack||e);process.exit(1);});
module.exports={buildSamples,run};

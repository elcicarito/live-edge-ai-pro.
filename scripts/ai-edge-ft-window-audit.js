"use strict";
const fs=require("node:fs"),path=require("node:path");
const base=require("./ai-edge-live-online-trainer");
const late=require("./ai-edge-live-late-ft-trainer");
const DATA=process.argv[2]||path.resolve(__dirname,"..","data");
const OUT=process.argv[3]||path.resolve(__dirname,"..","audit-output");
const MODEL=JSON.parse(fs.readFileSync(path.join(DATA,"ai-edge-live-late-ft-model.json"),"utf8"));
const OUTCOMES=JSON.parse(fs.readFileSync(path.join(DATA,"flashscore-confirmed-outcomes.json"),"utf8"));
const BANDS=[{name:"45-55",from:45,to:55},{name:"55-65",from:55,to:65},{name:"65-75",from:65,to:75},{name:"75-85",from:75,to:86}];
function confirmed(o){return late.confirmedRegular(o);}
function makeSamples(rows,band){
 const grouped=new Map();
 for(const row of rows){
  const id=String(row?.match_id||""),ts=Date.parse(row?.snapshot?.collected_at||"");
  if(!id||!Number.isFinite(ts)||ts<Date.parse(MODEL.started_at)||!row.snapshot)continue;
  if(!grouped.has(id))grouped.set(id,[]);
  grouped.get(id).push(row);
 }
 const samples=[];
 for(const [matchId,matchRows] of grouped){
  matchRows.sort((a,b)=>Date.parse(a.snapshot.collected_at)-Date.parse(b.snapshot.collected_at));
  const outcome=OUTCOMES.matches?.[matchId.replace(/^flashscore:/,"")];
  if(!confirmed(outcome))continue;
  const tr=base.goalTransitions(matchRows);if(tr.invalid)continue;
  const chosen=new Map();
  for(let i=0;i<matchRows.length;i++){
   const minute=base.finite(matchRows[i]?.snapshot?.live_minute);
   if(minute===null||minute<band.from||minute>=band.to)continue;
   const x=late.lateFTFeatureVector(matchRows[i],matchRows,i);if(!x)continue;
   chosen.set(Math.floor(minute/5)*5,i);
  }
  for(const [bucket,i] of chosen){
   const row=matchRows[i],minute=base.finite(row.snapshot.live_minute),effective=minute+MODEL.lag_minutes;
   let label=null;
   for(const t of tr.transitions){
    if(t.from<effective&&t.to>=effective){label=null;break;}
    if(t.from>=effective){label=1;break;}
    label=0;
   }
   if(label===null&&!(tr.transitions.some(t=>t.from<effective&&t.to>=effective))){
    const last=base.finite(matchRows.at(-1)?.snapshot?.live_minute);
    if(last!==null&&last>=90)label=0;
   }
   if(label===null)continue;
   const x=late.lateFTFeatureVector(row,matchRows,i);
   const core=base.featureVector(row,matchRows[i-1]||null);\n   const bandOffset=core?core.length+6:-1; // four one-hot time-window slots follow six score/time features
   if(bandOffset>=0&&bandOffset+3<x.length){
    x.fill(0,bandOffset,bandOffset+4);
    const slot=band.name==="45-55"?0:band.name==="55-65"?1:band.name==="65-75"?2:3;
    x[bandOffset+slot]=1;
   }
   samples.push({id:matchId+"|"+row.snapshot.collected_at+"|"+bucket+"_FT_AUDIT",match_id:matchId,x,y:label,split:base.stableValidationMatch(matchId)?"validation":"train",minute});
  }
 }
 return samples;
}
function summarise(samples,trained){
 const count=key=>samples.filter(x=>x.split===key).length;
 const decided=samples.length,positive=samples.filter(x=>x.y===1).length;
 const val=samples.filter(x=>x.split==="validation"),valPositive=val.filter(x=>x.y===1).length;
 return {samples:decided,matches:new Set(samples.map(x=>x.match_id)).size,positive,negative:decided-positive,raw_goal_rate:decided?Number((positive/decided).toFixed(4)):null,train_samples:count("train"),validation_samples:count("validation"),validation_matches:new Set(val.map(x=>x.match_id)).size,validation_goal_rate:val.length?Number((valPositive/val.length).toFixed(4)):null,model_status:trained.status,model_counts:trained.counts,validation_metrics:trained.metrics?{accuracy:trained.metrics.accuracy,brier:trained.metrics.brier,baseline_brier:trained.metrics.baseline_brier,log_loss:trained.metrics.log_loss,baseline_log_loss:trained.metrics.baseline_log_loss,relative_brier_gain:trained.metrics.relative_brier_gain,relative_log_loss_gain:trained.metrics.relative_log_loss_gain,calibration:trained.metrics.calibration}:null,calibration_gate:trained.calibration_gate||null};
}
(async()=>{
 const timeline=await base.readTimeline(DATA,Date.parse(MODEL.started_at));
 const results=[];
 for(const band of BANDS){const samples=makeSamples(timeline,band);const trained=base.trainHorizon(samples);results.push({window:band.name,range_minutes:[band.from,band.to],...summarise(samples,trained)});}
 fs.mkdirSync(OUT,{recursive:true});
 const report={source:"Flashscore",started_at:MODEL.started_at,updated_at:MODEL.updated_at,lag_minutes:MODEL.lag_minutes,selection:"Latest eligible snapshot in each five-minute bucket; forward-only, confirmed regular-time matches; uncertain goals crossing the five-minute decision boundary excluded; split by match.",timeline_rows:timeline.length,windows:results};
 fs.writeFileSync(path.join(OUT,"ai-edge-ft-window-audit.json"),JSON.stringify(report,null,2)+"\n");
 const lines=["# FT capture-window audit","",`Data source: Flashscore | model activation: ${MODEL.started_at} | decision lag: ${MODEL.lag_minutes} minutes`,"","Each band uses the same label, five-minute lag, snapshot cadence, feature set and match-level train/validation split. This is a retrospective comparison, not live deployment.", "", "| Window | Samples | Matches | Goal rate | Validation matches | Validation goal rate | Model | Brier gain | Log-loss gain |","|---|---:|---:|---:|---:|---:|---|---:|---:|"];
 for(const r of results)lines.push(`| ${r.window} | ${r.samples} | ${r.matches} | ${r.raw_goal_rate??"—"} | ${r.validation_matches} | ${r.validation_goal_rate??"—"} | ${r.model_status} | ${r.validation_metrics?.relative_brier_gain??"—"} | ${r.validation_metrics?.relative_log_loss_gain??"—"} |`);
 lines.push("","## Interpretation","Raw goal rate is descriptive only; compare model validation metrics and sample sizes. Do not move the live capture window unless an earlier band has adequate independent validation and calibration.");
 fs.writeFileSync(path.join(OUT,"ai-edge-ft-window-audit.md"),lines.join("\n")+"\n");
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exit(1);});

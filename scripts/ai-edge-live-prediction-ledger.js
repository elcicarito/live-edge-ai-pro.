"use strict";
const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib");
const DATA=path.resolve(__dirname,"..","data");
const lateFTTrainer=require("./ai-edge-live-late-ft-trainer");
const DISPLAY_DELAY_MINUTES=5;
const TARGETS=[{id:15,label:"Gól do 15 min",threshold:45},{id:25,label:"Gól do 25 min",threshold:35},{id:"MODEL_15",label:"AI Edge · gól do 15 min (tieňový model)",threshold:0},{id:"MODEL_25",label:"AI Edge · gól do 25 min (tieňový model)",threshold:0},{id:"MODEL_FT",label:"AI Edge · gól do konca zápasu (tieňový model)",threshold:0},{id:"FT",label:"Gól do konca zápasu",threshold:40},{id:"NEXT_TEAM",label:"Ďalší skórujúci tím",threshold:40},{id:"BTTS",label:"BTTS · oba tímy skórujú",threshold:40},{id:"RESULT_1X2",label:"1X2 · konečný výsledok",threshold:0}];
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(e){if(e.code==="ENOENT")return fallback;throw e;}}
function write(file,value){const tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify(value,null,2)+"\n");fs.renameSync(tmp,file);}
function readHistory(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(e){if(e.code!=="ENOENT")throw e;}try{return JSON.parse(zlib.gunzipSync(fs.readFileSync(file+".gz")).toString("utf8"));}catch(e){if(e.code==="ENOENT")return fallback;throw e;}}
function writeCompressedHistory(file,value){const target=file+".gz",tmp=target+".tmp";const bytes=zlib.gzipSync(Buffer.from(JSON.stringify(value,null,2)+"\n"),{level:9});fs.writeFileSync(tmp,bytes);fs.renameSync(tmp,target);fs.rmSync(file,{force:true});}
function num(v){if(v===null||v===undefined||String(v).trim()==="")return null;const n=Number(String(v).replace("%","").replace(",","."));return Number.isFinite(n)?n:null;}
const defs={sot:[/shots on target/i,/strely na bránu/i],shots:[/total shots/i,/shots off target/i,/celkové strely/i],off:[/shots off target/i],corners:[/corner kicks/i,/corners/i,/rohov/i],possession:[/ball possession/i,/possession/i,/držanie lopty/i],xg:[/expected goals\s*\(xg\)/i,/^expected goals$/i,/^xg$/i],xgot:[/xg on target/i],box:[/shots inside the box/i],touches:[/touches in opposition box/i],big:[/big chances/i]};
function stat(stats,tests){if(!Array.isArray(stats))return null;const x=stats.find(s=>tests.some(r=>r.test(String(s.label||s.name||"")))&&(!s.period||String(s.period).toLowerCase()==="match"));if(!x)return null;const h=num(x.home_numeric??x.home),a=num(x.away_numeric??x.away);return h===null||a===null?null:{home:h,away:a};}
const modelDefs={
xg:[/expected goals\s*\(xg\)|^expected goals$|^xg$/i],
sot:[/shots on target/i],
shots:[/^total shots$/i],
corners:[/corner kicks|^corners$/i],
possession:[/ball possession|^possession$/i],
big:[/big chances/i],
xgot:[/xg on target|xgot/i],
red:[/red cards/i]
};
function modelFeatureVector(m,history,collectedAt){
 const stats=m.stats||m.flashscore_stats||[],v={};
 for(const [k,re] of Object.entries(modelDefs))v[k]=stat(stats,re);
 const min=Number(m.live_minute),hs=num(m.home_score),as=num(m.away_score);
 if(!Number.isFinite(min)||hs===null||as===null||!v.sot||!v.shots)return null;
 const ct=Date.parse(collectedAt||"");
 const prev=(history||[]).filter(x=>String(x.match?.id)===String(m.id)&&Number(x.time)<ct).slice(-1)[0];
 const old=prev?.match?.stats||[];
 const os=stat(old,modelDefs.sot),osh=stat(old,modelDefs.shots),oc=stat(old,modelDefs.corners);
 const delta=(a,b)=>a&&b?Math.max(0,a.home-b.home)+Math.max(0,a.away-b.away):0;
 return [
 Math.min(1.2,min/90),Math.min(1,(hs+as)/5),
 Math.min(1,((v.xg?.home||0)+(v.xg?.away||0))/4),
 Math.max(-1,Math.min(1,((v.xg?.home||0)-(v.xg?.away||0))/3)),
 Math.min(1,(v.sot.home+v.sot.away)/12),
 Math.max(-1,Math.min(1,(v.sot.home-v.sot.away)/10)),
 Math.min(1,(v.shots.home+v.shots.away)/30),
 Math.max(-1,Math.min(1,(v.shots.home-v.shots.away)/20)),
 Math.min(1,((v.corners?.home||0)+(v.corners?.away||0))/16),
 Math.min(1,((v.big?.home||0)+(v.big?.away||0))/8),
 Math.min(1,((v.xgot?.home||0)+(v.xgot?.away||0))/5),
 Math.min(1,((v.red?.home||0)+(v.red?.away||0))/2),
 Math.min(1,Math.abs((v.possession?.home||50)-(v.possession?.away||50))/100),
 Math.min(1,delta(v.sot,os)/4),Math.min(1,delta(v.shots,osh)/8),Math.min(1,delta(v.corners,oc)/4)
 ];
}
function modelProbability(weights,x){
 if(!Array.isArray(weights)||!Array.isArray(x)||weights.length!==x.length+1)return null;
 let z=weights[0];for(let i=0;i<x.length;i++)z+=x[i]*weights[i+1];
 return 1/(1+Math.exp(-Math.max(-20,Math.min(20,z))));
}
function modelIsValidated(model,horizon=25){
 const item=model?.models?.[String(horizon)],policy=model?.validation_policy||{},counts=item?.counts||{},metrics=item?.metrics||{};
 return model?.source==="Flashscore"&&model?.mode==="FORWARD_ONLY_LIVE_TRAINING"&&
 item?.status==="SHADOW_VALIDATED"&&Array.isArray(item.weights)&&item.weights.length===17&&
 Number(counts.validation_matches)>=Math.max(50,Number(policy.min_validation_matches)||50)&&
 Number(counts.train_matches)>=Math.max(100,Number(policy.min_train_matches)||100)&&
 Number(metrics.relative_log_loss_gain)>=(Number(policy.min_relative_log_loss_gain)||0.01)&&
 Number(metrics.relative_brier_gain)>=(Number(policy.min_relative_brier_gain)||0.005);
}
function lateFTModelIsValidated(model){
 const item=model?.model,counts=item?.counts||{},metrics=item?.metrics||{},policy=model?.validation_policy||{};
 return model?.source==="Flashscore"&&model?.mode==="FORWARD_ONLY_LIVE_TRAINING_LATE_FT"&&
 item?.status==="SHADOW_VALIDATED"&&Array.isArray(item.weights)&&item.weights.length===38&&
 Number(counts.train)>=500&&Number(counts.validation)>=300&&
 Number(counts.train_matches)>=Math.max(100,Number(policy.min_train_matches)||100)&&
 Number(counts.validation_matches)>=Math.max(50,Number(policy.min_validation_matches)||50)&&
 Number(metrics.relative_log_loss_gain)>=(Number(policy.min_relative_log_loss_gain)||0.01)&&
 Number(metrics.relative_brier_gain)>=(Number(policy.min_relative_brier_gain)||0.005);
}
function lateFTFeatureVectorForMatch(m,history,collectedAt){
 const ct=Date.parse(collectedAt||"");
 if(!Number.isFinite(ct))return null;
 const rows=(history||[]).filter(x=>String(x.match?.id)===String(m.id)&&Number(x.time)<ct&&x.match)
  .map(x=>({snapshot:{collected_at:new Date(Number(x.time)).toISOString(),live_minute:num(x.match.live_minute),home_score:num(x.match.home_score),away_score:num(x.match.away_score),stage:x.match.stage||x.match.status_text||"",stats:x.match.stats||x.match.flashscore_stats||[]}}))
  .filter(x=>Number.isFinite(x.snapshot.live_minute)&&x.snapshot.home_score!==null&&x.snapshot.away_score!==null)
  .sort((a,b)=>Date.parse(a.snapshot.collected_at)-Date.parse(b.snapshot.collected_at));
 rows.push({snapshot:{collected_at:new Date(ct).toISOString(),live_minute:num(m.live_minute),home_score:num(m.home_score),away_score:num(m.away_score),stage:m.stage||m.status_text||"",stats:m.stats||m.flashscore_stats||[]}});
 return lateFTTrainer.lateFTFeatureVector(rows[rows.length-1],rows,rows.length-1);
}
function minimumOddsThreshold(probability,calibrationError,safetyMargin=0.05){
 if(!Number.isFinite(probability)||probability<=0||probability>=1||!Number.isFinite(calibrationError)||calibrationError<0||!Number.isFinite(safetyMargin)||safetyMargin<0||safetyMargin>=1)return null;
 const conservativeProbability=Math.max(0.01,probability-calibrationError);
 return Number((1/(conservativeProbability*(1-safetyMargin))).toFixed(2));
}
function modelCalibrationGate(modelItem,probability,model){
 const calibration=modelItem?.metrics?.calibration,policy=model?.calibration_policy||{};
 const minimumWeight=Number(policy.min_effective_match_weight)||8;
 const maximumError=Number.isFinite(Number(policy.max_absolute_error))?Number(policy.max_absolute_error):0.08;
 if(!Number.isFinite(probability)||probability<0||probability>1)return {allowed:false,reason:"invalid_probability"};
 if(!calibration||!Array.isArray(calibration.bins))return {allowed:false,reason:"calibration_missing"};
 const bin=calibration.bins.find(b=>{const parts=String(b.range||"").split("-").map(Number);return parts.length===2&&Number.isFinite(parts[0])&&Number.isFinite(parts[1])&&probability>=parts[0]/100&&(probability<parts[1]/100||(parts[1]===100&&probability<=1));});
 if(!bin)return {allowed:false,reason:"probability_bin_unobserved"};
 const weight=Number(bin.matches_weight)||0,error=Number(bin.absolute_error);
 if(weight<minimumWeight)return {allowed:false,reason:"insufficient_bin_support",bin:bin.range,matches_weight:weight};
 if(!Number.isFinite(error)||error>maximumError)return {allowed:false,reason:"poor_bin_calibration",bin:bin.range,matches_weight:weight,absolute_error:error};
 return {allowed:true,bin:bin.range,matches_weight:weight,absolute_error:error};
}
function features(m,history,collectedAt,now){const values={};for(const [k,re] of Object.entries(defs))values[k]=stat(m.stats||m.flashscore_stats||[],re);const ct=Date.parse(collectedAt||"");const prev=(history||[]).filter(x=>String(x.match?.id)===String(m.id)&&Number(x.time)<ct&&Array.isArray(x.match?.stats)&&x.match.stats.length).slice(-1)[0];const delta={home:0,away:0,minutes:null,ready:false};if(prev){const elapsed=(ct-Number(prev.time))/60000,old=prev.match.stats,os=stat(old,defs.sot),ot=stat(old,defs.shots),oc=stat(old,defs.corners);if(elapsed>0&&elapsed<=12&&values.sot&&values.shots&&os&&ot){const dif=(a,b,s)=>a&&b?Math.max(0,a[s]-b[s]):0;delta.home=dif(values.sot,os,"home")*12+dif(values.shots,ot,"home")*3+(values.corners&&oc?dif(values.corners,oc,"home")*2:0);delta.away=dif(values.sot,os,"away")*12+dif(values.shots,ot,"away")*3+(values.corners&&oc?dif(values.corners,oc,"away")*2:0);delta.minutes=elapsed;delta.ready=true;}}
const score=s=>{const v=k=>values[k]?.[s]??0,raw=v("sot")*9+v("off")*3+v("corners")*2+v("big")*11+v("xg")*13+(delta.ready?delta[s]:0),p=values.possession?.[s];return Math.max(0,Math.min(100,Math.round(raw+(p?Math.max(0,p-50)*.18:0))));};
const ts=Date.parse(m.stats_collected_at||m.match_collected_at||m.collected_at||collectedAt||""),age=Number.isFinite(ts)?Math.max(0,(now-ts)/60000):null,hasCore=!!(values.sot||values.shots||values.corners||values.xg||values.xgot||values.box||values.touches||values.big);
return{home:score("home"),away:score("away"),hasCore,age,ready:hasCore&&age!==null&&age<=12,values,delta};}
const goals=m=>(Number(m?.home_score)||0)+(Number(m?.away_score)||0),minute=m=>Number(m?.live_minute);
const isEnded=m=>/finished|ended|after penalties|abandoned|cancelled|postponed|suspended|\bft\b/i.test(String(m?.status||"")+" "+String(m?.status_text||"")+" "+String(m?.stage||""));
function nonReg(m){const t=String(m?.status_text||"")+" "+String(m?.stage||""),min=Number(m?.live_minute);return /after penalties|penalt(?:y|ies)|after extra time|\baet\b|abandoned|cancelled|postponed|suspended/i.test(t)||(Number.isFinite(min)&&min>100);}
function make(m,target,min,now,fx,extra={}){const hs=Number(m.home_score)||0,as=Number(m.away_score)||0,b=target==="FT"?"FT":target==="BTTS"?hs+":"+as:target==="RESULT_1X2"?Math.floor(min/10)+":"+hs+":"+as:Math.floor(min/5)+":"+hs+":"+as;const horizon=target==="MODEL_15"?15:target==="MODEL_25"?25:Number(target);const deadline=target==="MODEL_FT"?100:["FT","NEXT_TEAM","BTTS","RESULT_1X2"].includes(target)?120:min+DISPLAY_DELAY_MINUTES+(Number.isFinite(horizon)?horizon:0);return{id:[String(m.id),target,b].join("|"),matchId:String(m.id),source:"Flashscore",home:m.home,away:m.away,competition:m.competition||"",target,targetLabel:TARGETS.find(x=>x.id===target)?.label||String(target),startMinute:min,deadlineMinute:deadline,actionableAfterMinute:min+DISPLAY_DELAY_MINUTES,createdAt:now,startHome:hs,startAway:as,startGoals:hs+as,startStats:fx.values,startDelta:fx.delta,pressureHome:fx.home,pressureAway:fx.away,pressure:Math.max(fx.home,fx.away),pressureSide:fx.home>fx.away?m.home:fx.away>fx.home?m.away:"Vyrovnaný",status:"OPEN",snapshots:[{time:now,minute:min,home_score:hs,away_score:as,status:m.status,status_text:m.status_text||"",stage:m.stage||""}],...extra};}
function addPredictions(items,feed,now,model=null,lateFtModel=null){const hist=feed.recent_history||[],collected=feed.collected_at||new Date(now).toISOString();for(const r of feed.records||[]){const m=r?.match;if(!m||m.source!=="Flashscore"||m.status!=="live")continue;const min=minute(m);if(!Number.isFinite(min))continue;const fx=features(m,hist,r.collected_at||collected,now);if(!fx.ready)continue;const predictionTime=Date.parse(r.collected_at||collected)||now;const pressure=Math.max(fx.home,fx.away);
if(min>=1&&min<=90&&!/(half.?time|\bht\b|after extra time|penalt|abandoned|cancelled|postponed|suspended)/i.test(String(m.stage||""))){
 const vector=modelFeatureVector(m,hist,r.collected_at||collected);
 for(const horizon of [15,25]){
  if(!modelIsValidated(model,horizon))continue;
  const item=model.models[String(horizon)];
  const probability=vector?modelProbability(item.weights,vector):null;
  const calibrationGate=probability===null?{allowed:false,reason:"features_unavailable"}:modelCalibrationGate(item,probability,model);
  if(probability!==null&&calibrationGate.allowed){
   const target="MODEL_"+horizon;
   const p=make(m,target,min,predictionTime,fx,{modelProbability:Number(probability.toFixed(6)),modelStatus:"SHADOW_VALIDATED",modelCalibrationBin:calibrationGate.bin,modelCalibrationMatchesWeight:calibrationGate.matches_weight,modelCalibrationError:calibrationGate.absolute_error,modelMinimumOdds:minimumOddsThreshold(probability,calibrationGate.absolute_error,0.05),simulationMinimumOdds:minimumOddsThreshold(probability,calibrationGate.absolute_error,0.05),simulationOddsLockedAt:predictionTime,modelOddsSafetyMargin:0.05,modelUpdatedAt:model.updated_at,modelValidationMatches:item.counts.validation_matches,modelRelativeLogLossGain:item.metrics.relative_log_loss_gain,modelRelativeBrierGain:item.metrics.relative_brier_gain});
   if(!items.some(x=>x.id===p.id))items.push(p);
  }
 }
 if(min>=65&&min<=85&&lateFTModelIsValidated(lateFtModel)){
  const item=lateFtModel.model,vector=lateFTFeatureVectorForMatch(m,hist,r.collected_at||collected),probability=vector?modelProbability(item.weights,vector):null;
  const gate=probability===null?{allowed:false,reason:"features_unavailable"}:modelCalibrationGate(item,probability,lateFtModel);
  if(probability!==null&&gate.allowed){
   const p=make(m,"MODEL_FT",min,predictionTime,fx,{modelProbability:Number(probability.toFixed(6)),modelStatus:"SHADOW_VALIDATED",modelCalibrationBin:gate.bin,modelCalibrationMatchesWeight:gate.matches_weight,modelCalibrationError:gate.absolute_error,modelMinimumOdds:minimumOddsThreshold(probability,gate.absolute_error,0.05),simulationMinimumOdds:minimumOddsThreshold(probability,gate.absolute_error,0.05),simulationOddsLockedAt:predictionTime,modelOddsSafetyMargin:0.05,modelUpdatedAt:lateFtModel.updated_at,modelValidationMatches:item.counts.validation_matches,modelRelativeLogLossGain:item.metrics.relative_log_loss_gain,modelRelativeBrierGain:item.metrics.relative_brier_gain,modelTarget:"GOAL_UNTIL_REGULATION_FT"});
   if(!items.some(x=>x.id===p.id))items.push(p);
  }
 }
}
for(const t of TARGETS.filter(x=>[15,25,"FT"].includes(x.id))){if(pressure<t.threshold||(t.id!=="FT"&&min>90-t.id)||(t.id==="FT"&&min>85))continue;const p=make(m,t.id,min,predictionTime,fx);if(!items.some(x=>x.id===p.id))items.push(p);}
if(min<=85&&pressure>=40&&Math.abs(fx.home-fx.away)>=8){const team=fx.home>fx.away?m.home:m.away,p=make(m,"NEXT_TEAM",min,predictionTime,fx,{predictedTeam:team});if(!items.some(x=>x.id===p.id))items.push(p);}
if(min>=60&&min<=85){const hs=Number(m.home_score)||0,as=Number(m.away_score)||0,gap=fx.home-fx.away;let outcome=null,rule="";if(hs>as){outcome="HOME";rule="aktuálne vedenie";}else if(as>hs){outcome="AWAY";rule="aktuálne vedenie";}else if(min>=65&&gap>=18){outcome="HOME";rule="vyrovnané skóre · výrazný tlak domácich";}else if(min>=65&&gap<=-18){outcome="AWAY";rule="vyrovnané skóre · výrazný tlak hostí";}else if(min>=75&&Math.abs(gap)<=8){outcome="DRAW";rule="neskoré vyrovnané skóre a tlak";}if(outcome){const p=make(m,"RESULT_1X2",min,predictionTime,fx,{predictedOutcome:outcome,rule,pressureGap:Math.round(gap)});if(!items.some(x=>x.id===p.id))items.push(p);}}
const hs=Number(m.home_score)||0,as=Number(m.away_score)||0,need=hs===0&&as===0?Math.min(fx.home,fx.away):hs===0?fx.home:as===0?fx.away:0;if(!(hs>0&&as>0)&&min>=10&&min<=80&&pressure>=40&&need>=25){const p=make(m,"BTTS",min,predictionTime,fx,{scorelessPressure:need});if(!items.some(x=>x.id===p.id))items.push(p);}}}
function evaluate(items,feed,outcomes,now){const hist=feed.recent_history||[],live=new Map((feed.records||[]).filter(r=>r?.match?.id).map(r=>[String(r.match.id),r.match]));for(const p of items){if(p.status!=="OPEN")continue;if(p.startMinute>85&&["FT","NEXT_TEAM","RESULT_1X2"].includes(p.target)){p.status="UNRESOLVED";p.unresolvedReason=p.target==="MODEL_FT"?"zachytenie po povolenej 75. minúte":"zostávajúci čas je kratší než predpokladané oneskorenie dát";p.checkedAt=now;continue;}const snapshots=new Map((p.snapshots||[]).map(x=>[Number(x.time),x]));const addSnapshot=(time,m)=>{if(!Number.isFinite(time)||time<p.createdAt||!m)return;snapshots.set(time,{time,minute:minute(m),home_score:Number(m.home_score)||0,away_score:Number(m.away_score)||0,status:m.status||"live",status_text:m.status_text||"",stage:m.stage||""});};for(const x of hist)if(String(x.match?.id)===p.matchId)addSnapshot(Number(x.time),x.match);const lm=live.get(p.matchId);if(lm)addSnapshot(Date.parse(feed.collected_at||"")||now,lm);p.snapshots=[...snapshots.values()].sort((a,b)=>a.time-b.time);const tl=p.snapshots.map(x=>({time:x.time,match:{...x,live_minute:x.minute}}));const final=outcomes?.matches?.[p.matchId];if(final?.status==="CONFIRMED"&&p.target==="RESULT_1X2"){const hs=Number(final.home_score)||0,as=Number(final.away_score)||0;p.resultScore=hs+":"+as;p.checkedAt=Date.parse(final.confirmed_at||"")||now;if(p.target==="BTTS")p.status=hs>0&&as>0?"HIT":"MISS";else{const actual=hs>as?"HOME":as>hs?"AWAY":"DRAW";p.status=nonReg(final.final_match)? "UNRESOLVED":actual===p.predictedOutcome?"HIT":"MISS";if(p.status!=="UNRESOLVED")p.actualOutcome=actual;}continue;}
const actionAfter=p.actionableAfterMinute??(p.startMinute+DISPLAY_DELAY_MINUTES);let previousHome=p.startHome,previousAway=p.startAway;const goalEvents=[];for(const row of tl){const hs=Number(row.match?.home_score)||0,as=Number(row.match?.away_score)||0,hd=hs-previousHome,ad=as-previousAway;if(hd>0||ad>0)goalEvents.push({time:row.time,match:row.match,minute:minute(row.match),homeDelta:hd,awayDelta:ad});previousHome=hs;previousAway=as;}if(p.target==="BTTS"){const requiredSides=p.startHome===0&&p.startAway===0?["home","away"]:p.startHome===0?["home"]:p.startAway===0?["away"]:[];const scoredAfter=side=>goalEvents.some(x=>x[side+"Delta"]>0&&Number.isFinite(x.minute)&&x.minute>actionAfter);const allProven=requiredSides.length>0&&requiredSides.every(scoredAfter);if(allProven){const lastGoal=goalEvents.filter(x=>requiredSides.some(side=>x[side+"Delta"]>0&&Number.isFinite(x.minute)&&x.minute>actionAfter)).slice(-1)[0];p.status="HIT";p.checkedAt=lastGoal?.time||now;p.resultScore=lastGoal?(Number(lastGoal.match.home_score)||0)+":"+(Number(lastGoal.match.away_score)||0):undefined;continue;}if(final?.status==="CONFIRMED"){const hs=Number(final.home_score)||0,as=Number(final.away_score)||0;p.resultScore=hs+":"+as;p.checkedAt=Date.parse(final.confirmed_at||"")||now;p.status=hs===0||as===0?"MISS":"UNRESOLVED";continue;}if(isEnded(tl[tl.length-1]?.match)){const hs=Number(tl[tl.length-1].match.home_score)||0,as=Number(tl[tl.length-1].match.away_score)||0;p.resultScore=hs+":"+as;p.checkedAt=tl[tl.length-1].time;p.status=hs===0||as===0?"MISS":"UNRESOLVED";continue;}}const goal=goalEvents.find(x=>Number.isFinite(x.minute)&&x.minute>actionAfter);if(goal&&p.target!=="BTTS"){const gm=goal.minute,before=tl.filter(x=>x.time<goal.time).slice(-1)[0],hd=goal.homeDelta,ad=goal.awayDelta,team=hd>0&&ad>0?null:hd>0?p.home:ad>0?p.away:null;p.checkedAt=goal.time;p.resultMinute=Number.isFinite(gm)?gm:null;p.resultScore=(Number(goal.match.home_score)||0)+":"+(Number(goal.match.away_score)||0);if(p.target==="NEXT_TEAM"){p.actualTeam=team||null;p.status=!team?"UNRESOLVED":team===p.predictedTeam?"HIT":"MISS";}else if(p.target==="FT"||p.target==="MODEL_FT")p.status=nonReg(goal.match)?"UNRESOLVED":"HIT";else if(p.target==="BTTS")p.status=Number(goal.match.home_score)>0&&Number(goal.match.away_score)>0?"HIT":"OPEN";else if(Number.isFinite(gm)&&gm<=p.deadlineMinute)p.status="HIT";else if(before&&Number.isFinite(minute(before.match))&&minute(before.match)>=p.deadlineMinute)p.status="MISS";else p.status="UNRESOLVED";continue;}
if(final?.status==="CONFIRMED"){const hs=Number(final.home_score)||0,as=Number(final.away_score)||0,last=tl[tl.length-1];p.resultScore=hs+":"+as;p.checkedAt=Date.parse(final.confirmed_at||"")||now;if(p.target==="FT"||p.target==="MODEL_FT")p.status=nonReg(final.final_match)?"UNRESOLVED":goal?"HIT":last&&goals(last.match)===hs+as?"MISS":"UNRESOLVED";else if(p.target==="NEXT_TEAM")p.status=goal?"MISS":last&&goals(last.match)===hs+as?"MISS":"UNRESOLVED";else if(p.target==="BTTS")p.status=hs>0&&as>0?"UNRESOLVED":"MISS";else if(p.target==="RESULT_1X2"){const actual=hs>as?"HOME":as>hs?"AWAY":"DRAW";p.status=nonReg(final.final_match)?"UNRESOLVED":actual===p.predictedOutcome?"HIT":"MISS";if(p.status!=="UNRESOLVED")p.actualOutcome=actual;}else p.status=last&&goals(last.match)===hs+as&&Number.isFinite(minute(last.match))&&minute(last.match)>=p.deadlineMinute?"MISS":"UNRESOLVED";continue;}
const last=tl[tl.length-1];if(!last)continue;if(isEnded(last.match)){const hs=Number(last.match.home_score)||0,as=Number(last.match.away_score)||0;p.resultScore=hs+":"+as;p.checkedAt=last.time;if(p.target==="FT"||p.target==="MODEL_FT")p.status=nonReg(last.match)?"UNRESOLVED":goal?"HIT":"MISS";else if(p.target==="NEXT_TEAM")p.status=goal?"MISS":"MISS";else if(p.target==="BTTS")p.status=hs>0&&as>0?"UNRESOLVED":"MISS";else if(p.target==="RESULT_1X2"){const actual=hs>as?"HOME":as>hs?"AWAY":"DRAW";p.status=nonReg(last.match)?"UNRESOLVED":actual===p.predictedOutcome?"HIT":"MISS";if(p.status!=="UNRESOLVED")p.actualOutcome=actual;}else p.status=Number.isFinite(minute(last.match))&&minute(last.match)>=p.deadlineMinute?"MISS":"UNRESOLVED";}else if([15,25,"MODEL_15","MODEL_25"].includes(p.target)&&Number.isFinite(minute(last.match))&&minute(last.match)>=p.deadlineMinute){p.status="MISS";p.checkedAt=last.time;p.resultScore=(Number(last.match.home_score)||0)+":"+(Number(last.match.away_score)||0);}}}
function minimumOddsSimulationSummary(rows,target){
 const firstByMatch=new Map();
 const stamp=value=>{const n=Number(value);if(Number.isFinite(n))return n;const parsed=Date.parse(value||"");return Number.isFinite(parsed)?parsed:0;};
 for(const row of rows){
  if(row?.target!==target||row?.matchId===null||row?.matchId===undefined||String(row.matchId).trim()==="")continue;
  const odds=Number(row.simulationMinimumOdds??row.modelMinimumOdds);if(!Number.isFinite(odds)||odds<=1)continue;
  const key=String(row.matchId),old=firstByMatch.get(key);if(!old||stamp(row.createdAt)<stamp(old.createdAt))firstByMatch.set(key,row);
 }
 const selected=[...firstByMatch.values()],counts={HIT:0,MISS:0,UNRESOLVED:0,OPEN:0};let net=0,staked=0,oddsTotal=0;
 for(const row of selected){if(Object.prototype.hasOwnProperty.call(counts,row.status))counts[row.status]++;if(row.status!=="HIT"&&row.status!=="MISS")continue;const odds=Number(row.simulationMinimumOdds??row.modelMinimumOdds);staked++;oddsTotal+=odds;net+=row.status==="HIT"?odds-1:-1;}
 const decided=counts.HIT+counts.MISS;
 return{method:"first_eligible_prediction_per_match_and_model",total:selected.length,...counts,decided,accuracy:decided?counts.HIT/decided:null,stake_per_pick:1,total_staked:staked,net_profit:Number(net.toFixed(4)),roi:staked?Number((net/staked*100).toFixed(2)):null,average_minimum_odds:decided?Number((oddsTotal/decided).toFixed(3)):null};
}
function buildStrategyDataset(rows){return rows.filter(p=>(p.target==="MODEL_15"||p.target==="MODEL_25"||p.target==="MODEL_FT")&&(p.status==="HIT"||p.status==="MISS")&&Number.isFinite(Number(p.modelMinimumOdds))&&Number(p.modelMinimumOdds)>1&&Number.isFinite(Number(p.modelProbability))).map(p=>({matchId:String(p.matchId||p.id||p.target+"|"+p.createdAt),target:p.target,createdAt:p.createdAt,status:p.status,minimumOdds:Number(p.modelMinimumOdds),probability:Number(p.modelProbability)})).sort((a,b)=>a.createdAt-b.createdAt||(a.target==="MODEL_25"?-1:1));}
function simulateStrategy(rows,{odds=2.5,bankroll=100,baseStake=1,multiplier=1.5,maxStakeMultiple=5}={}){if(![odds,bankroll,baseStake,multiplier,maxStakeMultiple].every(Number.isFinite)||odds<=1||bankroll<=0||baseStake<=0||multiplier<1||maxStakeMultiple<1)throw Error("Neplatné parametre simulácie.");const run=progressive=>{let balance=bankroll,peak=bankroll,maxDrawdown=0,stake=baseStake,lossStreak=0,maxLossStreak=0,wins=0,losses=0,staked=0,skipped=0,skippedDuplicateMatches=0;const usedMatches=new Set();for(const row of rows){if(odds+1e-9<row.minimumOdds){skipped++;continue;}const matchKey=String(row.matchId||row.id||row.target+"|"+row.createdAt);if(usedMatches.has(matchKey)){skipped++;skippedDuplicateMatches++;continue;}usedMatches.add(matchKey);const wager=Math.min(balance,progressive?Math.min(stake,baseStake*maxStakeMultiple):baseStake);if(wager<=0)break;staked+=wager;if(row.status==="HIT"){balance+=wager*(odds-1);wins++;lossStreak=0;stake=baseStake;}else{balance-=wager;losses++;lossStreak++;maxLossStreak=Math.max(maxLossStreak,lossStreak);if(progressive)stake=Math.min(baseStake*maxStakeMultiple,stake*multiplier);}peak=Math.max(peak,balance);maxDrawdown=Math.max(maxDrawdown,peak-balance);}return{bets:wins+losses,wins,losses,skipped,skippedDuplicateMatches,endingBankroll:Number(balance.toFixed(2)),net:Number((balance-bankroll).toFixed(2)),roiOnStartingBankroll:Number(((balance-bankroll)/bankroll*100).toFixed(2)),maxDrawdown:Number(maxDrawdown.toFixed(2)),maxLosingStreak:maxLossStreak,totalStaked:Number(staked.toFixed(2))};};return{flat:run(false),progressive:run(true)};}

function matchLevelSummary(rows,target){
 const firstByMatch=new Map();
 const stamp=value=>{const numeric=Number(value);if(Number.isFinite(numeric))return numeric;const parsed=Date.parse(value||"");return Number.isFinite(parsed)?parsed:0;};
 for(const row of rows){
  if(row?.target!==target||row?.matchId===null||row?.matchId===undefined||String(row.matchId).trim()==="")continue;
  const key=String(row.matchId),old=firstByMatch.get(key),currentStamp=stamp(row.createdAt),oldStamp=old?stamp(old.createdAt):Infinity;
  if(!old||currentStamp<oldStamp||(currentStamp===oldStamp&&String(row.id||"")<String(old.id||"")))firstByMatch.set(key,row);
 }
 const selected=[...firstByMatch.values()];
 const counts={HIT:0,MISS:0,UNRESOLVED:0,OPEN:0};
 for(const row of selected)if(Object.prototype.hasOwnProperty.call(counts,row.status))counts[row.status]++;
 const decided=counts.HIT+counts.MISS;
 return{method:"first_prediction_per_match_and_target",total:selected.length,...counts,decided,accuracy:decided?counts.HIT/decided:null};
}
function buildLedger(dataDir=DATA,nowDate=new Date()){const feed=read(path.join(dataDir,"flashscore-primary-current.json"),null);if(!feed||feed.source!=="Flashscore"||!Array.isArray(feed.records))throw Error("Chýba platný Flashscore primary feed; história sa nemení.");const outcomes=read(path.join(dataDir,"flashscore-confirmed-outcomes.json"),{matches:{}}),model=read(path.join(dataDir,"ai-edge-live-model.json"),null),lateFtModel=read(path.join(dataDir,"ai-edge-live-late-ft-model.json"),null),old=readHistory(path.join(dataDir,"ai-edge-prediction-history.json"),null);if(old&&(old.source!=="Flashscore"||!Array.isArray(old.predictions)))throw Error("Neplatná štruktúra predikčnej histórie; odmietam prepísať.");const rows=old?.predictions||[],now=nowDate.getTime();for(const p of rows){if((p.target==="MODEL_25"||p.target==="MODEL_15"||p.target==="MODEL_FT")&&p.simulationMinimumOdds===undefined&&Number.isFinite(Number(p.modelMinimumOdds))&&Number(p.modelMinimumOdds)>1){p.simulationMinimumOdds=Number(p.modelMinimumOdds);p.simulationOddsLockedAt=p.createdAt;}}evaluate(rows,feed,outcomes,now);addPredictions(rows,feed,now,model,lateFtModel);const counts=Object.fromEntries(["HIT","MISS","UNRESOLVED","OPEN"].map(s=>[s,rows.filter(p=>p.status===s).length]));const byTarget=Object.fromEntries(TARGETS.map(t=>{const a=rows.filter(p=>p.target===t.id),h=a.filter(p=>p.status==="HIT").length,m=a.filter(p=>p.status==="MISS").length;return[String(t.id),{label:t.label,total:a.length,HIT:h,MISS:m,UNRESOLVED:a.filter(p=>p.status==="UNRESOLVED").length,OPEN:a.filter(p=>p.status==="OPEN").length,decided:h+m,accuracy:h+m?h/(h+m):null,match_level:matchLevelSummary(rows,t.id),minimum_odds_simulation:["MODEL_15","MODEL_25","MODEL_FT"].includes(t.id)?minimumOddsSimulationSummary(rows,t.id):null}];}));const sorted=rows.slice().sort((a,b)=>b.createdAt-a.createdAt);const output={schema_version:1,source:"Flashscore",mode:"LIVE_PREDICTION_LEDGER",retention_policy:"permanent",updated_at:nowDate.toISOString(),feed_collected_at:feed.collected_at||null,total_predictions:rows.length,counts,by_target:byTarget,predictions:sorted};writeCompressedHistory(path.join(dataDir,"ai-edge-prediction-history.json"),output);const compactRows=[...new Map([...sorted.filter(p=>p.status==="OPEN"),...sorted.slice(0,120)].map(p=>[String(p.id||p.matchId)+"|"+String(p.target)+"|"+String(p.createdAt),p])).values()].sort((a,b)=>b.createdAt-a.createdAt).map(({snapshots,...p})=>p);const simulation=buildStrategyDataset(rows);write(path.join(dataDir,"ai-edge-strategy-simulation.json"),{schema_version:1,source:"Flashscore",mode:"AI_EDGE_STRATEGY_SIMULATION_DATA",updated_at:output.updated_at,total_resolved_model_predictions:simulation.length,predictions:simulation});const view={schema_version:1,source:"Flashscore",mode:"LIVE_PREDICTION_LEDGER_VIEW",retention_policy:"summary_and_recent_open_rows;full_permanent_history_in_ai-edge-prediction-history.json.gz",updated_at:output.updated_at,feed_collected_at:output.feed_collected_at,total_predictions:output.total_predictions,counts,by_target:byTarget,predictions:compactRows};write(path.join(dataDir,"ai-edge-prediction-live.json"),view);return{total:rows.length,viewRows:compactRows.length,counts,byTarget:Object.keys(byTarget).length,updated_at:output.updated_at};}
if(require.main===module){try{console.log("AI EDGE PERMANENT LEDGER",JSON.stringify(buildLedger()));}catch(e){console.error("AI EDGE LEDGER FAILED:",e.message);process.exit(1);}}
module.exports={stat,features,modelFeatureVector,modelProbability,modelIsValidated,modelCalibrationGate,lateFTModelIsValidated,minimumOddsThreshold,minimumOddsSimulationSummary,buildStrategyDataset,simulateStrategy,matchLevelSummary,addPredictions,evaluate,buildLedger};
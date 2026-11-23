"use strict";
const cornersTrainer=require("./ai-edge-live-corners-under-trainer");
const cardsTrainer=require("./ai-edge-live-cards-under-trainer");
const LAG_MINUTES=5;
const MARKET_LINES=[
 ...cornersTrainer.LINES.map(line=>({...line,side:"UNDER",marketType:"CORNERS",modelKey:line.key,target:"CORNERS_"+line.key,group:"CORNERS_UNDER",label:"Rohy UNDER "+line.line})),
 ...cardsTrainer.LINES.map(line=>({...line,marketType:"CARDS",modelKey:line.key,target:"CARDS_"+line.key,group:"CARDS_OU",label:"Karty "+line.side+" "+line.line}))
];
function stamp(value){const n=Number(value);if(Number.isFinite(n))return n;const p=Date.parse(value||"");return Number.isFinite(p)?p:NaN;}
function finite(value){if(value===null||value===undefined||String(value).trim()==="")return null;const n=Number(String(value).replace(",","."));return Number.isFinite(n)?n:null;}
function sigmoid(weights,x,probabilityCalibration=null){
 if(!Array.isArray(weights)||!Array.isArray(x)||weights.length!==x.length+1)return null;
 let z=weights[0];for(let i=0;i<x.length;i++)z+=x[i]*weights[i+1];
 if(probabilityCalibration?.method==="platt_train_match_holdout"){
  const intercept=Number(probabilityCalibration.intercept),slope=Number(probabilityCalibration.slope);
  if(!Number.isFinite(intercept)||!Number.isFinite(slope)||slope<=0)return null;
  z=intercept+slope*z;
 }
 return 1/(1+Math.exp(-Math.max(-20,Math.min(20,z))));
}
function modelIsValidated(model,item,featureCount){
 const policy=model?.validation_policy||{},counts=item?.counts||{},metrics=item?.metrics||{};
 return model?.source==="Flashscore"&&item?.status==="SHADOW_VALIDATED"&&
  Array.isArray(item.weights)&&item.weights.length===featureCount+1&&
  item.probability_calibration?.method==="platt_train_match_holdout"&&
  Number.isFinite(Number(item.probability_calibration.intercept))&&
  Number.isFinite(Number(item.probability_calibration.slope))&&Number(item.probability_calibration.slope)>0&&
  Number(counts.train)>=Number(policy.min_train_samples||500)&&
  Number(counts.validation)>=Number(policy.min_validation_samples||300)&&
  Number(counts.train_matches)>=Number(policy.min_train_matches||100)&&
  Number(counts.validation_matches)>=Number(policy.min_validation_matches||50)&&
  Number(metrics.relative_log_loss_gain)>=Number(policy.min_relative_log_loss_gain||0.01)&&
  Number(metrics.relative_brier_gain)>=Number(policy.min_relative_brier_gain||0.005);
}
function calibrationGate(item,probability,model){
 const bins=item?.metrics?.calibration?.bins;
 if(!Number.isFinite(probability)||probability<0||probability>1||!Array.isArray(bins))return {allowed:false,reason:"CALIBRATION_MISSING"};
 const policy=model?.validation_policy||{};
 const minWeight=Number(policy.min_effective_match_weight_per_calibration_bin||8);
 const maxError=Number(policy.max_absolute_calibration_error||0.08);
 const bin=bins.find(b=>{
  const [lo,hi]=String(b.range||"").split("-").map(Number);
  return Number.isFinite(lo)&&Number.isFinite(hi)&&probability>=lo/100&&(probability<hi/100||(hi===100&&probability<=1));
 });
 if(!bin)return {allowed:false,reason:"BIN_UNOBSERVED"};
 const weight=Number(bin.matches_weight||0),error=Number(bin.absolute_error);
 if(weight<minWeight)return {allowed:false,reason:"BIN_SUPPORT_LOW",bin:bin.range,weight,error};
 if(!Number.isFinite(error)||error>maxError)return {allowed:false,reason:"BIN_CALIBRATION_FAILED",bin:bin.range,weight,error};
 return {allowed:true,bin:bin.range,weight,error};
}
function marketRows(feed,record){
 const match=record?.match||{},id=String(match.id||"");
 if(!id)return [];
 const rows=[];
 for(const item of feed?.recent_history||[]){
  if(String(item?.match?.id||"")!==id)continue;
  const time=stamp(item.time??item.collected_at??item.match?.collected_at);
  if(!Number.isFinite(time))continue;
  const m=item.match;
  rows.push({match_id:"flashscore:"+id,snapshot:{
   collected_at:new Date(time).toISOString(),live_minute:finite(m.live_minute),
   home_score:finite(m.home_score),away_score:finite(m.away_score),
   stage:m.stage||m.status_text||m.status||"LIVE",stats:Array.isArray(m.stats)?m.stats:[]
  }});
 }
 const currentTime=stamp(record.collected_at??match.collected_at??feed.collected_at);
 if(Number.isFinite(currentTime)){
  rows.push({match_id:"flashscore:"+id,snapshot:{
   collected_at:new Date(currentTime).toISOString(),live_minute:finite(match.live_minute),
   home_score:finite(match.home_score),away_score:finite(match.away_score),
   stage:match.stage||match.status_text||match.status||"LIVE",stats:Array.isArray(match.stats)?match.stats:[]
  }});
 }
 const unique=new Map();
 for(const row of rows)unique.set(row.snapshot.collected_at,row);
 return [...unique.values()].sort((a,b)=>Date.parse(a.snapshot.collected_at)-Date.parse(b.snapshot.collected_at));
}
function stageEligible(stage){
 return !/(half.?time|\bht\b|finished|full.?time|\bft\b|extra.?time|\baet\b|penalt|abandoned|cancelled|postponed|suspended)/i.test(String(stage||""));
}
function minimumOdds(probability,error){
 const conservative=Math.max(0.01,probability-error);
 return Number((1/(conservative*0.95)).toFixed(2));
}
function buildMarketPredictions(feed,models,entries=[],nowDate=new Date()){
 const now=nowDate.getTime(),liveRecords=(feed?.records||[]).filter(r=>r?.match?.source==="Flashscore"&&r.match.status==="live");
 const additions=[];
 for(const record of liveRecords){
  const match=record.match,minute=finite(match.live_minute);
  if(minute===null||minute<1||minute>110||!stageEligible(match.stage||match.status_text))continue;
  const rows=marketRows(feed,record);
  if(rows.length<2)continue;
  const last=rows[rows.length-1],lastMinute=finite(last.snapshot.live_minute);
  if(lastMinute===null||lastMinute<minute-2)continue;
  const matchId=String(match.id);
  for(const line of MARKET_LINES){
   if(entries.some(entry=>entry.status==="OPEN"&&String(entry.matchId)===matchId&&entry.target===line.target))continue;
   const model=line.marketType==="CORNERS"?models?.corners:models?.cards;
   const expectedMode=line.marketType==="CORNERS"?"FORWARD_ONLY_LIVE_CORNERS_UNDER_SHADOW":"FORWARD_ONLY_LIVE_CARDS_SHADOW";
   if(model?.mode!==expectedMode)continue;
   const modelAt=stamp(model.updated_at);
   if(!Number.isFinite(modelAt)||modelAt>now||now-modelAt>10*60000)continue;
   const item=model.models?.[line.modelKey];
   const featureCount=line.marketType==="CORNERS"?17:16;
   if(!modelIsValidated(model,item,featureCount))continue;
   const trainer=line.marketType==="CORNERS"?cornersTrainer:cardsTrainer;
   const chosen=new Map();
   for(let i=0;i<rows.length;i++){
    const row=rows[i],sampleMinute=trainer.minuteOf(row);
    if(sampleMinute===null||sampleMinute<model.observation_minute_range?.[0]||sampleMinute>model.observation_minute_range?.[1]||!stageEligible(row.snapshot.stage))continue;
    const window=Math.floor(sampleMinute/5)*5;
    chosen.set(window,i);
   }
   const eligible=[...chosen.values()].sort((a,b)=>b-a);
   let selected=null,vector=null,gate=null,probability=null;
   for(const index of eligible){
    const row=rows[index],sampleMinute=trainer.minuteOf(row);
    const lagCovered=line.marketType==="CORNERS"
      ?!cornersTrainer.hasCornerChangeInLag(rows,index,sampleMinute+LAG_MINUTES)
      :!cardsTrainer.hasCardChangeInLag(rows,index,sampleMinute+LAG_MINUTES);
    if(!lagCovered||minute<sampleMinute+LAG_MINUTES)continue;
    const x=trainer.featureVector(row,rows[index-1]);
    if(!x)continue;
    const p=sigmoid(item.weights,x,item.probability_calibration);
    const calibration=calibrationGate(item,p,model);
    if(!calibration.allowed)continue;
    selected=row;vector=x;gate=calibration;probability=p;break;
   }
   if(!selected)continue;
   const sampleMinute=trainer.minuteOf(selected),sampleTime=Date.parse(selected.snapshot.collected_at);
   if(!Number.isFinite(sampleTime)||sampleTime>now||now-sampleTime>20*60000)continue;
   const target=line.target,predictionId=matchId+"|"+target+"|"+sampleTime;
   const conservative=Math.max(0.01,probability-gate.error),minOdds=minimumOdds(probability,gate.error);
   additions.push({
    key:matchId+"|"+target+"|"+predictionId,predictionId,matchId,target,
    marketType:line.marketType,marketGroup:line.group,marketSide:line.side,marketLine:line.line,
    marketLabel:line.label,modelTarget:line.marketType==="CORNERS"?"FINAL_TOTAL_CORNERS":"FINAL_TOTAL_YELLOW_CARDS",
    home:match.home,away:match.away,competition:match.competition||match.league||"",
    capturedAt:now,sourcePredictionAt:sampleTime,capturedMinute:sampleMinute,
    capturedScore:String(selected.snapshot.home_score)+":"+String(selected.snapshot.away_score),
    actionableAfterMinute:sampleMinute+LAG_MINUTES,deadlineMinute:110,
    modelProbability:Number(probability.toFixed(6)),conservativeProbability:Number(conservative.toFixed(6)),
    modelFairOdds:Number((1/probability).toFixed(2)),modelCalibrationError:gate.error,
    modelCalibrationMatchesWeight:gate.weight,modelCalibrationBin:gate.bin,
    modelMinimumOdds:minOdds,minimumOdds:minOdds,stake:1,modelStatus:"SHADOW_VALIDATED",
    modelUpdatedAt:model.updated_at,modelOddsSafetyMargin:0.05,
    status:"OPEN",resultScore:null,resultTotal:null,settledAt:null,
    statsLagMinutes:LAG_MINUTES,observationMinuteRange:model.observation_minute_range
   });
  }
 }
 return additions;
}
function settleMarketEntries(entries,outcomes,nowDate=new Date()){
 const now=nowDate.toISOString();
 for(const entry of entries){
  if(entry.status!=="OPEN"||!["CORNERS","CARDS"].includes(entry.marketType))continue;
  const outcome=outcomes?.matches?.[String(entry.matchId).replace(/^flashscore:/,"")];
  if(!outcome||outcome.source!=="Flashscore"||outcome.status!=="CONFIRMED"||outcome.status_confirmation!=="confirmed_finished"||outcome.final_status!=="FINISHED")continue;
  const statusText=[outcome.final_match?.status_text,outcome.final_match?.stage,outcome.final_match?.status].filter(Boolean).join(" ");
  if(/extra.?time|\baet\b|penalt|abandoned|cancelled|postponed|suspended/i.test(statusText)){
   entry.status="UNRESOLVED";entry.unresolvedReason="Zápas obsahoval predĺženie alebo nemá potvrdený riadny výsledok.";entry.settledAt=outcome.confirmed_at||now;continue;
  }
  const confirmed=entry.marketType==="CORNERS"?outcome.corners_status==="CONFIRMED"&&Number.isInteger(outcome.final_corners?.total_corners):outcome.yellow_cards_status==="CONFIRMED"&&Number.isInteger(outcome.final_yellow_cards?.total_yellow_cards);
  if(!confirmed)continue;
  const total=entry.marketType==="CORNERS"?outcome.final_corners.total_corners:outcome.final_yellow_cards.total_yellow_cards;
  entry.resultTotal=total;entry.resultScore=(Number(outcome.home_score)||0)+":"+(Number(outcome.away_score)||0);
  const won=entry.marketSide==="UNDER"?total<Number(entry.marketLine):total>Number(entry.marketLine);
  entry.status=won?"HIT":"MISS";entry.settledAt=outcome.confirmed_at||now;
 }
}
function summarizeMarketGroup(entries,group,target=null){
 const list=entries.filter(x=>x.marketGroup===group&&(!target||x.target===target)),counts={HIT:0,MISS:0,OPEN:0,UNRESOLVED:0};
 for(const row of list)if(counts[row.status]!==undefined)counts[row.status]++;
 let net=0,staked=0,peak=0,balance=0,maxDrawdown=0;
 for(const row of list.filter(x=>x.status==="HIT"||x.status==="MISS").sort((a,b)=>stamp(a.capturedAt)-stamp(b.capturedAt))){
  const odds=Number(row.minimumOdds);if(!Number.isFinite(odds)||odds<=1)continue;
  const change=row.status==="HIT"?odds-1:-1;balance+=change;net+=change;staked++;peak=Math.max(peak,balance);maxDrawdown=Math.max(maxDrawdown,peak-balance);
 }
 const decided=counts.HIT+counts.MISS;
 return {target:target||group,total:list.length,...counts,decided,accuracy:decided?counts.HIT/decided:null,stakePerPick:1,totalStaked:staked,netProfit:staked?Number(net.toFixed(4)):null,roi:staked?Number((net/staked*100).toFixed(2)):null,maxDrawdown:staked?Number(maxDrawdown.toFixed(4)):null,oddsBasis:"locked_individual_minimum_hypothetical_not_actual_bookmaker_odds"};
}
module.exports={MARKET_LINES,marketRows,stageEligible,sigmoid,modelIsValidated,calibrationGate,minimumOdds,buildMarketPredictions,settleMarketEntries,summarizeMarketGroup};

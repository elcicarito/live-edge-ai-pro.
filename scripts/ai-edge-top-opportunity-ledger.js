"use strict";
const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib");
const {features}=require("./ai-edge-live-prediction-ledger");
const marketPredictions=require("./ai-edge-market-top-predictions");
const DATA=path.resolve(__dirname,"..","data");
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(e){if(e.code==="ENOENT")return fallback;throw e;}}
function readHistory(file){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(e){if(e.code!=="ENOENT")throw e;}try{return JSON.parse(zlib.gunzipSync(fs.readFileSync(file+".gz")).toString("utf8"));}catch(e){if(e.code==="ENOENT")return null;throw e;}}
function stamp(v){const n=Number(v);if(Number.isFinite(n))return n;const p=Date.parse(v||"");return Number.isFinite(p)?p:NaN;}
function topEntryKey(matchId,target){return String(matchId)+"|"+String(target);}
// A settled entry remains in the permanent history but must not block a later opportunity.
function hasCaptured(entries,matchId,target){return entries.some(x=>x.status==="OPEN"&&x.matchId!==undefined&&topEntryKey(x.matchId,x.target)===topEntryKey(matchId,target));}
function summarize(rows,target){
 const list=rows.filter(x=>x.target===target),counts={HIT:0,MISS:0,OPEN:0,UNRESOLVED:0};for(const x of list)if(counts[x.status]!==undefined)counts[x.status]++;
 const settled=list.filter(x=>x.status==="HIT"||x.status==="MISS").sort((a,b)=>stamp(a.capturedAt)-stamp(b.capturedAt));
 let balance=0,peak=0,maxDrawdown=0,staked=0,net=0;
 for(const x of settled){const odds=Number(x.minimumOdds);if(!Number.isFinite(odds)||odds<=1)continue;const change=x.status==="HIT"?odds-1:-1;balance+=change;net+=change;staked++;peak=Math.max(peak,balance);maxDrawdown=Math.max(maxDrawdown,peak-balance);}
 return{target,total:list.length,...counts,decided:counts.HIT+counts.MISS,accuracy:counts.HIT+counts.MISS?counts.HIT/(counts.HIT+counts.MISS):null,stakePerPick:1,totalStaked:staked,netProfit:staked?Number(net.toFixed(4)):null,roi:staked?Number((net/staked*100).toFixed(2)):null,maxDrawdown:staked?Number(maxDrawdown.toFixed(4)):null,oddsBasis:"locked_individual_minimum_hypothetical_not_actual_bookmaker_odds"};
}
function buildTopLedger(dataDir=DATA,nowDate=new Date()){
 const feed=read(path.join(dataDir,"flashscore-primary-current.json"),null),prediction=readHistory(path.join(dataDir,"ai-edge-prediction-history.json"));
 if(!feed||feed.source!=="Flashscore"||!Array.isArray(feed.records)||!prediction||prediction.source!=="Flashscore"||!Array.isArray(prediction.predictions))throw Error("Chýbajú platné Flashscore LIVE dáta alebo trvalá predikčná história; TOP história sa nemení.");
 const now=nowDate.getTime(),feedAt=stamp(feed.collected_at),ledgerAt=stamp(prediction.updated_at);
 const file=path.join(dataDir,"ai-edge-top-opportunity-ledger.json"),old=read(file,{schema_version:1,source:"Flashscore",mode:"TOP_OPPORTUNITY_LEDGER",retention_policy:"permanent",entries:[]});
 if(old.source!=="Flashscore"||!Array.isArray(old.entries))throw Error("Neplatná TOP história; odmietam prepísať.");
 const entries=old.entries,byKey=new Map(entries.map(x=>[x.key||topEntryKey(x.matchId,x.target),x]));
 const cornersModel=read(path.join(dataDir,"ai-edge-live-corners-under-model.json"),null);
 const cardsModel=read(path.join(dataDir,"ai-edge-live-cards-under-model.json"),null);
 const outcomes=read(path.join(dataDir,"flashscore-confirmed-outcomes.json"),{matches:{}});
 const live=new Map(feed.records.filter(r=>r?.match?.source==="Flashscore"&&r.match.status==="live").map(r=>[String(r.match.id),r]));
 const latest=new Map();
 for(const row of prediction.predictions){
  if(!["MODEL_25","MODEL_FT"].includes(row.target)||row.status!=="OPEN"||row.modelStatus!=="SHADOW_VALIDATED"||!Number.isFinite(Number(row.modelProbability))||!Number.isFinite(Number(row.modelMinimumOdds))||Number(row.modelMinimumOdds)<=1||!Number.isFinite(Number(row.modelCalibrationError)))continue;
  const group=String(row.matchId)+"|"+row.target,prior=latest.get(group);if(!prior||stamp(row.createdAt)>stamp(prior.createdAt))latest.set(group,row);
 }
 const feedFresh=Number.isFinite(feedAt)&&now-feedAt<=8*60000;
 const fresh=feedFresh&&Number.isFinite(ledgerAt)&&now-ledgerAt<=6*60000;
 if(feedFresh){
  const marketEntries=marketPredictions.buildMarketPredictions(feed,{corners:cornersModel,cards:cardsModel},entries,nowDate);
  for(const entry of marketEntries){entries.push(entry);byKey.set(entry.key,entry);}
 }
 if(fresh)for(const row of latest.values()){
  const rec=live.get(String(row.matchId));if(!rec)continue;
  const m=rec.match,min=Number.parseInt(m.live_minute,10),after=Number(row.actionableAfterMinute),deadline=Number(row.deadlineMinute),created=stamp(row.createdAt);
  const probability=Number(row.modelProbability),calibrationError=Number(row.modelCalibrationError),calibrationWeight=Number(row.modelCalibrationMatchesWeight),minimumOdds=Number(row.modelMinimumOdds);
  if(!Number.isFinite(min)||min<1||min>110||!Number.isFinite(after)||!Number.isFinite(deadline)||deadline<=after||min>deadline||!Number.isFinite(created)||created>now||now-created>8*60000)continue;
  if(!Number.isFinite(probability)||probability<=0||probability>=1||!Number.isFinite(calibrationError)||calibrationError>0.08||!Number.isFinite(calibrationWeight)||calibrationWeight<8||!Number.isFinite(minimumOdds)||minimumOdds<=1)continue;
  const fx=features(m,feed.recent_history||[],rec.collected_at||feed.collected_at,now);if(!fx.ready)continue;
  const predictionId=String(row.id||row.matchId+"|"+row.target),key=topEntryKey(row.matchId,row.target)+"|"+predictionId;if(byKey.has(key)||hasCaptured(entries,row.matchId,row.target))continue;
  const conservative=Math.max(.01,Number(row.modelProbability)-Number(row.modelCalibrationError));
  const entry={key,predictionId,matchId:String(row.matchId),target:row.target,marketType:row.marketType||null,marketGroup:row.marketGroup||null,marketSide:row.marketSide||null,marketLine:row.marketLine??null,marketLabel:row.marketLabel||row.target,home:row.home||m.home,away:row.away||m.away,competition:row.competition||m.competition||"",capturedAt:now,sourcePredictionAt:created,capturedMinute:min,capturedScore:(Number(m.home_score)||0)+":"+(Number(m.away_score)||0),actionableAfterMinute:after,deadlineMinute:deadline,modelProbability:probability,conservativeProbability:Number(conservative.toFixed(6)),calibrationError,calibrationMatchesWeight:calibrationWeight,minimumOdds,modelStatus:row.modelStatus||"SHADOW_VALIDATED",experimentalModel:row.experimentalModel===true,stake:1,status:"OPEN",resultScore:null,settledAt:null};
  entries.push(entry);byKey.set(key,entry);
 }
 const predictionById=new Map(prediction.predictions.map(x=>[String(x.id||""),x]));
 for(const entry of entries){const p=predictionById.get(entry.predictionId);if(!p)continue;if(!Number.isFinite(Number(entry.calibrationMatchesWeight))&&Number.isFinite(Number(p.modelCalibrationMatchesWeight)))entry.calibrationMatchesWeight=Number(p.modelCalibrationMatchesWeight);if(["HIT","MISS","UNRESOLVED"].includes(p.status)){entry.status=p.status;entry.resultScore=p.resultScore||null;entry.settledAt=p.checkedAt||null;entry.resultMinute=p.resultMinute??null;}}
 marketPredictions.settleMarketEntries(entries,outcomes,nowDate);
 const summary={MODEL_25:summarize(entries,"MODEL_25"),MODEL_FT:summarize(entries,"MODEL_FT"),CORNERS_UNDER:marketPredictions.summarizeMarketGroup(entries,"CORNERS_UNDER"),CARDS_OU:marketPredictions.summarizeMarketGroup(entries,"CARDS_OU"),CORNERS_BY_LINE:Object.fromEntries(marketPredictions.MARKET_LINES.filter(line=>line.marketType==="CORNERS").map(line=>[line.key,marketPredictions.summarizeMarketGroup(entries,"CORNERS_UNDER",line.target)])),CARDS_BY_LINE:Object.fromEntries(marketPredictions.MARKET_LINES.filter(line=>line.marketType==="CARDS").map(line=>[line.key,marketPredictions.summarizeMarketGroup(entries,"CARDS_OU",line.target)]))};
 const output={schema_version:1,source:"Flashscore",mode:"TOP_OPPORTUNITY_LEDGER",retention_policy:"permanent",updated_at:nowDate.toISOString(),feed_collected_at:feed.collected_at||null,total_entries:entries.length,summary,entries:entries.slice().sort((a,b)=>stamp(b.capturedAt)-stamp(a.capturedAt))};
 const tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify(output,null,2)+"\n");fs.renameSync(tmp,file);
 return{total:entries.length,summary,updated_at:output.updated_at};
}
if(require.main===module){try{console.log("AI EDGE TOP OPPORTUNITY LEDGER",JSON.stringify(buildTopLedger()));}catch(e){console.error("AI EDGE TOP LEDGER FAILED:",e.message);process.exit(1);}}
module.exports={summarize,buildTopLedger,topEntryKey,hasCaptured};

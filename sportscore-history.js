(() => {
"use strict";
const $ = id => document.getElementById(id);
const meta=$("sportscore-history-meta"), results=$("sportscore-history-results");
const search=$("sportscore-search"), dateFilter=$("sportscore-date"), leagueFilter=$("sportscore-league"), reset=$("sportscore-reset");
let matches=[], visibleLimit=100;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const val=v=>v===null||v===undefined||v===""?"—":esc(v);
const team=(m,s)=>m?.[s]||m?.[s+"_team"]?.name||m?.[s+"_name"]||"Neznámy tím";
const league=m=>m?.competition||m?.league||"Neznáma súťaž";
const day=m=>{const d=new Date(m?.time||m?.match_time||m?.date||m?.archive_date||"");return Number.isNaN(d.getTime())?"":d.toISOString().slice(0,10)};
async function load(path){
 const r=await fetch(path+"?v=1",{cache:"no-store"}); if(!r.ok)throw Error("HTTP "+r.status+" pri načítaní "+path);
 if(!("DecompressionStream" in window))throw Error("Prehliadač nepodporuje rozbalenie gzip.");
 const t=await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
 return t.split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));
}
function render(){
 const q=(search.value||"").trim().toLocaleLowerCase("sk"), d=dateFilter.value, l=leagueFilter.value;
 const filtered=matches.filter(m=>(!q||[team(m,"home"),team(m,"away"),league(m)].some(x=>x.toLocaleLowerCase("sk").includes(q)))&&(!d||day(m)===d)&&(!l||league(m)===l));
 const shown=filtered.slice(0,visibleLimit);
 meta.textContent="SportScore · "+matches.length.toLocaleString("sk-SK")+" zápasov · "+filtered.length.toLocaleString("sk-SK")+" podľa filtrov · oddelený historický zdroj";
 if(!filtered.length){results.innerHTML='<p style="color:#9baabe">Pre zadané filtre sa nenašli žiadne zápasy.</p>';return;}
 results.innerHTML=shown.map(m=>{
  const h=team(m,"home"),a=team(m,"away"),inc=Array.isArray(m.incidents)?m.incidents:[],goals=inc.filter(x=>x.is_goal||/goal/i.test(x.type||"")),cards=inc.filter(x=>x.is_card||/card/i.test(x.type||""));
  const stats=Array.isArray(m.stats)?m.stats:Array.isArray(m.statistics)?m.statistics:[];
  const statHtml=stats.map(s=>'<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid #26384e"><span>'+val(s.name||s.type||s.label)+'</span><b>'+val(s.home??s.home_value)+' : '+val(s.away??s.away_value)+'</b></div>').join("");
  const events=inc.map(e=>'<div style="padding:4px 0;color:#b8c7d9"><b>'+val(e.time)+"'</b> · "+val(e.type)+" · "+val(e.player||(e.side==="home"?h:e.side==="away"?a:""))+(e.home_score!==undefined?" · "+val(e.home_score)+":"+val(e.away_score):"")+"</div>").join("");
  const lineups=m.lineups?'<pre style="white-space:pre-wrap;overflow-wrap:anywhere;color:#aebed1;font-size:11px">'+esc(JSON.stringify(m.lineups,null,2))+'</pre>':'<p style="color:#8294aa">Zostavy nie sú dostupné.</p>';
  const detail='<details style="margin-top:8px;border-top:1px solid #293b52;padding-top:7px"><summary style="cursor:pointer;color:#8fdcc1;font-size:12px;font-weight:800">DETAIL · '+goals.length+' gólov · '+cards.length+' kariet</summary><p style="font-size:11px;color:#9baabe">HT: '+val(m.home_ht_score)+' : '+val(m.away_ht_score)+'</p><h4 style="font-size:12px">Štatistiky</h4>'+(statHtml||'<p style="color:#8294aa;font-size:11px">Štatistiky nie sú dostupné.</p>')+'<h4 style="font-size:12px">Udalosti zápasu</h4>'+(events||'<p style="color:#8294aa">Bez zaznamenaných udalostí.</p>')+'<h4 style="font-size:12px">Zostavy</h4>'+lineups+'</details>';
  return '<article style="background:#0b1625;border:1px solid #26384e;border-radius:10px;padding:10px;margin:7px 0"><div style="display:flex;justify-content:space-between;gap:8px;color:#8fa3ba;font-size:10px"><span>'+esc(league(m))+'</span><span>'+val(day(m)||m.archive_date)+'</span></div><div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;margin:8px 0"><b style="font-size:13px">'+esc(h)+'</b><strong style="font-size:18px;color:#39e6a5;white-space:nowrap">'+val(m.home_score)+' : '+val(m.away_score)+'</strong><b style="font-size:13px;text-align:right">'+esc(a)+'</b></div><div style="font-size:10px;color:#8294aa">KONEČNÝ VÝSLEDOK · SPORTSCORE</div>'+detail+'</article>';
 }).join("");
 if(filtered.length>shown.length){results.insertAdjacentHTML("beforeend",'<button id="sportscore-more" type="button" style="margin-top:8px">ZOBRAZIŤ ĎALŠÍCH 100 ('+(filtered.length-shown.length)+' zostáva)</button>');$("sportscore-more").addEventListener("click",()=>{visibleLimit+=100;render();});}
}
async function init(){
 try{
  results.innerHTML='<p style="color:#9baabe">Načítavam 30-dňovú databázu SportScore…</p>';
  const [details,fixtures]=await Promise.all([load("./data/sportscore-history/match_details.jsonl.gz"),load("./data/sportscore-history/fixtures.jsonl.gz")]);
  const map=new Map();
  details.forEach(row=>{const m=row.match||{};map.set(row.date+"|"+(row.slug||m.url||team(m,"home")+"-"+team(m,"away")),{...m,archive_date:row.date});});
  if(!map.size)fixtures.forEach(row=>{if(row.fixture)map.set(row.date+"|"+(row.fixture.url||map.size),{...row.fixture,archive_date:row.date});});
  matches=[...map.values()].sort((a,b)=>(day(b)||"").localeCompare(day(a)||""));
  const leagues=[...new Set(matches.map(league))].sort((a,b)=>a.localeCompare(b,"sk"));
  leagueFilter.innerHTML='<option value="">Všetky súťaže</option>'+leagues.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");
  render();
 }catch(e){console.error(e);meta.textContent="Historická databáza sa nepodarila načítať.";results.innerHTML='<p style="color:#fca5a5">Chyba: '+esc(e.message)+'. Archív ešte nemusí byť publikovaný do aplikácie.</p>';}
}
[search,dateFilter,leagueFilter].forEach(x=>x.addEventListener("input",()=>{visibleLimit=100;render();}));
reset.addEventListener("click",()=>{search.value="";dateFilter.value="";leagueFilter.value="";visibleLimit=100;render();});
init();
})();
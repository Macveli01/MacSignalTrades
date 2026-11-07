export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Candle = { datetime: string; open: number; high: number; low: number; close: number };
const DEFAULT_WATCHLIST = ["EUR/USD","GBP/USD","USD/JPY","XAU/USD","BTC/USD","ETH/USD"];
const SUPABASE_URL = "https://reoyfmavtaldilcawwzp.supabase.co";

function swings(c: Candle[], field: "high"|"low") {
  const out: number[] = [];
  for (let i=2;i<c.length-2;i++) {
    let ok=true;
    for(let j=i-2;j<=i+2;j++) if(j!==i && (field==="high" ? c[j].high>=c[i].high : c[j].low<=c[i].low)) ok=false;
    if(ok) out.push(i);
  }
  return out;
}
function parseBars(data: any): Candle[] {
  if(!Array.isArray(data?.bars)) throw new Error("OHLC response has no bars array");
  const bars=data.bars.filter((x:any)=>x && x.isOpen!==true).map((x:any)=>({
    datetime:String(x.openTime),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close)
  })).filter((x:Candle)=>Number.isFinite(Date.parse(x.datetime)) && [x.open,x.high,x.low,x.close].every(Number.isFinite));
  bars.sort((a:Candle,b:Candle)=>Date.parse(a.datetime)-Date.parse(b.datetime));
  if(bars.length<40) throw new Error("Fewer than 40 completed candles");
  return bars;
}
async function candles(symbol:string, interval:"5m"|"4h") {
  const url=new URL("https://biquote.io/api/"+encodeURIComponent(symbol.replaceAll("/",""))+"/ohlc");
  url.searchParams.set("interval",interval); url.searchParams.set("limit","160");
  const r=await fetch(url,{headers:{Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!r.ok) throw new Error("Biquote "+interval+" HTTP "+r.status);
  const data=await r.json(); if((data as any)?.error || (data as any)?.message) throw new Error(String((data as any).error||(data as any).message));
  return parseBars(data);
}
function findSetup(m5:Candle[],h4:Candle[],symbol:string,now:number) {
  const hs=swings(h4,"high").slice(-2),ls=swings(h4,"low").slice(-2);
  if(hs.length<2||ls.length<2) return null;
  const buy=h4[hs[1]].high>h4[hs[0]].high && h4[ls[1]].low>h4[ls[0]].low;
  const sell=h4[hs[1]].high<h4[hs[0]].high && h4[ls[1]].low<h4[ls[0]].low;
  if(!buy&&!sell) return null;
  const dir=buy?"BUY":"SELL", last=m5[m5.length-1], lastMs=Date.parse(last.datetime);
  if(lastMs+300000>now || now-(lastMs+300000)>900000) return null;
  const prior= m5.slice(0,-2), sh=swings(prior,"high"), sl=swings(prior,"low");
  if(!sh.length||!sl.length) return null;
  const ph=m5[sh[sh.length-1]].high, pl=m5[sl[sl.length-1]].low;
  const bodies=m5.slice(-22,-2).map(x=>Math.abs(x.close-x.open)).sort((a,b)=>a-b);
  const typical=bodies.length?bodies[Math.floor(bodies.length/2)]:0; if(!typical) return null;
  for(let i=m5.length-2;i>=Math.max(20,m5.length-5);i--){
    const sweep=m5[i], swept=buy?sweep.low<pl&&sweep.close>pl:sweep.high>ph&&sweep.close<ph;
    if(!swept) continue;
    for(let j=i+1;j<m5.length;j++){
      const impulse=m5[j], body=Math.abs(impulse.close-impulse.open);
      const displacement=body>=typical*1.5 && (buy?impulse.close>impulse.open&&impulse.close>=impulse.low+(impulse.high-impulse.low)*.75:impulse.close<impulse.open&&impulse.close<=impulse.high-(impulse.high-impulse.low)*.75);
      const mss=buy?impulse.close>ph:impulse.close<pl; if(!displacement||!mss||j<2) continue;
      const a=m5[j-2], zone=buy?(impulse.low>a.high?{low:a.high,high:impulse.low}:null):(impulse.high<a.low?{low:impulse.high,high:a.low}:null);
      if(!zone||zone.high<=zone.low) continue;
      if(m5.slice(j+1).some(x=>buy?x.low<=zone.high:x.high>=zone.low)) continue;
      const entry=(zone.low+zone.high)/2, stop=buy?Math.min(sweep.low,zone.low):Math.max(sweep.high,zone.high);
      const targets=buy?swings(h4,"high").map(k=>h4[k].high).filter(x=>x>entry):swings(h4,"low").map(k=>h4[k].low).filter(x=>x<entry);
      if(!targets.length) continue;
      const tp=buy?Math.min(...targets):Math.max(...targets), risk=Math.abs(entry-stop), rr=risk?Math.abs(tp-entry)/risk:0;
      if(!risk||rr<1.3) continue;
      const range=h4.slice(-20), eq=(Math.max(...range.map(x=>x.high))+Math.min(...range.map(x=>x.low)))/2;
      if(buy?entry>=eq:entry<=eq) continue;
      const round=(n:number)=>Number(n.toFixed(6));
      return {source:"biquote_public_feed",symbol,market:symbol.startsWith("XAU/")?"gold":/(BTC|ETH)/.test(symbol)?"crypto":"forex",direction:dir,timeframe:"5m",candleClosed:true,candleTime:new Date(lastMs).toISOString(),entry:round(entry),stopLoss:round(stop),takeProfit:round(tp),riskReward:round(rr),checks:{h4BiasAligned:true,liquiditySweep:true,displacement:true,mssConfirmedByClose:true,validUnmitigatedZone:true,structuralStop:true,externalLiquidityTarget:true},setup:{zoneType:"FVG",zoneLow:round(zone.low),zoneHigh:round(zone.high),sweepCandleTime:sweep.datetime,displacementCandleTime:impulse.datetime,h4Bias:dir,equilibrium:round(eq)}};
    }
  }
  return null;
}
async function autoPublish(signal:any) {
  const token=process.env.TELEGRAM_BOT_TOKEN, chatId=process.env.TELEGRAM_CHAT_ID;
  if(!token||!chatId) throw new Error("Auto-publish is enabled but Telegram credentials are missing");
  const message=[
    "MACSIGNALTRADES | "+signal.symbol,
    signal.direction+" | Entry "+signal.entry,
    "SL "+signal.stopLoss+" | TP "+signal.takeProfit+" | R:R "+signal.riskReward+"R",
    "",
    "ICT / SMC PAPER SIGNAL",
    signal.setup?.zoneType||"Validated setup",
    "H4 bias: "+signal.setup?.h4Bias,
    "Time: "+signal.candleTime,
    "",
    "PAPER SIGNAL ONLY · No trades are executed · Not financial advice"
  ].join("\\n");
  const response=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text:message,disable_web_page_preview:true}),
    cache:"no-store",signal:AbortSignal.timeout(15000)
  });
  const result=await response.json();
  if(!response.ok||!result?.ok) throw new Error("Telegram rejected automatic signal publication");
  return result.result?.message_id;
}
async function save(signal:any,key:string) {
  const input=[signal.symbol,signal.direction,signal.candleTime,signal.entry,signal.stopLoss,signal.takeProfit].join("|");
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(input));
  const fingerprint=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
  const row={fingerprint,symbol:signal.symbol,market:signal.market,direction:signal.direction,timeframe:signal.timeframe,candle_time:signal.candleTime,entry:signal.entry,stop_loss:signal.stopLoss,take_profit:signal.takeProfit,risk_reward:signal.riskReward,status:"PAPER",payload:signal};
  const r=await fetch(SUPABASE_URL+"/rest/v1/signal_journal",{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Prefer:"resolution=ignore-duplicates,return=representation"},body:JSON.stringify(row),cache:"no-store"});
  if(!r.ok) throw new Error("Supabase journal write HTTP "+r.status+": "+(await r.text()).slice(0,200));
  return (await r.json() as unknown[]).length?"PAPER_RECORDED":"DUPLICATE";
}
export async function GET() {
  return Response.json({ok:true,service:"MacSignalTrades Vercel scanner",mode:"paper-only",method:"POST",schedule:"Supabase Cron"}, {headers:{"Cache-Control":"no-store"}});
}
export async function POST(request:Request) {
  const secret=process.env.SCANNER_RUN_SECRET, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!secret || request.headers.get("authorization")!=="Bearer "+secret) return Response.json({ok:false,error:"Unauthorized"},{status:401});
  if(process.env.SCANNER_ENABLED!=="true") return Response.json({ok:true,status:"DISABLED"});
  if(!key) return Response.json({ok:false,error:"Missing SUPABASE_SERVICE_ROLE_KEY environment variable"},{status:503});
  try {
    const symbols=(process.env.WATCHLIST||DEFAULT_WATCHLIST.join(",")).split(",").map(x=>x.trim()).filter(Boolean);
    if(!symbols.length) throw new Error("Watchlist is empty");
    const now=new Date(), minute=now.getUTCHours()*60+now.getUTCMinutes();
    const slot=Math.floor((minute-360)/2);
    if(slot<0||now.getUTCHours()>17) return Response.json({ok:true,status:"OUTSIDE_SCAN_WINDOW"});
    const symbol=symbols[((slot%symbols.length)+symbols.length)%symbols.length];
    const [m5raw,h4raw]=await Promise.all([candles(symbol,"5m"),candles(symbol,"4h")]);
    const m5=m5raw.filter(x=>Date.parse(x.datetime)+300000<=now.getTime()),h4=h4raw.filter(x=>Date.parse(x.datetime)+14400000<=now.getTime());
    if(m5.length<40||h4.length<40) throw new Error("Not enough completed candles");
    const signal=findSetup(m5,h4,symbol,now.getTime());
    if(!signal) return Response.json({ok:true,status:"NO_SETUP",symbol});
    const status=await save(signal,key);
    let telegram="NOT_SENT";
    if(status==="PAPER_RECORDED" && process.env.AUTO_PUBLISH==="true") {
      try { await autoPublish(signal); telegram="SENT_TO_CHANNEL"; }
      catch(e) {
        console.error("macsignaltrades_auto_publish_error",e);
        telegram="FAILED";
      }
    }
    return Response.json({ok:true,status,telegram,symbol,direction:signal.direction,riskReward:signal.riskReward});
  } catch(e) {
    console.error("macsignaltrades_scanner_error",e);
    return Response.json({ok:false,status:"ERROR",error:e instanceof Error?e.message:"Scanner failed"},{status:503});
  }
}

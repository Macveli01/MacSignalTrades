export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type TF = "5m" | "15m" | "1h" | "4h";
type Candle = { datetime: string; open: number; high: number; low: number; close: number; volume?: number };
const DEFAULT_WATCHLIST = ["EUR/USD","GBP/USD","USD/JPY","XAU/USD","BTC/USD","ETH/USD"];
const SUPABASE_URL = "https://reoyfmavtaldilcawwzp.supabase.co";

function parseBars(data: any): Candle[] {
  if (!Array.isArray(data?.bars)) throw new Error("OHLC response has no bars array");
  const bars = data.bars.filter((x:any)=>x && x.isOpen!==true).map((x:any)=>({
    datetime:String(x.openTime), open:Number(x.open), high:Number(x.high), low:Number(x.low), close:Number(x.close), volume:Number(x.volume ?? x.tickVolume ?? x.vol ?? x.tick_volume)
  })).filter((x:Candle)=>Number.isFinite(Date.parse(x.datetime)) && [x.open,x.high,x.low,x.close].every(Number.isFinite));
  bars.sort((a:Candle,b:Candle)=>Date.parse(a.datetime)-Date.parse(b.datetime));
  if (bars.length < 40) throw new Error("Fewer than 40 completed candles");
  return bars;
}
async function candles(symbol:string, interval:TF): Promise<Candle[]> {
  const url = new URL("https://biquote.io/api/"+encodeURIComponent(symbol.replaceAll("/",""))+"/ohlc");
  url.searchParams.set("interval",interval); url.searchParams.set("limit","180");
  const r = await fetch(url,{headers:{Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(15000)});
  if (!r.ok) throw new Error("Biquote "+interval+" HTTP "+r.status);
  const data = await r.json();
  if ((data as any)?.error || (data as any)?.message) throw new Error(String((data as any).error||(data as any).message));
  return parseBars(data);
}
function pivots(c:Candle[], side:"high"|"low") {
  const out:number[]=[];
  for(let i=2;i<c.length-2;i++){
    let valid=true;
    for(let j=i-2;j<=i+2;j++) if(j!==i && (side==="high"?c[j].high>=c[i].high:c[j].low<=c[i].low)) valid=false;
    if(valid) out.push(i);
  }
  return out;
}
function median(values:number[]) {
  const a=[...values].sort((x,y)=>x-y);
  return a.length?a[Math.floor(a.length/2)]:0;
}
function volumeProfile(c:Candle[], bins=32) {
  const sample=c.slice(-120).filter(x=>Number.isFinite(x.volume)&&Number(x.volume)>0);
  if(sample.length<20) return null;
  const low=Math.min(...sample.map(x=>x.low)), high=Math.max(...sample.map(x=>x.high));
  if(!(high>low)) return null;
  const step=(high-low)/bins, levels=Array.from({length:bins},(_,i)=>({low:low+i*step,high:low+(i+1)*step,volume:0}));
  for(const candle of sample){
    const typical=(candle.high+candle.low+candle.close)/3;
    const index=Math.max(0,Math.min(bins-1,Math.floor((typical-low)/step)));
    levels[index].volume+=Number(candle.volume);
  }
  const total=levels.reduce((sum,x)=>sum+x.volume,0);
  if(!total) return null;
  const pocIndex=levels.reduce((best,x,i)=>x.volume>levels[best].volume?i:best,0);
  let left=pocIndex,right=pocIndex,covered=levels[pocIndex].volume;
  while(covered<total*0.70&&(left>0||right<bins-1)){
    const below=left>0?levels[left-1].volume:-1,above=right<bins-1?levels[right+1].volume:-1;
    if(above>below){right++;covered+=levels[right].volume;}
    else if(left>0){left--;covered+=levels[left].volume;}
    else {right++;covered+=levels[right].volume;}
  }
  const round=(n:number)=>Number(n.toFixed(6));
  const poc=levels[pocIndex],vah=levels[right],val=levels[left];
  const current=c[c.length-1].close;
  return {
    method:"OHLCV typical-price volume histogram; approximate profile",
    sourceVolumeType:"provider volume (may be tick volume for FX)",
    sampleCandles:sample.length,bins,totalVolume:round(total),
    poc:round((poc.low+poc.high)/2),vah:round(vah.high),val:round(val.low),
    currentPriceLocation:current>vah.high?"ABOVE_VALUE_AREA":current<val.low?"BELOW_VALUE_AREA":current>=val.low&&current<=vah.high?"INSIDE_VALUE_AREA":"NEAR_VALUE_AREA",
    pocDistance:round(current-(poc.low+poc.high)/2)
  };
}
function structure(c:Candle[]) {
  const hi=pivots(c,"high"), lo=pivots(c,"low");
  if(hi.length<2||lo.length<2) return null;
  const h0=c[hi[hi.length-2]].high,h1=c[hi[hi.length-1]].high;
  const l0=c[lo[lo.length-2]].low,l1=c[lo[lo.length-1]].low;
  const trend=h1>h0&&l1>l0?"BULLISH":h1<h0&&l1<l0?"BEARISH":"RANGING";
  return {hi,lo,h0,h1,l0,l1,trend,lastHigh:c[hi[hi.length-1]].high,lastLow:c[lo[lo.length-1]].low};
}
function findFvg(c:Candle[], direction:"BUY"|"SELL") {
  for(let i=c.length-1;i>=2;i--){
    const a=c[i-2],b=c[i];
    if(direction==="BUY"&&b.low>a.high) return {low:a.high,high:b.low,index:i};
    if(direction==="SELL"&&b.high<a.low) return {low:b.high,high:a.low,index:i};
  }
  return null;
}
function findOrderBlock(c:Candle[], direction:"BUY"|"SELL", breakIndex:number) {
  for(let i=breakIndex-1;i>=Math.max(0,breakIndex-10);i--){
    const x=c[i];
    if(direction==="BUY"&&x.close<x.open) return {low:x.low,high:x.open,index:i};
    if(direction==="SELL"&&x.close>x.open) return {low:x.open,high:x.high,index:i};
  }
  return null;
}
function candleConfirmation(c:Candle[], direction:"BUY"|"SELL") {
  const a=c[c.length-2],b=c[c.length-1];
  const body=Math.abs(b.close-b.open), range=b.high-b.low;
  if(range<=0||body/range<0.45) return false;
  if(direction==="BUY") return b.close>b.open && b.close>a.high && b.close>=b.low+range*0.7;
  return b.close<b.open && b.close<a.low && b.close<=b.high-range*0.7;
}
function inZone(price:number,z:{low:number;high:number}, tolerance:number) {
  return price>=z.low-tolerance && price<=z.high+tolerance;
}
function findSetup(h4:Candle[],h1:Candle[],m15:Candle[],m5:Candle[],symbol:string,now:number) {
  const s4=structure(h4),s1=structure(h1),s5=structure(m5);\n  const vp=volumeProfile(h1);
  if(!s4||!s1||!s5||s4.trend==="RANGING") return null;
  const direction=s4.trend==="BULLISH"?"BUY":"SELL";
  const opposite=direction==="BUY"?"SELL":"BUY";
  if(s1.trend!==s4.trend) return null;

  const h4Range=h4.slice(-30), rangeHigh=Math.max(...h4Range.map(x=>x.high)), rangeLow=Math.min(...h4Range.map(x=>x.low));
  const equilibrium=(rangeHigh+rangeLow)/2, h4Last=h4[h4.length-1].close;
  if(direction==="BUY" ? h4Last<equilibrium : h4Last>equilibrium) return null;
  const h4KeyLevels={swingHigh:s4.lastHigh,swingLow:s4.lastLow,equilibrium};

  const h1Last=h1[h1.length-1];
  const h1BreakIndex=h1.length-1;
  const h1Break=direction==="BUY"?h1Last.close>s1.lastHigh:h1Last.close<s1.lastLow;
  const h1Bos=direction==="BUY"?h1Last.close>s1.lastHigh:h1Last.close<s1.lastLow;
  const h1Choch=s1.trend!==s4.trend;
  if(!h1Bos||h1Choch) return null;
  const ob=findOrderBlock(h1,direction,h1BreakIndex);
  const fvg=findFvg(h1,direction);
  if(!ob&&!fvg) return null;
  const h1Zone=ob&&fvg?{low:Math.max(ob.low,fvg.low),high:Math.min(ob.high,fvg.high)}:ob||fvg!;
  if(h1Zone.high<=h1Zone.low) return null;

  const m15Last=m15[m15.length-1], m15Prev=m15[m15.length-2];
  const m15Atr=median(m15.slice(-22,-2).map(x=>x.high-x.low));
  const tolerance=Math.max(m15Atr*0.15,(h1Zone.high-h1Zone.low)*0.15);
  const retest=inZone(m15Last.low+(m15Last.high-m15Last.low)/2,h1Zone,tolerance) ||
    (direction==="BUY"?m15Last.low<=h1Zone.high+tolerance&&m15Last.close>=h1Zone.low-tolerance:m15Last.high>=h1Zone.low-tolerance&&m15Last.close<=h1Zone.high+tolerance);
  const m15Confirm=candleConfirmation(m15,direction);
  if(!retest||!m15Confirm) return null;

  const recent=m5.slice(-32,-2), hi=pivots(recent,"high"),lo=pivots(recent,"low");
  if(!hi.length||!lo.length) return null;
  const liquidityHigh=recent[hi[hi.length-1]].high,liquidityLow=recent[lo[lo.length-1]].low;
  let sweepIndex=-1;
  for(let i=m5.length-2;i>=Math.max(20,m5.length-5);i--){
    const x=m5[i];
    if(direction==="BUY"?x.low<liquidityLow&&x.close>liquidityLow:x.high>liquidityHigh&&x.close<liquidityHigh){sweepIndex=i;break;}
  }
  if(sweepIndex<0) return null;
  const base=m5.slice(-24,-3).map(x=>Math.abs(x.close-x.open));
  const typical=median(base);
  if(!typical) return null;
  let impulseIndex=-1;
  for(let i=sweepIndex+1;i<m5.length;i++){
    const x=m5[i],body=Math.abs(x.close-x.open),r=x.high-x.low;
    const displacement=body>=typical*1.5&&r>0&&(direction==="BUY"?x.close>x.open&&x.close>=x.low+r*0.75:x.close<x.open&&x.close<=x.high-r*0.75);
    const mss=direction==="BUY"?x.close>liquidityHigh:x.close<liquidityLow;
    if(displacement&&mss){impulseIndex=i;break;}
  }
  if(impulseIndex<0) return null;
  const microFvg=findFvg(m5.slice(impulseIndex-2,impulseIndex+1),direction);
  if(!microFvg) return null;
  const entry=(microFvg.low+microFvg.high)/2;
  const sweep=m5[sweepIndex],stop=direction==="BUY"?Math.min(sweep.low,microFvg.low):Math.max(sweep.high,microFvg.high);
  const targets=direction==="BUY"?s4.hi.map(i=>h4[i].high).filter(x=>x>entry):s4.lo.map(i=>h4[i].low).filter(x=>x<entry);
  if(!targets.length) return null;
  const tp=direction==="BUY"?Math.min(...targets):Math.max(...targets);
  const risk=Math.abs(entry-stop),rr=risk?Math.abs(tp-entry)/risk:0;
  if(!risk||rr<1.5) return null;
  const lastM5=m5[m5.length-1],lastMs=Date.parse(lastM5.datetime);
  if(lastMs+300000>now||now-(lastMs+300000)>900000) return null;
  const round=(n:number)=>Number(n.toFixed(6));
  return {
    source:"biquote_public_feed",symbol,market:symbol.startsWith("XAU/")?"gold":/(BTC|ETH)/.test(symbol)?"crypto":"forex",
    direction,timeframe:"5m",candleClosed:true,candleTime:new Date(lastMs).toISOString(),
    entry:round(entry),stopLoss:round(stop),takeProfit:round(tp),riskReward:round(rr),
    checks:{volumeProfileAvailable:Boolean(vp),volumeProfileIncludedAsContext:true,h4BiasAligned:true,h4KeyLevelsIdentified:true,h1TrendAligned:true,h1BosConfirmed:true,h1ChochChecked:true,h1OrderBlockFound:Boolean(ob),h1FvgFound:Boolean(fvg),m15RetestConfirmed:true,m15CandlestickConfirmation:true,m5LiquiditySweep:true,m5Displacement:true,m5MssConfirmedByClose:true,m5FvgConfirmed:true,structuralStop:true,externalLiquidityTarget:true},
    setup:{volumeProfile:vp,h4Bias:direction,h4KeyLevels:{swingHigh:round(h4KeyLevels.swingHigh),swingLow:round(h4KeyLevels.swingLow),equilibrium:round(equilibrium)},h1Structure:s1.trend,h1Bos:true,h1Choch:false,orderBlock:ob?{low:round(ob.low),high:round(ob.high)}:null,h1Fvg:fvg?{low:round(fvg.low),high:round(fvg.high)}:null,m15Retest:true,m15CandlePattern:"directional_body_close_through_previous_candle",m5SweepCandleTime:sweep.datetime,m5DisplacementCandleTime:m5[impulseIndex].datetime,zoneType:"M5_FVG",zoneLow:round(microFvg.low),zoneHigh:round(microFvg.high),equilibrium:round(equilibrium)}
  };
}

async function chartPng(bars:Candle[], timeframe:TF):Promise<string> {
  const data=bars.slice(-48);
  const labels=data.map((x,i)=>String(i+1));
  const colors=data.map(x=>x.close>=x.open?"#16a34a":"#dc2626");
  const chart={
    type:"bar",
    data:{labels,datasets:[
      {label:"Wick",data:data.map(x=>[x.low,x.high]),backgroundColor:colors,barThickness:2,categoryPercentage:0.9,barPercentage:0.9},
      {label:"Candle",data:data.map(x=>[Math.min(x.open,x.close),Math.max(x.open,x.close)]),backgroundColor:colors,borderColor:colors,borderWidth:1,barThickness:8,categoryPercentage:0.9,barPercentage:0.9}
    ]},
    options:{plugins:{legend:{display:false},title:{display:true,text:timeframe+" OHLC candles"}},animation:false,scales:{x:{type:"category",ticks:{display:false},grid:{display:false}},y:{type:"linear",position:"right",grid:{color:"#e5e7eb"}}}}
  };
  const r=await fetch("https://quickchart.io/chart",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chart,width:1000,height:560,format:"png",backgroundColor:"white",devicePixelRatio:1}),cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error("Chart rendering failed for "+timeframe+" (HTTP "+r.status+")");
  const bytes=new Uint8Array(await r.arrayBuffer());
  if(bytes.length<1000||bytes.length>2_000_000)throw new Error("Invalid rendered chart image for "+timeframe);
  let binary="";
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
  return "data:image/png;base64,"+btoa(binary);
}
async function interpretChart(signal:any,h4:Candle[],h1:Candle[],m15:Candle[],m5:Candle[]) {
  const apiKey=process.env.OPENROUTER_API_KEY;
  if(!apiKey)return {status:"NOT_CONFIGURED"};
  const [i4,i1,i15,i5]=await Promise.all([chartPng(h4,"4h"),chartPng(h1,"1h"),chartPng(m15,"15m"),chartPng(m5,"5m")]);
  const compact=(bars:Candle[])=>bars.slice(-24).map(x=>({o:x.open,h:x.high,l:x.low,c:x.close,t:x.datetime}));
  const prompt=[
    "You are an independent chart-review assistant for a PAPER-ONLY multi-timeframe forex/crypto scanner.",
    "Review the four attached candlestick charts in order: H4, H1, M15, M5. Compare the chart structure with the supplied candidate.",
    "Do not invent price levels. If the charts are unclear, conflicting, or the setup is not visibly supported, return UNCERTAIN or REJECTED.",
    "Check directional H4 context, H1 structure/BOS and nearby supply/demand or OB/FVG context, M15 pullback/retest and candle confirmation, and M5 sweep/displacement/market-structure shift.",
    "This is only an advisory cross-check. Never suggest executing a trade. Return ONLY one JSON object with keys verdict (CONFIRMED, REJECTED, UNCERTAIN), direction (BUY, SELL, NONE), confidence (integer 0-100), reason (short string), and observations (short string).",
    "Candidate: "+JSON.stringify({symbol:signal.symbol,direction:signal.direction,entry:signal.entry,stopLoss:signal.stopLoss,takeProfit:signal.takeProfit,riskReward:signal.riskReward,setup:signal.setup}),
    "Approximate H1 volume profile (POC/value area; FX volume may be tick volume): "+JSON.stringify(signal.setup?.volumeProfile||null),\n    "Recent completed OHLC context (chronological): "+JSON.stringify({H4:compact(h4),H1:compact(h1),M15:compact(m15),M5:compact(m5)})
  ].join("\n\n");
  const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json","HTTP-Referer":"https://macsignaltrades.vercel.app","X-Title":"MacSignalTrades"},body:JSON.stringify({model:"openrouter/free",messages:[{role:"user",content:[{type:"text",text:prompt},{type:"image_url",image_url:{url:i4}},{type:"image_url",image_url:{url:i1}},{type:"image_url",image_url:{url:i15}},{type:"image_url",image_url:{url:i5}}]}],temperature:0.1,max_tokens:500}),cache:"no-store",signal:AbortSignal.timeout(30000)});
  const body=await r.json();
  if(!r.ok)throw new Error("OpenRouter vision request failed (HTTP "+r.status+")");
  const raw=body?.choices?.[0]?.message?.content;
  const content=typeof raw==="string"?raw:Array.isArray(raw)?raw.map((x:any)=>x.text||"").join("\n"):"";
  const start=content.indexOf("{"),end=content.lastIndexOf("}");
  if(start<0||end<=start)throw new Error("OpenRouter returned no valid JSON review");
  const parsed=JSON.parse(content.slice(start,end+1));
  const verdict=["CONFIRMED","REJECTED","UNCERTAIN"].includes(parsed.verdict)?parsed.verdict:"UNCERTAIN";
  const direction=["BUY","SELL","NONE"].includes(parsed.direction)?parsed.direction:"NONE";
  const confidence=Number.isFinite(Number(parsed.confidence))?Math.max(0,Math.min(100,Number(parsed.confidence))):0;
  return {status:verdict==="CONFIRMED"&&direction===signal.direction&&confidence>=65?"CONFIRMED":"NOT_CONFIRMED",verdict,direction,confidence,reason:String(parsed.reason||"No explanation supplied").slice(0,500),observations:String(parsed.observations||"").slice(0,500),model:body?.model||"openrouter/free"};
}

async function autoPublish(signal:any) {
  const token=process.env.TELEGRAM_BOT_TOKEN,chatId=process.env.TELEGRAM_CHAT_ID;
  if(!token||!chatId) throw new Error("Telegram credentials are missing");
  const message=["MACSIGNALTRADES | "+signal.symbol,signal.direction+" | Entry "+signal.entry,"SL "+signal.stopLoss+" | TP "+signal.takeProfit+" | R:R "+signal.riskReward+"R","","ICT / SMC MULTI-TIMEFRAME PAPER SIGNAL","H4 bias: "+signal.setup.h4Bias,"H1: BOS + structure + OB/FVG","M15: retest + candle confirmation","M5: sweep + displacement + MSS + FVG","Time: "+signal.candleTime,"","PAPER ONLY · No trades are executed"].join("\n");
  const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chatId,text:message,disable_web_page_preview:true}),cache:"no-store",signal:AbortSignal.timeout(15000)});
  const data=await r.json();if(!r.ok||!data?.ok)throw new Error("Telegram rejected signal");return data.result?.message_id;
}
async function save(signal:any,key:string) {
  const input=[signal.symbol,signal.direction,signal.candleTime,signal.entry,signal.stopLoss,signal.takeProfit].join("|");
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(input));
  const fingerprint=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
  const row={fingerprint,symbol:signal.symbol,market:signal.market,direction:signal.direction,timeframe:signal.timeframe,candle_time:signal.candleTime,entry:signal.entry,stop_loss:signal.stopLoss,take_profit:signal.takeProfit,risk_reward:signal.riskReward,status:"PAPER",payload:signal};
  const r=await fetch(SUPABASE_URL+"/rest/v1/signal_journal",{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Prefer:"resolution=ignore-duplicates,return=representation"},body:JSON.stringify(row),cache:"no-store"});
  if(!r.ok)throw new Error("Supabase journal write HTTP "+r.status+": "+(await r.text()).slice(0,200));
  return (await r.json() as unknown[]).length?"PAPER_RECORDED":"DUPLICATE";
}
export async function GET() {
  return Response.json({ok:true,service:"MacSignalTrades multi-timeframe scanner",mode:"paper-only",timeframes:["4h","1h","15m","5m"],method:"POST",schedule:"Supabase Cron"},{headers:{"Cache-Control":"no-store"}});
}
export async function POST(request:Request) {
  const secret=process.env.SCANNER_RUN_SECRET,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!secret||request.headers.get("authorization")!=="Bearer "+secret)return Response.json({ok:false,error:"Unauthorized"},{status:401});
  if(process.env.SCANNER_ENABLED!=="true")return Response.json({ok:true,status:"DISABLED"});
  if(!key)return Response.json({ok:false,error:"Missing SUPABASE_SERVICE_ROLE_KEY"},{status:503});
  try{
    const symbols=(process.env.WATCHLIST||DEFAULT_WATCHLIST.join(",")).split(",").map(x=>x.trim()).filter(Boolean);
    if(!symbols.length)throw new Error("Watchlist is empty");
    const slot=Math.floor(Date.now()/120000),symbol=symbols[((slot%symbols.length)+symbols.length)%symbols.length],now=Date.now();
    const [h4raw,h1raw,m15raw,m5raw]=await Promise.all([candles(symbol,"4h"),candles(symbol,"1h"),candles(symbol,"15m"),candles(symbol,"5m")]);
    const intervals:Record<TF,number>={"4h":14400000,"1h":3600000,"15m":900000,"5m":300000};
    const complete=(bars:Candle[],tf:TF)=>bars.filter(x=>Date.parse(x.datetime)+intervals[tf]<=now);
    const h4=complete(h4raw,"4h"),h1=complete(h1raw,"1h"),m15=complete(m15raw,"15m"),m5=complete(m5raw,"5m");
    if([h4,h1,m15,m5].some(x=>x.length<40))throw new Error("Insufficient completed candles for all four timeframes");
    const signal:any=findSetup(h4,h1,m15,m5,symbol,now);
    if(!signal)return Response.json({ok:true,status:"NO_SETUP",symbol,timeframes:["4h","1h","15m","5m"]});
    if(process.env.OPENROUTER_API_KEY){
      const review=await interpretChart(signal,h4,h1,m15,m5);
      signal.chartReview=review;
      if(review.status!=="CONFIRMED")return Response.json({ok:true,status:"AI_REVIEW_NOT_CONFIRMED",symbol,direction:signal.direction,chartReview:review,timeframes:["4h","1h","15m","5m"]});
    }
    const status=await save(signal,key);
    let telegram="NOT_SENT";
    if(status==="PAPER_RECORDED"&&process.env.AUTO_PUBLISH==="true"){
      try{await autoPublish(signal);telegram="SENT_TO_CHANNEL";}catch(e){console.error("macsignaltrades_auto_publish_error",e);telegram="FAILED";}
    }
    return Response.json({ok:true,status,telegram,symbol,direction:signal.direction,riskReward:signal.riskReward,timeframes:["4h","1h","15m","5m"],checks:signal.checks});
  }catch(e){
    console.error("macsignaltrades_scanner_error",e);
    return Response.json({ok:false,status:"ERROR",error:e instanceof Error?e.message:"Scanner failed"},{status:503});
  }
}

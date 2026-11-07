import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SYMBOLS: Record<string,string> = {
  EURUSD:"EURUSD", GBPUSD:"GBPUSD", USDJPY:"USDJPY",
  XAUUSD:"XAUUSD", BTCUSD:"BTCUSD", ETHUSD:"ETHUSD"
};
const INTERVALS = ["5m","15m","1h","4h","1d"];

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol") || "XAUUSD";
  const interval = params.get("interval") || "15m";
  if (!SYMBOLS[symbol] || !INTERVALS.includes(interval)) {
    return NextResponse.json({ ok:false, error:"Unsupported symbol or timeframe" }, { status:400, headers:{"Cache-Control":"no-store"} });
  }
  try {
    const url = new URL("https://biquote.io/api/"+SYMBOLS[symbol]+"/ohlc");
    url.searchParams.set("interval",interval);
    url.searchParams.set("limit","120");
    const response = await fetch(url,{headers:{Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(12000)});
    if (!response.ok) return NextResponse.json({ok:false,error:"Market candle feed HTTP "+response.status},{status:502,headers:{"Cache-Control":"no-store"}});
    const data = await response.json() as any;
    if (!Array.isArray(data?.bars)) throw new Error("Candle feed returned no bars");
    const bars = data.bars.filter((x:any)=>x && x.isOpen!==true).map((x:any)=>({
      time:String(x.openTime),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),
      volume:Number(x.volume ?? x.tickVolume ?? x.vol ?? x.tick_volume) || null
    })).filter((x:any)=>Number.isFinite(Date.parse(x.time))&&[x.open,x.high,x.low,x.close].every(Number.isFinite)).slice(-100);
    if (!bars.length) throw new Error("No completed candles available");
    return NextResponse.json({ok:true,symbol,interval,bars,source:"Biquote public OHLC feed",updatedAt:new Date().toISOString()},{headers:{"Cache-Control":"no-store, max-age=0"}});
  } catch (error) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Candle feed unavailable"},{status:502,headers:{"Cache-Control":"no-store"}});
  }
}

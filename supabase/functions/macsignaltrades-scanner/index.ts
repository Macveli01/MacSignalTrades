interface Env {
  SUPABASE_SERVICE_ROLE_KEY: string;
  SCANNER_ENABLED?: string;
  SCANNER_RUN_SECRET?: string;
  WATCHLIST?: string;
}

type Candle = { datetime: string; open: number; high: number; low: number; close: number };
type Market = "forex" | "gold" | "crypto";
type Direction = "BUY" | "SELL";

const DEFAULT_WATCHLIST = ["EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "BTC/USD", "ETH/USD"];
const REQUIRED = ["h4BiasAligned", "liquiditySweep", "displacement", "mssConfirmedByClose", "validUnmitigatedZone", "structuralStop", "externalLiquidityTarget"] as const;
const MAX_M5_AGE_MS = 15 * 60_000;
const MAX_FUTURE_MS = 60_000;

function finite(n: unknown): n is number { return typeof n === "number" && Number.isFinite(n); }
function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function parseCandles(raw: unknown): Candle[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as any).bars)) {
    throw new Error("Biquote response has no bars array");
  }
  // Biquote returns newest-first bars and marks the unfinished bar isOpen=true.
  const values = (raw as any).bars
    .filter((v: any) => v && v.isOpen !== true)
    .map((v: any) => ({
      datetime: String(v.openTime),
      open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close)
    }))
    .filter((c: Candle) => c.datetime && Number.isFinite(Date.parse(c.datetime)) &&
      [c.open,c.high,c.low,c.close].every(finite));
  values.sort((a: Candle, b: Candle) => Date.parse(a.datetime) - Date.parse(b.datetime));
  if (values.length < 40) throw new Error("Biquote returned fewer than 40 completed candles");
  return values;
}
function closedCandles(candles: Candle[], intervalMs: number, now: number): Candle[] {
  return candles.filter(c => {
    const t = Date.parse(c.datetime);
    return Number.isFinite(t) && t + intervalMs <= now;
  });
}
function swingHighs(c: Candle[], left = 2, right = 2): number[] {
  const out: number[] = [];
  for (let i = left; i < c.length - right; i++) {
    let ok = true;
    for (let j = i-left; j <= i+right; j++) if (j !== i && c[j].high >= c[i].high) ok = false;
    if (ok) out.push(i);
  }
  return out;
}
function swingLows(c: Candle[], left = 2, right = 2): number[] {
  const out: number[] = [];
  for (let i = left; i < c.length - right; i++) {
    let ok = true;
    for (let j = i-left; j <= i+right; j++) if (j !== i && c[j].low <= c[i].low) ok = false;
    if (ok) out.push(i);
  }
  return out;
}
function h4Bias(c: Candle[]): Direction | null {
  const hs = swingHighs(c).slice(-2), ls = swingLows(c).slice(-2);
  if (hs.length < 2 || ls.length < 2) return null;
  const hh = c[hs[1]].high > c[hs[0]].high;
  const hl = c[ls[1]].low > c[ls[0]].low;
  const lh = c[hs[1]].high < c[hs[0]].high;
  const ll = c[ls[1]].low < c[ls[0]].low;
  if (hh && hl) return "BUY";
  if (lh && ll) return "SELL";
  return null;
}
function detect(c5: Candle[], c4: Candle[], symbol: string, now: number) {
  const bias = h4Bias(c4);
  if (!bias) return null;
  const last = c5[c5.length - 1];
  const lastTime = Date.parse(last.datetime);
  if (!Number.isFinite(lastTime) || now - (lastTime + 5*60_000) > MAX_M5_AGE_MS || lastTime > now + MAX_FUTURE_MS) return null;

  const highs = swingHighs(c5.slice(0, -2));
  const lows = swingLows(c5.slice(0, -2));
  if (!highs.length || !lows.length) return null;
  const priorHighIndex = highs[highs.length - 1];
  const priorLowIndex = lows[lows.length - 1];
  const priorHigh = c5[priorHighIndex].high;
  const priorLow = c5[priorLowIndex].low;

  // Require a recent sweep, followed by a strong close through the opposing confirmed pivot.
  const start = Math.max(20, c5.length - 5);
  const bodies = c5.slice(Math.max(0, c5.length - 22), c5.length - 2).map(x => Math.abs(x.close-x.open));
  const typicalBody = median(bodies);
  if (!(typicalBody > 0)) return null;

  for (let i = c5.length - 2; i >= start; i--) {
    const sweep = c5[i];
    const bullishSweep = bias === "BUY" && sweep.low < priorLow && sweep.close > priorLow;
    const bearishSweep = bias === "SELL" && sweep.high > priorHigh && sweep.close < priorHigh;
    if (!bullishSweep && !bearishSweep) continue;

    for (let j = i + 1; j < c5.length; j++) {
      const impulse = c5[j];
      const body = Math.abs(impulse.close-impulse.open);
      const displacement = body >= typicalBody * 1.5 &&
        (bias === "BUY" ? impulse.close > impulse.open && impulse.close >= impulse.low + (impulse.high-impulse.low)*0.75
                        : impulse.close < impulse.open && impulse.close <= impulse.high - (impulse.high-impulse.low)*0.75);
      const mss = bias === "BUY" ? impulse.close > priorHigh : impulse.close < priorLow;
      if (!displacement || !mss) continue;

      // Three-candle fair-value gap; use the latest closed candle only.
      const a = c5[j-2], b = c5[j-1], d = c5[j];
      if (!a || !b || !d) continue;
      const zone = bias === "BUY"
        ? (d.low > a.high ? { low: a.high, high: d.low } : null)
        : (d.high < a.low ? { low: d.high, high: a.low } : null);
      if (!zone || zone.high <= zone.low) continue;

      // Reject a zone already traded through by any subsequent closed candle.
      const mitigated = c5.slice(j+1).some(x => bias === "BUY" ? x.low <= zone.high : x.high >= zone.low);
      if (mitigated) continue;

      const entry = (zone.low + zone.high) / 2;
      const stopLoss = bias === "BUY" ? Math.min(sweep.low, zone.low) : Math.max(sweep.high, zone.high);
      const external = bias === "BUY" ? swingHighs(c4).map(k => c4[k].high).filter(x => x > entry)
                                      : swingLows(c4).map(k => c4[k].low).filter(x => x < entry);
      const takeProfit = bias === "BUY" ? Math.min(...external) : Math.max(...external);
      if (!Number.isFinite(takeProfit)) continue;
      const risk = Math.abs(entry-stopLoss), reward = Math.abs(takeProfit-entry);
      const rr = risk > 0 ? reward/risk : 0;
      if (!(risk > 0 && rr >= 1.5)) continue;

      // Premium/discount filter against the recent H4 dealing range.
      const range = c4.slice(-20);
      const hi = Math.max(...range.map(x=>x.high)), lo = Math.min(...range.map(x=>x.low));
      const equilibrium = (hi+lo)/2;
      if (bias === "BUY" ? entry >= equilibrium : entry <= equilibrium) continue;

      const checks = {
        h4BiasAligned: true, liquiditySweep: true, displacement: true,
        mssConfirmedByClose: true, validUnmitigatedZone: true,
        structuralStop: true, externalLiquidityTarget: true
      };
      if (!REQUIRED.every(k => checks[k])) continue;
      return {
        source: "biquote_public_feed", symbol, market: marketFor(symbol), direction: bias,
        timeframe: "5m", candleClosed: true, candleTime: new Date(lastTime).toISOString(),
        entry: round(entry), stopLoss: round(stopLoss), takeProfit: round(takeProfit),
        riskReward: round(rr), checks,
        setup: { zoneType: "FVG", zoneLow: round(zone.low), zoneHigh: round(zone.high),
          sweepCandleTime: sweep.datetime, displacementCandleTime: impulse.datetime,
          h4Bias: bias, equilibrium: round(equilibrium) }
      };
    }
  }
  return null;
}
function round(n: number) { return Number(n.toFixed(6)); }
function marketFor(symbol: string): Market {
  if (symbol.startsWith("XAU/")) return "gold";
  if (symbol.includes("BTC") || symbol.includes("ETH")) return "crypto";
  return "forex";
}
async function getCandles(symbol: string, interval: "5min"|"4h", _env: Env): Promise<Candle[]> {
  const providerSymbol = symbol.replaceAll("/", "");
  const providerInterval = interval === "5min" ? "5m" : "4h";
  const url = new URL("https://biquote.io/api/" + encodeURIComponent(providerSymbol) + "/ohlc");
  url.searchParams.set("interval", providerInterval);
  url.searchParams.set("limit", "160");
  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("Biquote HTTP " + response.status + ": " + detail.slice(0, 180));
  }
  const data = await response.json() as any;
  if (data.error || data.message) throw new Error(String(data.message || data.error));
  return parseCandles(data);
}
async function saveSignal(signal: any, env: Env): Promise<"saved"|"duplicate"> {
  const fingerprintInput = [signal.symbol,signal.direction,signal.candleTime,signal.entry,signal.stopLoss,signal.takeProfit].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprintInput));
  const fingerprint = [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
  const record = {
    fingerprint, symbol: signal.symbol, market: signal.market, direction: signal.direction,
    timeframe: signal.timeframe, candle_time: signal.candleTime, entry: signal.entry,
    stop_loss: signal.stopLoss, take_profit: signal.takeProfit, risk_reward: signal.riskReward,
    status: "PAPER", payload: signal
  };
  const response = await fetch("https://reoyfmavtaldilcawwzp.supabase.co" + "/rest/v1/signal_journal", {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type":"application/json", Prefer:"resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(record)
  });
  if (!response.ok) throw new Error("Signal journal write failed: HTTP " + response.status);
  const rows = await response.json() as unknown[];
  return Array.isArray(rows) && rows.length ? "saved" : "duplicate";
}
async function scanOne(symbol: string, env: Env, now: number) {
  // Two public Biquote OHLC requests per symbol scan (M5 + H4).
  const [m5Raw,h4Raw] = await Promise.all([getCandles(symbol,"5min",env),getCandles(symbol,"4h",env)]);
  const m5 = closedCandles(m5Raw,5*60_000,now);
  const h4 = closedCandles(h4Raw,4*60*60_000,now);
  if (m5.length < 40 || h4.length < 40) throw new Error("Not enough completed candles");
  const signal = detect(m5,h4,symbol,now);
  if (!signal) return { symbol, status:"NO_SETUP" };
  const saved = await saveSignal(signal,env);
  return { symbol, status: saved === "saved" ? "PAPER_RECORDED" : "DUPLICATE", direction: signal.direction, rr: signal.riskReward };
}

async function runScheduled(env: Env, now: Date) {
  if (env.SCANNER_ENABLED !== "true") return { status:"DISABLED" };
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY secret");
  const symbols = (env.WATCHLIST || DEFAULT_WATCHLIST.join(",")).split(",").map(x=>x.trim()).filter(Boolean);
  if (!symbols.length) throw new Error("Watchlist is empty");
  // Supabase Cron invokes every 2 minutes from 06:00–17:58 UTC (07:00–18:58 Lagos time).
  // One symbol is scanned per invocation; a six-symbol watchlist cycles every 12 minutes.
  const minuteOfDay = now.getUTCHours()*60 + now.getUTCMinutes();
  const slot = Math.floor((minuteOfDay - 6*60) / 2);
  if (slot < 0 || now.getUTCHours() > 17) return { status:"OUTSIDE_SCAN_WINDOW" };
  const symbol = symbols[((slot % symbols.length) + symbols.length) % symbols.length];
  return await scanOne(symbol,env,now.getTime());
}

type ScheduledEventLike = { scheduledTime: number; cron: string };
type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };


Deno.serve(async (request: Request) => {
  const expectedSecret = Deno.env.get("SCANNER_RUN_SECRET");
  const authorization = request.headers.get("authorization") || "";
  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return Response.json({ status: "UNAUTHORIZED" }, { status: 401 });
  }

  const env: Env = {
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    SCANNER_ENABLED: Deno.env.get("SCANNER_ENABLED") || "false",
    SCANNER_RUN_SECRET: expectedSecret,
    WATCHLIST: Deno.env.get("WATCHLIST"),
  };

  try {
    const result = await runScheduled(env, new Date());
    return Response.json(result);
  } catch (error) {
    console.error("macsignaltrades_scanner_failed", String(error));
    return Response.json({ status: "ERROR", error: String(error) }, { status: 503 });
  }
});

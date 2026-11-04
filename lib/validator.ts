export type Setup = {
  source: "tradingview";
  symbol: string;
  market: "forex" | "gold" | "crypto";
  direction: "BUY" | "SELL";
  timeframe: "5m";
  candleClosed: boolean;
  candleTime: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  checks: {
    h4BiasAligned: boolean;
    liquiditySweep: boolean;
    displacement: boolean;
    mssConfirmedByClose: boolean;
    validUnmitigatedZone: boolean;
    structuralStop: boolean;
    externalLiquidityTarget: boolean;
  };
};
export function validateSetup(input: Setup) {
  const reasons: string[] = [];
  if (input.source !== "tradingview") reasons.push("Untrusted data source");
  if (!input.symbol || input.symbol.length > 32) reasons.push("Invalid symbol");
  if (!input.candleClosed) reasons.push("Candle is not closed");
  const candleMs = Date.parse(input.candleTime);
  if (!Number.isFinite(candleMs) || Date.now() - candleMs > 10 * 60_000 || candleMs > Date.now() + 60_000) reasons.push("Missing, future or stale 5M candle");
  for (const [key, value] of Object.entries(input.checks || {})) if (value !== true) reasons.push(`Failed confirmation: ${key}`);
  const nums = [input.entry, input.stopLoss, input.takeProfit];
  if (!nums.every(n => Number.isFinite(n) && n > 0)) reasons.push("Invalid price values");
  if (input.direction === "BUY" && !(input.stopLoss < input.entry && input.takeProfit > input.entry)) reasons.push("Invalid BUY price geometry");
  if (input.direction === "SELL" && !(input.takeProfit < input.entry && input.stopLoss > input.entry)) reasons.push("Invalid SELL price geometry");
  const risk = Math.abs(input.entry - input.stopLoss);
  const reward = Math.abs(input.takeProfit - input.entry);
  const rr = risk > 0 ? reward / risk : 0;
  if (rr < 1.5) reasons.push("Risk/reward below 1.5R");
  return { valid: reasons.length === 0, reasons, riskReward: Number.isFinite(rr) ? Number(rr.toFixed(2)) : 0 };
}
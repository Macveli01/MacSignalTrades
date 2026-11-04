export type Market = "forex" | "gold" | "crypto";
export type Direction = "BUY" | "SELL";

export const REQUIRED_CONFIRMATIONS = [
  "h4BiasAligned",
  "liquiditySweep",
  "displacement",
  "mssConfirmedByClose",
  "validUnmitigatedZone",
  "structuralStop",
  "externalLiquidityTarget",
] as const;

export type Setup = {
  source: "tradingview";
  symbol: string;
  market: Market;
  direction: Direction;
  timeframe: "5m";
  candleClosed: boolean;
  candleTime: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  checks: Record<(typeof REQUIRED_CONFIRMATIONS)[number], boolean>;
};

export type ValidationResult = {
  valid: boolean;
  reasons: string[];
  riskReward: number;
};

const MAX_CANDLE_AGE_MS = 15 * 60_000;
const MAX_FUTURE_SKEW_MS = 60_000;

export function validateSetup(value: unknown, now = Date.now()): ValidationResult {
  const reasons: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reasons: ["Payload must be a JSON object"], riskReward: 0 };
  }
  const input = value as Partial<Setup> & { checks?: Record<string, unknown> };

  if (input.source !== "tradingview") reasons.push("Untrusted data source");
  if (typeof input.symbol !== "string" || !/^[A-Z0-9._!/-]{2,32}$/i.test(input.symbol)) reasons.push("Invalid symbol");
  if (!["forex", "gold", "crypto"].includes(input.market as string)) reasons.push("Unsupported market");
  if (input.direction !== "BUY" && input.direction !== "SELL") reasons.push("Invalid direction");
  if (input.timeframe !== "5m") reasons.push("Only 5M entry signals are accepted");
  if (input.candleClosed !== true) reasons.push("Candle is not confirmed closed");

  const candleMs = typeof input.candleTime === "string" ? Date.parse(input.candleTime) : NaN;
  if (!Number.isFinite(candleMs)) reasons.push("Invalid candle timestamp");
  else {
    if (candleMs > now + MAX_FUTURE_SKEW_MS) reasons.push("Candle timestamp is in the future");
    if (now - candleMs > MAX_CANDLE_AGE_MS) reasons.push("5M candle data is stale");
  }

  if (!input.checks || typeof input.checks !== "object" || Array.isArray(input.checks)) {
    reasons.push("Missing ICT/SMC confirmation block");
  } else {
    for (const key of REQUIRED_CONFIRMATIONS) {
      if (input.checks[key] !== true) reasons.push(`Failed or missing confirmation: ${key}`);
    }
  }

  const prices = [input.entry, input.stopLoss, input.takeProfit];
  if (!prices.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) {
    reasons.push("Entry, stop loss and take profit must be positive finite numbers");
  }

  let rr = 0;
  if (prices.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) {
    const entry = input.entry as number;
    const stop = input.stopLoss as number;
    const target = input.takeProfit as number;
    if (input.direction === "BUY" && !(stop < entry && target > entry)) reasons.push("Invalid BUY price geometry");
    if (input.direction === "SELL" && !(target < entry && stop > entry)) reasons.push("Invalid SELL price geometry");
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    rr = risk > 0 ? reward / risk : 0;
    if (!Number.isFinite(rr) || rr < 1.5) reasons.push("Risk/reward below strict 1.5R minimum");
  }

  return { valid: reasons.length === 0, reasons, riskReward: Number.isFinite(rr) ? Number(rr.toFixed(2)) : 0 };
}

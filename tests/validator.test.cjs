const test = require("node:test");
const assert = require("node:assert/strict");
const { validateSetup, REQUIRED_CONFIRMATIONS } = require("../.test-build/validator.js");

const now = Date.parse("2026-11-04T12:00:00.000Z");
function validSetup(overrides = {}) {
  const checks = Object.fromEntries(REQUIRED_CONFIRMATIONS.map((key) => [key, true]));
  return {
    source: "tradingview", symbol: "EURUSD", market: "forex", direction: "BUY",
    timeframe: "5m", candleClosed: true, candleTime: new Date(now - 5 * 60_000).toISOString(),
    entry: 1.1, stopLoss: 1.095, takeProfit: 1.11, checks, ...overrides
  };
}

test("accepts a complete strict setup at 2R", () => {
  const result = validateSetup(validSetup(), now);
  assert.equal(result.valid, true);
  assert.equal(result.riskReward, 2);
});
test("rejects missing mandatory confirmation even when all supplied checks pass", () => {
  const checks = Object.fromEntries(REQUIRED_CONFIRMATIONS.filter(k => k !== "mssConfirmedByClose").map(k => [k, true]));
  const result = validateSetup(validSetup({ checks }), now);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some(r => r.includes("mssConfirmedByClose")));
});
test("rejects wick-only / unclosed candles", () => {
  assert.equal(validateSetup(validSetup({ candleClosed: false }), now).valid, false);
});
test("rejects stale market data", () => {
  assert.ok(validateSetup(validSetup({ candleTime: new Date(now - 16 * 60_000).toISOString() }), now).reasons.includes("5M candle data is stale"));
});
test("rejects future timestamps", () => {
  assert.ok(validateSetup(validSetup({ candleTime: new Date(now + 2 * 60_000).toISOString() }), now).reasons.includes("Candle timestamp is in the future"));
});
test("rejects invalid BUY geometry", () => {
  assert.ok(validateSetup(validSetup({ stopLoss: 1.105 }), now).reasons.includes("Invalid BUY price geometry"));
});
test("rejects reward below 1.5R", () => {
  assert.ok(validateSetup(validSetup({ takeProfit: 1.106 }), now).reasons.includes("Risk/reward below strict 1.5R minimum"));
});
test("rejects unsupported market and timeframe", () => {
  const result = validateSetup(validSetup({ market: "equities", timeframe: "15m" }), now);
  assert.ok(result.reasons.includes("Unsupported market"));
  assert.ok(result.reasons.includes("Only 5M entry signals are accepted"));
});
test("rejects non-object payload", () => {
  assert.equal(validateSetup(null, now).valid, false);
});

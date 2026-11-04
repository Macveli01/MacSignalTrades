import { createHash, timingSafeEqual } from "node:crypto";
import { validateSetup, type Setup } from "@/lib/validator";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: Request) {
  const expected = process.env.TRADINGVIEW_WEBHOOK_SECRET || "";
  const supplied = request.headers.get("x-webhook-secret") || "";
  if (!expected || !supplied || expected.length !== supplied.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return Response.json({ accepted: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return Response.json({ accepted: false, error: "Content-Type must be application/json" }, { status: 415 });
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return Response.json({ accepted: false, error: "Payload too large" }, { status: 413 });

  let payload: Setup;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return Response.json({ accepted: false, error: "Payload too large" }, { status: 413 });
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ accepted: false, error: "Invalid JSON" }, { status: 400 });
  }

  const result = validateSetup(payload);
  if (!result.valid) {
    return Response.json({ accepted: false, status: "REJECTED", reasons: result.reasons, riskReward: result.riskReward }, { status: 422 });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json({ accepted: false, status: "NOT_RECORDED", error: "Signal journal is not configured; fail-closed" }, { status: 503 });
  }

  const fingerprint = createHash("sha256")
    .update([payload.symbol.toUpperCase(), payload.direction, payload.candleTime, payload.entry, payload.stopLoss, payload.takeProfit].join("|"))
    .digest("hex");
  const record = {
    fingerprint, symbol: payload.symbol.toUpperCase(), market: payload.market,
    direction: payload.direction, timeframe: payload.timeframe, candle_time: payload.candleTime,
    entry: payload.entry, stop_loss: payload.stopLoss, take_profit: payload.takeProfit,
    risk_reward: result.riskReward, status: "PAPER", payload
  };

  let save: Response;
  try {
    save = await fetch(`${url.replace(/\/$/, "")}/rest/v1/signal_journal`, {
      method: "POST",
      headers: {
        apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation"
      },
      body: JSON.stringify(record)
    });
  } catch {
    return Response.json({ accepted: false, status: "NOT_RECORDED", error: "Signal journal unavailable" }, { status: 502 });
  }
  if (!save.ok) return Response.json({ accepted: false, status: "NOT_RECORDED", error: "Could not save signal journal entry" }, { status: 502 });
  const saved = await save.json();
  if (!Array.isArray(saved) || saved.length === 0) {
    return Response.json({ accepted: true, status: "DUPLICATE", recorded: false, published: false, riskReward: result.riskReward });
  }

  // Paper mode is deliberately non-publishing: Telegram credentials are not read here.
  return Response.json({ accepted: true, status: "PAPER_RECORDED", recorded: true, published: false, riskReward: result.riskReward });
}

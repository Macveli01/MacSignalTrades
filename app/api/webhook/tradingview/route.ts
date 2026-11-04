import { createHash, timingSafeEqual } from "node:crypto";
import { validateSetup, type Setup } from "@/lib/validator";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const expected = process.env.TRADINGVIEW_WEBHOOK_SECRET || "";
  const supplied = request.headers.get("x-webhook-secret") || "";
  if (!expected || !supplied || expected.length !== supplied.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return Response.json({ accepted: false, error: "Unauthorized" }, { status: 401 });
  }
  let payload: Setup;
  try { payload = await request.json(); } catch { return Response.json({ accepted: false, error: "Invalid JSON" }, { status: 400 }); }
  const result = validateSetup(payload);
  if (!result.valid) return Response.json({ accepted: false, status: "REJECTED", reasons: result.reasons, riskReward: result.riskReward }, { status: 422 });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ accepted: false, status: "NOT_PUBLISHED", error: "Signal journal is not configured; fail-closed" }, { status: 503 });
  const fingerprint = createHash("sha256").update([payload.symbol,payload.direction,payload.candleTime,payload.entry,payload.stopLoss,payload.takeProfit].join("|")).digest("hex");
  const record = { fingerprint, symbol: payload.symbol, market: payload.market, direction: payload.direction, timeframe: payload.timeframe, candle_time: payload.candleTime, entry: payload.entry, stop_loss: payload.stopLoss, take_profit: payload.takeProfit, risk_reward: result.riskReward, status: "VALIDATED", payload };
  const save = await fetch(`${url.replace(/\/$/, "")}/rest/v1/signal_journal`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(record)
  });
  if (!save.ok) return Response.json({ accepted: false, status: "NOT_PUBLISHED", error: "Could not save signal journal entry" }, { status: 502 });
  const saved = await save.json();
  if (!Array.isArray(saved) || saved.length === 0) return Response.json({ accepted: true, status: "DUPLICATE", published: false, riskReward: result.riskReward });
  let published = false;
  if (process.env.AUTO_PUBLISH === "true") {
    const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return Response.json({ accepted: true, status: "VALIDATED_NOT_PUBLISHED", error: "Telegram credentials missing" });
    const message = `<b>MACSIGNALTRADES · VALIDATED SETUP</b>\n\n<b>${payload.symbol}</b> · ${payload.direction}\nEntry: <code>${payload.entry}</code>\nStop loss: <code>${payload.stopLoss}</code>\nTake profit: <code>${payload.takeProfit}</code>\nRisk/reward: <b>${result.riskReward}R</b>\nTimeframe: ${payload.timeframe}\n\n<i>Signals only. Manage risk independently.</i>`;
    const sent = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML", disable_web_page_preview: true }) });
    published = sent.ok && (await sent.json()).ok === true;
    if (!published) return Response.json({ accepted: true, status: "VALIDATED_NOT_PUBLISHED", error: "Telegram delivery failed" }, { status: 502 });
    await fetch(`${url.replace(/\/$/, "")}/rest/v1/signal_journal?fingerprint=eq.${fingerprint}`, { method: "PATCH", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "PUBLISHED" }) });
  }
  return Response.json({ accepted: true, status: published ? "PUBLISHED" : "VALIDATED_NOT_PUBLISHED", published, riskReward: result.riskReward });
}
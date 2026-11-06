export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json({ ok: false, connected: false, signals: [], error: "Signal journal is not configured" }, {
      status: 503, headers: { "Cache-Control": "no-store" }
    });
  }

  try {
    const response = await fetch(
      `${url.replace(/\/$/, "")}/rest/v1/signal_journal?select=id,symbol,market,direction,timeframe,candle_time,entry,stop_loss,take_profit,risk_reward,status,payload,created_at&order=created_at.desc&limit=100`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" }
    );
    if (!response.ok) {
      return Response.json({ ok: false, connected: false, signals: [], error: "Could not read signal journal" }, {
        status: 502, headers: { "Cache-Control": "no-store" }
      });
    }
    const signals = await response.json();
    return Response.json({ ok: true, connected: true, signals }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, connected: false, signals: [], error: "Signal journal unavailable" }, {
      status: 502, headers: { "Cache-Control": "no-store" }
    });
  }
}

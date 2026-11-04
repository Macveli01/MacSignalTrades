export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = {
    webhookSecret: Boolean(process.env.TRADINGVIEW_WEBHOOK_SECRET),
    database: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    publishingMode: "paper",
    telegramPublishing: false
  };
  const ready = configured.webhookSecret && configured.database;
  return Response.json({
    ok: true, ready,
    message: ready ? "Paper signal intake configured" : "Waiting for webhook secret and signal journal configuration",
    configured
  }, { headers: { "Cache-Control": "no-store" } });
}

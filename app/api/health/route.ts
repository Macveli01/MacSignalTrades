export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = {
    database: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    tradingViewWebhook: Boolean(process.env.TRADINGVIEW_WEBHOOK_SECRET),
    scannerArchitecture: "cloudflare_worker_pending_configuration",
    publishingMode: "paper",
    telegramPublishing: false,
    tradeExecution: false
  };
  const ready = configured.database;
  return Response.json({
    ok: true,
    ready,
    message: ready ? "Paper signal journal configured" : "Waiting for Supabase signal journal configuration",
    configured
  }, { headers: { "Cache-Control": "no-store" } });
}

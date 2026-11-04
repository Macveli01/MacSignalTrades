export const runtime = "nodejs";
export async function GET() {
  const configured = {
    webhookSecret: Boolean(process.env.TRADINGVIEW_WEBHOOK_SECRET),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    database: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    autoPublish: process.env.AUTO_PUBLISH === "true"
  };
  const ready = configured.webhookSecret && configured.database;
  return Response.json({ ok: true, ready, message: ready ? "Core services configured" : "Waiting for required environment variables", configured }, { headers: { "Cache-Control": "no-store" } });
}
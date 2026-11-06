export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const configuredSecret = process.env.TELEGRAM_PUBLISH_SECRET;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!configuredSecret || request.headers.get("x-publish-secret") !== configuredSecret) {
    return Response.json({ ok: false, error: "Publishing authorization failed" }, { status: 401 });
  }
  if (!token || !chatId) {
    return Response.json({ ok: false, error: "Telegram bot token or channel ID is not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 4000) {
      return Response.json({ ok: false, error: "Message must contain 1–4000 characters" }, { status: 400 });
    }

    const telegram = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    });
    const result = await telegram.json();
    if (!telegram.ok || !result?.ok) {
      console.error("telegram_publish_failed", result?.description || telegram.status);
      return Response.json({ ok: false, error: "Telegram rejected the message. Check bot channel permissions and credentials." }, { status: 502 });
    }
    return Response.json({ ok: true, messageId: result.result?.message_id });
  } catch (error) {
    console.error("telegram_publish_error", error);
    return Response.json({ ok: false, error: "Telegram request failed" }, { status: 502 });
  }
}

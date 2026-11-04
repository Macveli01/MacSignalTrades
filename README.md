# MacSignalTrades

A validation-first ICT/SMC signal intake dashboard for Forex, Gold and Crypto. This app publishes signals only; it never places or manages trades.

## Stack
- Next.js 14 App Router
- TradingView webhook intake
- Supabase signal journal with unique fingerprint deduplication
- Telegram Bot API (server-side only)
- Vercel deployment

## Required environment variables
Set these in Vercel Project → Settings → Environment Variables. Never commit secrets.
- `TRADINGVIEW_WEBHOOK_SECRET`: long random shared secret; sent in the `x-webhook-secret` header.
- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service-role key (server only).
- `TELEGRAM_BOT_TOKEN`: newly rotated Telegram token.
- `TELEGRAM_CHAT_ID`: channel chat ID, e.g. the configured channel ID.
- `AUTO_PUBLISH`: `false` until the full feed and channel have been tested; set `true` only after verification.

## Database
Run `supabase/schema.sql` in the Supabase SQL Editor. The unique fingerprint prevents duplicate journal entries.

## TradingView webhook
POST to `https://YOUR-DEPLOYMENT.vercel.app/api/webhook/tradingview` with header `x-webhook-secret: YOUR_SHARED_SECRET` and JSON body:
```json
{
  "source":"tradingview","symbol":"EURUSD","market":"forex","direction":"BUY","timeframe":"5m",
  "candleClosed":true,"candleTime":"2026-11-04T12:00:00.000Z",
  "entry":1.1500,"stopLoss":1.1480,"takeProfit":1.1540,
  "checks":{"h4BiasAligned":true,"liquiditySweep":true,"displacement":true,"mssConfirmedByClose":true,"validUnmitigatedZone":true,"structuralStop":true,"externalLiquidityTarget":true}
}
```
The server checks candle freshness, closed-candle status, all required confirmation flags, price geometry and minimum 1.5R. A sweep by itself cannot pass. Invalid or stale data is rejected. The TradingView alert/Pine logic that computes these flags and supplies real market prices is a separate feed configuration step; this repository does not pretend to create live prices.

## Safety and current limitations
- Automatic publishing defaults OFF.
- Missing database configuration fails closed.
- Webhook uses a shared secret header; configure the TradingView alert to send it.
- Signal flags are assertions from the trusted TradingView alert payload. Review and test the alert logic against historical data before enabling publishing.
- No MT5 feed or scheduled market scanner is included in this initial deployment.
- No automatic order execution exists.

## Local development
```bash
npm install
cp .env.example .env.local
npm run dev
```

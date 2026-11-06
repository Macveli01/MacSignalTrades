# MacSignalTrades free-tier scanner

This Worker is a **paper-only prototype scanner**. It does not place trades or publish Telegram messages.

## Architecture

- Cloudflare Workers Free runs a Cron Trigger every 2 minutes between 06:00 and 17:58 UTC (07:00–18:58 Lagos time).
- One watchlist symbol is scanned per invocation, rotating through six symbols. Each symbol is revisited about every 12 minutes.
- Each scan requests 5-minute and 4-hour candles from Twelve Data, then independently evaluates H4 swing structure, a recent liquidity sweep, displacement, MSS by candle close, a three-candle FVG, mitigation, premium/discount, structural stop, external H4 liquidity target, and minimum 1.5R.
- Valid setups are written to the existing Supabase `signal_journal` table with status `PAPER`. The unique fingerprint prevents duplicate records.
- The existing Vercel dashboard remains a separate deployment. A dashboard API/read integration is still required before these records appear in its live journal.

## Free-tier budget

The default six-symbol list is EUR/USD, GBP/USD, USD/JPY, XAU/USD, BTC/USD and ETH/USD. One symbol scan uses two Twelve Data API credits (M5 + H4). The schedule runs 360 times in a 12-hour window, for a nominal maximum of 720 credits/day, below the Basic plan's stated 800/day and 8/minute limits. This leaves only 80 credits/day of headroom. Do not add symbols or increase the frequency without recalculating the quota.

The free data plan and Cloudflare limits can change. Check your current provider dashboard and terms. Use this feed for internal analysis; it is not an Exness quote feed and can differ from Exness spreads, candles, and execution prices.

## Provisioning from Android

1. Create a Cloudflare account and open Workers & Pages.
2. Create a Worker named `macsignaltrades-scanner`.
3. Deploy this folder using Wrangler from a development environment, or paste `src/index.ts` into the Worker editor and configure the Cron Trigger `*/2 6-17 * * *`.
4. Add these Worker secrets (never commit them):
   - `TWELVE_DATA_API_KEY`: your Twelve Data API key.
   - `SUPABASE_URL`: your Supabase project URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase service-role key.
   - `SCANNER_RUN_SECRET`: a long random secret for the optional manual test endpoint.
5. Add Worker variable `SCANNER_ENABLED=true`.
6. Optionally add `WATCHLIST` as a comma-separated list. Keep it at six symbols on the default schedule.
7. Confirm the existing Supabase `signal_journal` table has been created using `supabase/schema.sql`.
8. Check `/health` on the Worker. It must report `configured: true` and `scannerEnabled: true`.
9. Watch Cloudflare logs for `scanner_failed` and confirm paper records appear in Supabase.

## Important limitations before calling it live

- The Worker does **not** connect to Exness MT5. Twelve Data is an independent market-data provider; price and candle differences versus Exness are expected.
- Twelve Data symbol availability and access to XAU/USD must be confirmed in the account before enabling the scanner.
- This first ruleset detects FVG entries only. It does not yet implement order blocks, breakers, inducement, CISD, SMT, session models, news/spread filters, or full historical replay.
- The algorithm is a conservative prototype, not a validated profitable strategy. Run it in paper mode and compare signals against Exness demo candles before relying on it.
- A free Cloudflare Worker has a 10 ms CPU budget per Cron invocation. If the Worker exceeds provider limits, the invocation can fail; inspect logs and fail closed.
- The 12-minute rotation means a symbol is not checked on every 5-minute close. The worker rejects stale candles rather than creating late signals.
- No Telegram credentials are used. No auto-publishing and no trade execution are implemented.

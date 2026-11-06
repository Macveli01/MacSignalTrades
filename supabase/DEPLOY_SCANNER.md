# MacSignalTrades scanner — Vercel runtime, Supabase database

The scanner runs as a Node.js API route on the existing Vercel project. Supabase remains the database and scheduler. This is paper-only: no orders, no Telegram publishing.

## What is already in the repository
- Scanner endpoint: `app/api/scanner/route.ts`
- Scheduler SQL: `supabase/SCANNER_SCHEDULE.sql`
- Dashboard and market feed remain unchanged.

## Required Vercel environment variables
In Vercel → Project Settings → Environment Variables, add these for **Production**:
- `SUPABASE_SERVICE_ROLE_KEY`: the service-role key from Supabase Project Settings → API. Keep it encrypted in Vercel; never put it in GitHub or chat.
- `SCANNER_RUN_SECRET`: a long random secret. The same value must be stored in Supabase Vault by the scheduler SQL.
- `SCANNER_ENABLED`: keep `false` until the manual test succeeds. Change to `true` only after validation.
- `WATCHLIST` (optional): `EUR/USD,GBP/USD,USD/JPY,XAU/USD,BTC/USD,ETH/USD`.

After adding or changing environment variables, redeploy the Vercel project so the production function receives them.

## Supabase schedule
1. In Supabase SQL Editor, open `supabase/SCANNER_SCHEDULE.sql` from this repository.
2. Replace `REPLACE_WITH_THE_SAME_LONG_RANDOM_SECRET_USED_IN_VERCEL` with the exact `SCANNER_RUN_SECRET` value saved in Vercel.
3. Run the SQL once. It stores the Vercel endpoint and bearer secret in Supabase Vault and schedules a request every two minutes from 06:00–17:58 UTC (07:00–18:58 Lagos time).

Do not run the SQL repeatedly without first checking existing Vault secrets and cron jobs; the secret names and cron job name are intended to be unique.

## Safe test
- Confirm `https://macsignaltrades.vercel.app/api/scanner` returns a service status.
- Keep `SCANNER_ENABLED=false` until Vercel has both secrets.
- For a manual POST test, use the same bearer secret. A response of `NO_SETUP` is valid when no qualifying setup exists. A response of `PAPER_RECORDED` means a paper signal was written; `DUPLICATE` means it was already recorded.
- Check `/api/signals` for database connectivity and confirm the row exists in `public.signal_journal`.

## Safety notes
The scanner uses Biquote public OHLC candles, which may differ from Exness prices/spreads. Signals are rule-based paper observations, not guaranteed profitable advice. No MT5 order execution or Telegram automation is enabled.

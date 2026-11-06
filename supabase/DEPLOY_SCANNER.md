# Deploy MacSignalTrades scanner on Supabase

This replaces Cloudflare Cron as the scanner host. The Vercel dashboard and existing Supabase database stay in place. The scanner remains paper-only and does not publish Telegram messages or place trades.

## 1. Create the Edge Function

1. Open the Supabase project dashboard.
2. Go to **Edge Functions** and create a function named `macsignaltrades-scanner`.
3. Open the GitHub file `supabase/functions/macsignaltrades-scanner/index.ts` and copy its complete contents into the Supabase function editor.
4. Deploy the function.
5. In the function's settings, turn **Verify JWT** off. This function checks its own `SCANNER_RUN_SECRET` bearer token instead. Do not make the function public without that secret check.

## 2. Add function secrets

In **Edge Functions → Secrets**, add:

- `SUPABASE_SERVICE_ROLE_KEY`: the service-role key from Project Settings → API. Store it only in Supabase secrets; never put it in GitHub or chat.
- `SCANNER_RUN_SECRET`: a new long random secret. Use the same value in the SQL schedule below.
- `SCANNER_ENABLED`: set to `false` initially.
- `WATCHLIST`: optional; default is `EUR/USD,GBP/USD,USD/JPY,XAU/USD,BTC/USD,ETH/USD`.

Do not reuse the previously exposed Telegram bot token. This scanner does not need a Telegram token.

## 3. Schedule the function

1. Open `supabase/SCANNER_SCHEDULE.sql` from this repository.
2. 3. Replace `YOUR_LONG_RANDOM_SECRET` with the exact same value saved as the `SCANNER_RUN_SECRET` function secret.
4. Run the edited SQL once in **SQL Editor**.

The project URL is already filled in. It enables pg_cron and pg_net, stores the function URL and bearer secret in Supabase Vault, and schedules the function every 2 minutes from 06:00 to 17:58 UTC (07:00–18:58 Lagos time). Market candles come from Biquote's public no-key OHLC API; no Twelve Data key is needed.

## 4. Keep it disabled until verified

Leave `SCANNER_ENABLED=false` while checking:
- The Edge Function deploys successfully.
- Function logs show no missing-secret or runtime errors.
- A manual test during the scan window returns a valid status.
- A test signal can be written to `public.signal_journal`.

Only after those checks should `SCANNER_ENABLED` be changed to `true`. This is a paper scanner, not an Exness MT5 feed or a proven profitable strategy. Biquote's public MT5 feed is not guaranteed to match your Exness account's broker feed or spreads. No automatic trading or Telegram publishing is enabled.

## Pause the schedule

Run:

```sql
select cron.unschedule('macsignaltrades-every-2-minutes');
```

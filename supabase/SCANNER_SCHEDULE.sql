-- MacSignalTrades: schedule the paper-only scanner.
-- Run this ONLY after deploying the macsignaltrades-scanner Edge Function
-- and adding SCANNER_RUN_SECRET to that function's secrets.
-- Replace YOUR_LONG_RANDOM_SECRET before running; the project URL is already set.
-- Use the SAME random secret in the Edge Function secret setting and below.

create extension if not exists pg_cron;
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_net;

select vault.create_secret(
  'https://reoyfmavtaldilcawwzp.supabase.co/functions/v1/macsignaltrades-scanner',
  'macsignaltrades_function_url'
);

select vault.create_secret(
  'YOUR_LONG_RANDOM_SECRET',
  'macsignaltrades_scanner_secret'
);

select cron.schedule(
  'macsignaltrades-every-2-minutes',
  '*/2 6-17 * * *',
  $$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'macsignaltrades_function_url'
        limit 1
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'macsignaltrades_scanner_secret'
          limit 1
        )
      ),
      body := '{}'::jsonb
    );
  $$
);

-- The cron schedule is UTC: 06:00-17:58 UTC = 07:00-18:58 Lagos time.
-- Keep SCANNER_ENABLED=false until provider access and database writes are tested.
-- To pause later: select cron.unschedule('macsignaltrades-every-2-minutes');

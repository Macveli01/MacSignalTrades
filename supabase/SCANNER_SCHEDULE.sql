-- MacSignalTrades: schedule the Vercel-hosted paper scanner from Supabase Cron.
-- Set SCANNER_RUN_SECRET in Vercel and store the SAME value below in Supabase Vault.
-- Set SUPABASE_SERVICE_ROLE_KEY and SCANNER_ENABLED=true in Vercel only after testing.
-- The URL is the stable production deployment alias.

create extension if not exists pg_cron;
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_net;

select vault.create_secret(
  'https://macsignaltrades.vercel.app/api/scanner',
  'macsignaltrades_function_url'
);

select vault.create_secret(
  'REPLACE_WITH_THE_SAME_LONG_RANDOM_SECRET_USED_IN_VERCEL',
  'macsignaltrades_scanner_secret'
);

select cron.schedule(
  'macsignaltrades-every-2-minutes',
  '*/2 * * * *',
  $$
    select net.http_post(
      url := (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'macsignaltrades_function_url' limit 1
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'macsignaltrades_scanner_secret' limit 1
        )
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Runs every two minutes, 24 hours a day, 7 days a week (UTC).
-- Scanner runs continuously when SCANNER_ENABLED=true.
-- Pause: select cron.unschedule('macsignaltrades-every-2-minutes');

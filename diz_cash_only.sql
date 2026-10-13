-- ============================================================================
-- Diz – första fasen: all betalning sker kontant direkt från kunden till utföraren.
-- Stänger av betalningslösningen i databasen (annars kräver jobs_guard en betalning vid tilldelning).
-- Kör i Supabase SQL Editor. Idempotent. För att aktivera betalningar igen:
--   update public.app_settings set value = 'mock' where key = 'payments_mode';   -- eller 'live'
-- (och sätt CASH_ONLY = false i src/payments.ts samt SWIFT: Config.cashOnly = false).
-- ============================================================================
do $$ begin
  if to_regclass('public.app_settings') is not null then
    insert into public.app_settings (key, value) values ('payments_mode', 'off')
    on conflict (key) do update set value = 'off';
  end if;
end $$;

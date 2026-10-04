-- Migration 001 — problemrapportering + automatisk betalning efter 5 dagar
-- Kör i Supabase → SQL Editor. Påverkar inte befintlig data.

alter table public.jobs add column if not exists problem_reported boolean not null default false;
alter table public.jobs add column if not exists problem_text text;
alter table public.jobs add column if not exists problem_reported_at bigint;
alter table public.jobs add column if not exists auto_released boolean not null default false;

-- Automatisk frisläppning på serversidan (var 15:e minut).
-- Om nästa rad ger fel: aktivera pg_cron under Database → Extensions och kör igen.
create extension if not exists pg_cron;
select cron.schedule(
  'diz-auto-release',
  '*/15 * * * *',
  $$
  update public.jobs
     set status = 'done',
         payment_released = true,
         auto_released = true,
         completed_at = (extract(epoch from now()) * 1000)::bigint
   where status = 'accepted'
     and marked_done_by_provider
     and not problem_reported
     and marked_done_at is not null
     and marked_done_at < (extract(epoch from now()) * 1000)::bigint - 5 * 86400000
  $$
);

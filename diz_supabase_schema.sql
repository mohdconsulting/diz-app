-- Diz — Supabase schema (v2)
-- Kör hela denna fil i: Supabase Dashboard → SQL Editor → New query → Run
-- Säkert att köra om du redan körde v1 — den börjar med att slänga de gamla tabellerna
-- (projektet är nytt så det finns ingen riktig data att förlora).

drop table if exists public.jobs;
drop table if exists public.users;

-- ============ USERS ============
-- id = telefonnumret "sanitiserat" (det är nyckeln appen loggar in med)
-- phone = telefonnumret som användaren skrev in, oförändrat
create table public.users (
  id text primary key,
  phone text not null,
  name text not null,
  password text not null,          -- OBS: klartext, samma enkla modell som prototypen hade innan
  role text not null,              -- 'customer' | 'driver' | 'admin' (admin skapas via migration_003)
  profiles jsonb not null default '[]'::jsonb,
  created_at bigint not null
);

-- ============ JOBS ============
create table public.jobs (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  service text not null,
  cat text,
  size int,
  desc_text text,
  addr text,
  to_addr text,
  price int,
  photo text,
  status text not null default 'open',   -- 'open' | 'accepted' | 'done' | 'cancelled'
  owner_phone text,
  accepted_by_phone text,
  applicants jsonb not null default '[]'::jsonb,
  arrived boolean not null default false,
  arrived_at bigint,
  marked_done_by_provider boolean not null default false,
  marked_done_at bigint,
  payment_released boolean not null default false,
  completed_at bigint,
  problem_reported boolean not null default false,
  problem_text text,
  problem_reported_at bigint,
  provider_response text,
  provider_response_at bigint,
  auto_released boolean not null default false,
  admin_note text,
  resolution text,                 -- 'released' | 'refunded' | 'cancelled' | 'reopened'
  resolved_at bigint,
  created_at bigint not null
);

-- ============ REALTIME ============
-- Gör att ändringar i tabellerna sänds live till alla uppkopplade klienter
alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.users;

-- ============ ROW LEVEL SECURITY ============
-- Prototypen har ingen riktig Supabase-auth (eget telefon+lösenord-system),
-- så vi öppnar upp för "anon"-nyckeln. OBS: detta betyder att vem som har länken till
-- appen kan läsa/skriva all data — helt okej för en prototyp/MVP, men byt till riktiga
-- RLS-policies baserade på Supabase Auth innan detta blir en skarp produkt med riktiga
-- användare och pengar inblandade.
alter table public.users enable row level security;
alter table public.jobs enable row level security;

create policy "anon full access users" on public.users
  for all using (true) with check (true);

create policy "anon full access jobs" on public.jobs
  for all using (true) with check (true);

-- ============ AUTO-RELEASE AFTER 5 DAYS ============
-- Om leverantören markerat jobbet klart och kunden inte rapporterat något problem
-- inom 5 dagar slutförs ordern och betalningen släpps automatiskt.
-- (Appen gör samma sak som reserv när någon part har den öppen.)
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

-- ============================================================================
-- Diz – betalningar (deposition/escrow) – kör EFTER diz_supabase_schema.sql
-- Idempotent: går att köra om utan att data försvinner.
--
-- Modell (belopp i IQD, tider i ms som i övriga schemat):
--   pending  -> kunden har startat en betalning
--   held     -> betald; pengarna ligger i deposition hos plattformen
--   released -> kunden godkände (eller 5 dagar gick): utföraren ska ha utbetalning
--   paid_out -> plattformen har betalat ut till utföraren
--   refund_due -> uppdraget avbröts/återöppnades med betald deposition: kunden ska ha pengarna tillbaka
--   refunded -> återbetald
--   failed   -> betalningen misslyckades/avbröts
--
-- Läge styrs av app_settings.payments_mode:
--   'off'  = ingen betalning krävs (som före detta tillägg)
--   'mock' = testbetalning: kunden trycker "Betala"/"Misslyckas" i appen (INGA riktiga pengar)
--   'live' = riktig leverantör (Qi m.fl.): betalningen bekräftas av serverfunktion/webhook via confirm_payment()
--
-- Byt läge i SQL Editor:  update public.app_settings set value = 'off' where key = 'payments_mode';
-- ============================================================================

-- ============ INSTÄLLNINGAR ============
create table if not exists public.app_settings (
  key text primary key,
  value text not null
);
insert into public.app_settings(key, value) values
  ('payments_mode', 'mock'),        -- off | mock | live
  ('commission_percent', '0')       -- plattformens provision i procent av beloppet
on conflict (key) do nothing;

alter table public.app_settings enable row level security;
drop policy if exists app_settings_read on public.app_settings;
-- Alla inloggade får läsa (inga hemligheter här – leverantörsnycklar ligger ALDRIG i databasen/klienten).
create policy app_settings_read on public.app_settings for select to authenticated using (true);
revoke insert, update, delete on public.app_settings from anon, authenticated;

create or replace function public.payments_mode() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_settings where key = 'payments_mode'), 'off')
$$;

-- ============ BETALNINGAR ============
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  job_id text not null,                    -- mjuk referens: betalningen ska finnas kvar även om uppdraget raderas
  customer_phone text not null,
  provider_phone text not null,            -- utföraren som ska få betalt
  amount int not null check (amount > 0),  -- det kunden betalar (IQD)
  commission int not null default 0 check (commission >= 0),
  payout_amount int not null,              -- amount - commission
  currency text not null default 'IQD',
  psp text not null check (psp in ('mock','qi')),   -- betalleverantör
  psp_ref text,                            -- leverantörens betalnings-id
  checkout_url text,                       -- dit kunden skickas för att betala (live)
  status text not null default 'pending'
    check (status in ('pending','held','failed','refund_due','refunded','released','paid_out')),
  failure_reason text,
  created_at bigint not null,
  paid_at bigint,
  released_at bigint,
  refunded_at bigint,
  payout_at bigint
);
create index if not exists payments_job_idx on public.payments(job_id);
-- högst en "levande" betalning per uppdrag (misslyckade/återbetalda får finnas flera av)
create unique index if not exists payments_one_active_per_job on public.payments(job_id)
  where status in ('pending','held','released','paid_out');

alter table public.payments enable row level security;
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (
    public.is_admin()
    or customer_phone = public.my_phone()
    or (provider_phone = public.my_phone() and status in ('held','released','paid_out'))
  );
-- Inga INSERT/UPDATE/DELETE-policies: klienten kan aldrig skriva i tabellen direkt, bara via funktionerna nedan.
revoke insert, update, delete on public.payments from anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.payments;
exception when duplicate_object then null; end $$;

-- Är uppdraget finansierat (pengar i deposition eller redan frisläppta)?
create or replace function public.job_is_funded(jid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.payments where job_id = jid and status in ('held','released','paid_out'))
$$;

-- ============ FUNKTIONER ============
-- Kunden startar betalning för ett tilldelat uppdrag. Idempotent: finns redan en levande betalning returneras den.
create or replace function public.create_payment(p_job_id text) returns public.payments
language plpgsql security definer set search_path = public as $$
declare
  j public.jobs; p public.payments; mode text := public.payments_mode(); pct numeric; fee int;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if mode = 'off' then raise exception 'payments are disabled'; end if;
  select * into j from public.jobs where id = p_job_id;
  if not found or j.owner_phone is distinct from public.my_phone() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if j.status <> 'accepted' or j.accepted_by_phone is null or coalesce(j.price, 0) <= 0 then
    raise exception 'job is not payable';
  end if;
  select * into p from public.payments
   where job_id = p_job_id and status in ('pending','held','released','paid_out') limit 1;
  if found then return p; end if;
  select coalesce((select value::numeric from public.app_settings where key = 'commission_percent'), 0) into pct;
  fee := round(j.price * pct / 100.0);
  insert into public.payments(job_id, customer_phone, provider_phone, amount, commission, payout_amount, psp, created_at)
  values (j.id, j.owner_phone, j.accepted_by_phone, j.price, fee, j.price - fee,
          case when mode = 'mock' then 'mock' else 'qi' end, now_ms)
  returning * into p;
  return p;
end $$;

-- MOCK: kunden "betalar" eller "misslyckas" i appen. Fungerar bara i läget 'mock'.
create or replace function public.mock_pay(p_payment_id uuid, p_success boolean) returns public.payments
language plpgsql security definer set search_path = public as $$
declare p public.payments; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if public.payments_mode() <> 'mock' then raise exception 'mock payments are not enabled'; end if;
  select * into p from public.payments where id = p_payment_id for update;
  if not found or p.customer_phone is distinct from public.my_phone() or p.psp <> 'mock' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p.status <> 'pending' then return p; end if;
  if p_success then
    update public.payments set status = 'held', paid_at = now_ms, psp_ref = 'mock-' || id where id = p.id returning * into p;
  else
    update public.payments set status = 'failed', failure_reason = 'mock: payment failed' where id = p.id returning * into p;
  end if;
  return p;
end $$;

-- LIVE (bara serverroll/service_role, anropas av webhook/Edge Function): betalningen är genomförd hos leverantören.
-- Idempotent – webhooks kan komma flera gånger.
create or replace function public.confirm_payment(p_payment_id uuid, p_psp_ref text) returns public.payments
language plpgsql security definer set search_path = public as $$
declare p public.payments; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select * into p from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment not found'; end if;
  if p.status in ('held','released','paid_out') then return p; end if;
  if p.status <> 'pending' then raise exception 'payment is %, cannot confirm', p.status; end if;
  update public.payments set status = 'held', paid_at = now_ms, psp_ref = coalesce(p_psp_ref, psp_ref)
   where id = p.id returning * into p;
  return p;
end $$;

-- LIVE (service_role): betalningen misslyckades/avbröts hos leverantören.
create or replace function public.fail_payment(p_payment_id uuid, p_reason text) returns public.payments
language plpgsql security definer set search_path = public as $$
declare p public.payments;
begin
  select * into p from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment not found'; end if;
  if p.status <> 'pending' then return p; end if;
  update public.payments set status = 'failed', failure_reason = left(p_reason, 300) where id = p.id returning * into p;
  return p;
end $$;

-- LIVE (service_role): spara leverantörens betalnings-id och checkout-länk efter att betalningen skapats hos dem.
create or replace function public.attach_checkout(p_payment_id uuid, p_psp_ref text, p_url text) returns public.payments
language plpgsql security definer set search_path = public as $$
declare p public.payments;
begin
  update public.payments set psp_ref = p_psp_ref, checkout_url = p_url
   where id = p_payment_id and status = 'pending' returning * into p;
  if not found then raise exception 'payment not pending'; end if;
  return p;
end $$;

-- Admin (eller serverrollen efter en lyckad leverantörsåtgärd): slutför återbetalning eller utbetalning.
--   'refund' : refund_due -> refunded       'payout' : released -> paid_out
-- Obs: i läge 'live' ska själva pengarna flyttas hos leverantören först; funktionen bokför bara resultatet.
create or replace function public.admin_settle_payment(p_payment_id uuid, p_action text) returns public.payments
language plpgsql security definer set search_path = public as $$
declare p public.payments; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not (public.is_admin() or auth.uid() is null) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment not found'; end if;
  if p_action = 'refund' and p.status = 'refund_due' then
    update public.payments set status = 'refunded', refunded_at = now_ms where id = p.id returning * into p;
  elsif p_action = 'payout' and p.status = 'released' then
    update public.payments set status = 'paid_out', payout_at = now_ms where id = p.id returning * into p;
  else
    raise exception 'cannot % a payment that is %', p_action, p.status;
  end if;
  return p;
end $$;

-- Behörigheter: ingen anonym åtkomst; serverfunktionerna bara för service_role.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
revoke all on function public.create_payment(text) from public, anon, authenticated;
revoke all on function public.mock_pay(uuid, boolean) from public, anon, authenticated;
revoke all on function public.confirm_payment(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_payment(uuid, text) from public, anon, authenticated;
revoke all on function public.attach_checkout(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_settle_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.create_payment(text) to authenticated;
grant execute on function public.mock_pay(uuid, boolean) to authenticated;
grant execute on function public.admin_settle_payment(uuid, text) to authenticated, service_role;
grant execute on function public.confirm_payment(uuid, text) to service_role;
grant execute on function public.fail_payment(uuid, text) to service_role;
grant execute on function public.attach_checkout(uuid, text, text) to service_role;

-- ============ KOPPLING TILL UPPDRAGEN ============
-- Vakt: när betalning krävs får utföraren inte markera ankomst/klart och kunden inte släppa betalningen
-- förrän uppdraget är finansierat. (Admin och databasens egna jobb, t.ex. pg_cron, är undantagna.)
create or replace function public.jobs_payment_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() or public.payments_mode() = 'off' then return new; end if;
  if old.status = 'accepted' and not public.job_is_funded(old.id)
     and ( new.arrived is distinct from old.arrived
        or new.marked_done_by_provider is distinct from old.marked_done_by_provider
        or new.payment_released is distinct from old.payment_released
        or (new.status = 'done' and old.status is distinct from 'done') )
  then
    raise exception 'payment required' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists jobs_payment_guard on public.jobs;
create trigger jobs_payment_guard before update on public.jobs
  for each row execute function public.jobs_payment_guard();

-- Håller betalningen i takt med uppdraget (körs även för pg_cron:s automatiska frisläppning).
create or replace function public.jobs_payment_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if new.payment_released and not old.payment_released then
    update public.payments set status = 'released', released_at = now_ms
     where job_id = new.id and status = 'held';
  elsif not new.payment_released
        and ( (new.status = 'cancelled' and old.status is distinct from 'cancelled')
           or (new.status = 'open' and old.status = 'accepted') ) then
    update public.payments set status = 'refund_due' where job_id = new.id and status = 'held';
    update public.payments set status = 'failed', failure_reason = 'job cancelled or reopened'
     where job_id = new.id and status = 'pending';
  end if;
  return new;
end $$;
drop trigger if exists jobs_payment_sync on public.jobs;
create trigger jobs_payment_sync after update on public.jobs
  for each row execute function public.jobs_payment_sync();

-- Raderas ett uppdrag (admin) med betald deposition ska kunden ha pengarna tillbaka.
create or replace function public.jobs_payment_on_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.payments set status = 'refund_due' where job_id = old.id and status = 'held';
  update public.payments set status = 'failed', failure_reason = 'job deleted' where job_id = old.id and status = 'pending';
  return old;
end $$;
drop trigger if exists jobs_payment_on_delete on public.jobs;
create trigger jobs_payment_on_delete after delete on public.jobs
  for each row execute function public.jobs_payment_on_delete();

-- Diz — Supabase schema v3 (Supabase Auth + riktiga RLS-regler)
--
-- FÖRE du kör denna fil, i Supabase Dashboard:
--   Authentication → Providers → Email: stäng AV "Confirm email" (appen loggar in med telefon+lösenord,
--   internt omvandlat till en e-postadress, så det går inte att bekräfta via mejl).
--
-- Kör sedan hela filen i: SQL Editor → New query → Run.
-- OBS: filen slänger tabellerna jobs/users och skapar om dem. Gamla konton (med klartextlösenord) och
-- gamla uppdrag försvinner — alla får registrera sig på nytt. Redan skapade Auth-användare behålls dock;
-- rensa dem under Authentication → Users om du vill börja helt om.

drop table if exists public.admin_notes;
drop table if exists public.jobs;
drop table if exists public.users;
drop function if exists public.admin_delete_user(uuid);

-- ============ USERS (profil per Auth-användare) ============
-- Inget lösenord här längre — det hanteras av Supabase Auth.
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text not null unique,
  name text not null,
  role text not null default 'customer' check (role in ('customer','driver','admin')),
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
  status text not null default 'open'
    check (status in ('open','accepted','done','cancelled')),
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
  resolution text,                 -- 'released' | 'refunded' | 'cancelled' | 'reopened' (admin-beslut)
  resolved_at bigint,
  created_at bigint not null
);

-- Interna adminanteckningar i egen tabell så att kund/utförare aldrig kan läsa dem
create table public.admin_notes (
  job_id text primary key references public.jobs(id) on delete cascade,
  note text not null,
  updated_at bigint not null
);

-- ============ HJÄLPFUNKTIONER ============
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from public.users where id = auth.uid() $$;

create or replace function public.my_phone() returns text
language sql stable security definer set search_path = public as
$$ select phone from public.users where id = auth.uid() $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'admin' from public.users where id = auth.uid()), false) $$;

-- ============ SKAPA PROFIL AUTOMATISKT VID REGISTRERING ============
-- Roll kan bara bli 'customer' eller 'driver' här — admin ges enbart via SQL (se längst ner).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  r text := case when m->>'role' = 'driver' then 'driver' else 'customer' end;
begin
  insert into public.users (id, phone, name, role, profiles, created_at)
  values (
    new.id,
    coalesce(nullif(m->>'phone',''), split_part(new.email,'@',1)),
    coalesce(nullif(m->>'name',''), '?'),
    r,
    case when r = 'driver' and jsonb_typeof(m->'profiles') = 'array' then m->'profiles' else '[]'::jsonb end,
    (extract(epoch from now()) * 1000)::bigint
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ ADMIN: RADERA ANVÄNDARE ============
create or replace function public.admin_delete_user(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if (select role from public.users where id = uid) = 'admin' then
    raise exception 'admin accounts are removed via SQL' using errcode = '42501';
  end if;
  delete from auth.users where id = uid;   -- profilraden följer med via on delete cascade
end $$;
revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ============ VAKT PÅ users: ingen kan ändra sin egen roll/telefon ============
create or replace function public.users_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.id <> old.id or new.role <> old.role or new.phone <> old.phone or new.created_at <> old.created_at then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger users_guard before update on public.users
  for each row execute function public.users_guard();

-- ============ VAKT PÅ jobs: vem får ändra vilka fält? ============
-- RLS avgör vilka RADER man når; denna trigger avgör vilka KOLUMNER/övergångar som är tillåtna.
-- Admin och databasen själv (pg_cron, SQL Editor: auth.uid() är null) får allt.
create or replace function public.jobs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me text; r text; o jsonb; n jsonb; ok boolean := false; appl jsonb;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  me := public.my_phone(); r := public.my_role();
  o := to_jsonb(old); n := to_jsonb(new);

  -- Automatisk frisläppning efter 5 dagar (kund eller utförare, som reserv till pg_cron)
  if not ok and (old.owner_phone = me or old.accepted_by_phone = me)
     and old.status = 'accepted' and new.status = 'done' and new.auto_released and new.payment_released
     and old.marked_done_by_provider and not old.problem_reported
     and old.marked_done_at is not null and old.marked_done_at < now_ms - 5*86400000
     and (n - array['status','payment_released','auto_released','completed_at']) = (o - array['status','payment_released','auto_released','completed_at'])
  then ok := true; end if;

  -- Kunden (ägaren)
  if not ok and old.owner_phone = me then
    if old.status = 'open' and new.status = 'open'
       and (n - array['service','cat','size','desc_text','addr','to_addr','price','photo'])
         = (o - array['service','cat','size','desc_text','addr','to_addr','price','photo'])
    then ok := true;                                           -- redigera öppet uppdrag
    elsif old.status = 'open' and new.status = 'accepted' then -- välj utförare bland sökande
      select v into appl from jsonb_array_elements(old.applicants) as e(v)
       where v->>'phone' = new.accepted_by_phone limit 1;
      if appl is not null and (appl->>'price')::numeric = new.price
         and (n - array['status','accepted_by_phone','price']) = (o - array['status','accepted_by_phone','price'])
      then ok := true; end if;
    elsif old.status = 'accepted' and new.status = 'done' and new.payment_released
       and (old.arrived or old.marked_done_by_provider)       -- bekräfta & släpp betalning
       and (n - array['status','payment_released','completed_at']) = (o - array['status','payment_released','completed_at'])
    then ok := true;
    elsif old.status = 'accepted' and new.status = 'accepted' and new.problem_reported and not old.problem_reported
       and (old.arrived or old.marked_done_by_provider)       -- rapportera problem
       and (n - array['problem_reported','problem_text','problem_reported_at']) = (o - array['problem_reported','problem_text','problem_reported_at'])
    then ok := true;
    end if;
  end if;

  -- Utföraren som fått jobbet
  if not ok and old.accepted_by_phone = me and old.status = 'accepted' and new.status = 'accepted'
     and (n - array['arrived','arrived_at','marked_done_by_provider','marked_done_at','provider_response','provider_response_at'])
       = (o - array['arrived','arrived_at','marked_done_by_provider','marked_done_at','provider_response','provider_response_at'])
     and (new.arrived or not old.arrived)
     and (new.marked_done_by_provider or not old.marked_done_by_provider)
     -- tidsstämpeln för "klart" styr 5-dagarsfönstret, så den får inte förfalskas
     and ( (old.marked_done_by_provider and new.marked_done_at is not distinct from old.marked_done_at)
        or (not old.marked_done_by_provider and not new.marked_done_by_provider
            and new.marked_done_at is not distinct from old.marked_done_at)
        or (not old.marked_done_by_provider and new.marked_done_by_provider
            and new.marked_done_at between now_ms - 600000 and now_ms + 600000) )
     and (new.provider_response is not distinct from old.provider_response or old.problem_reported)
  then ok := true; end if;

  -- Utförare som ansöker till ett öppet jobb: får bara röra sin egen rad i applicants
  if not ok and r = 'driver' and old.status = 'open' and new.status = 'open'
     and (n - 'applicants') = (o - 'applicants')
     and (select count(*) from jsonb_array_elements(new.applicants) as e(v) where v->>'phone' = me) <= 1
     and (select coalesce(jsonb_agg(v), '[]'::jsonb) from jsonb_array_elements(old.applicants) as e(v) where v->>'phone' <> me)
       = (select coalesce(jsonb_agg(v), '[]'::jsonb) from jsonb_array_elements(new.applicants) as e(v) where v->>'phone' <> me)
  then ok := true; end if;

  if not ok then raise exception 'forbidden job update' using errcode = '42501'; end if;
  return new;
end $$;
create trigger jobs_guard before update on public.jobs
  for each row execute function public.jobs_guard();

-- ============ ROW LEVEL SECURITY ============
alter table public.users enable row level security;
alter table public.jobs enable row level security;
alter table public.admin_notes enable row level security;

-- users: man ser/ändrar sin egen profil; admin ser allt. Inga INSERT/DELETE-policies (sköts av trigger/funktion).
create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy users_update on public.users for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- jobs
create policy jobs_select on public.jobs for select to authenticated
  using (
    public.is_admin()
    or owner_phone = public.my_phone()
    or accepted_by_phone = public.my_phone()
    or (status = 'open' and public.my_role() = 'driver')
  );
create policy jobs_insert on public.jobs for insert to authenticated
  with check (
    public.my_role() = 'customer'
    and owner_phone = public.my_phone()
    and status = 'open' and accepted_by_phone is null
    and applicants = '[]'::jsonb
    and not arrived and not marked_done_by_provider and not payment_released
    and not problem_reported and not auto_released
    and provider_response is null and resolution is null
  );
create policy jobs_update on public.jobs for update to authenticated
  using (
    public.is_admin()
    or owner_phone = public.my_phone()
    or accepted_by_phone = public.my_phone()
    or (status = 'open' and public.my_role() = 'driver')
  )
  with check (
    public.is_admin()
    or owner_phone = public.my_phone()
    or accepted_by_phone = public.my_phone()
    or (status = 'open' and public.my_role() = 'driver')
  );
create policy jobs_delete on public.jobs for delete to authenticated
  using (public.is_admin() or (owner_phone = public.my_phone() and status = 'open'));

-- admin_notes: bara admin
create policy admin_notes_all on public.admin_notes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- anon (ej inloggad) får ingen policy alls => ingen åtkomst till någon tabell.

-- ============ REALTIME ============
alter publication supabase_realtime add table public.jobs;

-- ============ AUTO-RELEASE EFTER 5 DAGAR ============
-- Om utföraren markerat jobbet klart och kunden inte rapporterat problem inom 5 dagar
-- slutförs ordern och betalningen släpps. (Körs som databasens egen användare, förbi guarden.)
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

-- ============ GÖR DIG SJÄLV TILL ADMIN ============
-- 1) Registrera ett vanligt konto i appen med ditt telefonnummer.
-- 2) Kör sedan detta (byt telefonnummer — exakt som du skrev det vid registreringen):
--
--    update public.users set role = 'admin' where phone = 'DITT-TELEFONNUMMER';
--
-- Logga ut och in igen i appen så syns adminpanelen.

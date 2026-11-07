-- ============================================================================
-- Diz – admin aktiverar tjänsteleverantörer
-- Kör i Supabase SQL Editor EFTER diz_supabase_schema.sql och övriga tillägg. Idempotent.
--
--   * public.users.approved     false för nya leverantörer tills admin aktiverar dem.
--   * Bara admin (eller SQL Editor) kan ändra approved.
--   * En ej aktiverad leverantör ser öppna jobb men kan inte lämna eller ändra anbud,
--     och en kund kan inte tilldela jobbet till en ej aktiverad leverantör.
-- ============================================================================

alter table public.users add column if not exists approved boolean not null default false;

-- Leverantörer som redan fanns när funktionen infördes räknas som aktiverade (körs bara första gången).
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'users_approval_guard') then
    update public.users set approved = true where role = 'driver';
  end if;
end $$;

-- Är leverantören med detta telefonnummer aktiverad?
create or replace function public.is_approved_provider(p_phone text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select u.approved from public.users u where u.phone = p_phone and u.role = 'driver' limit 1), false)
$$;

-- Ingen kan aktivera sig själv.
create or replace function public.users_approval_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() and new.approved is distinct from old.approved then
    raise exception 'only admin can change approval' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists users_approval_guard on public.users;
create trigger users_approval_guard before update of approved on public.users
  for each row execute function public.users_approval_guard();

-- Anbud och tilldelning kräver aktiverad leverantör. Körs vid sidan av jobs_guard (som avgör övriga regler).
create or replace function public.jobs_approval_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me text; mine_old jsonb; mine_new jsonb;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  me := public.my_phone();

  -- Leverantören lägger till eller ändrar sitt eget anbud (att dra tillbaka ett anbud är alltid tillåtet).
  if public.my_role() = 'driver' then
    select v into mine_old from jsonb_array_elements(coalesce(old.applicants, '[]'::jsonb)) as e(v) where v->>'phone' = me limit 1;
    select v into mine_new from jsonb_array_elements(coalesce(new.applicants, '[]'::jsonb)) as e(v) where v->>'phone' = me limit 1;
    if mine_new is not null and mine_new is distinct from mine_old and not public.is_approved_provider(me) then
      raise exception 'provider_not_approved' using errcode = '42501';
    end if;
  end if;

  -- Kunden väljer en leverantör.
  if old.status = 'open' and new.status = 'accepted' and not public.is_approved_provider(new.accepted_by_phone) then
    raise exception 'provider_not_approved' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists jobs_approval_guard on public.jobs;
create trigger jobs_approval_guard before update on public.jobs
  for each row execute function public.jobs_approval_guard();

-- Diz: återställ lösenord med en kod på WhatsApp.
-- Kräver diz_password_reset.sql (normalize_phone, password_reset_lookup).
-- Kör i Supabase SQL Editor. Används bara av Edge Function "whatsapp-reset" (service role); appen kommer inte åt något här.
--
--   * password_reset_codes                 en rad per skickad kod (bara hash av koden sparas)
--   * password_reset_store_code(...)       sparar ny kod, högst 3 per nummer och timme, äldre koder slutar gälla
--   * password_reset_check_code(...)       kontrollerar en kod: högst 5 försök, gäller 10 minuter, kan bara användas en gång

create table if not exists public.password_reset_codes (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  phone text not null,                     -- normalize_phone()
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_codes_phone_idx on public.password_reset_codes (phone, created_at desc);
alter table public.password_reset_codes enable row level security;
revoke all on public.password_reset_codes from anon, authenticated;

-- Returnerar false om numret redan fått 3 koder senaste timmen (då skickas ingen ny).
create or replace function public.password_reset_store_code(p_user uuid, p_phone text, p_hash text, p_minutes int default 10)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.normalize_phone(p_phone);
begin
  if v_phone = '' or p_hash is null or p_hash = '' then return false; end if;
  if (select count(*) from public.password_reset_codes
       where phone = v_phone and created_at > now() - interval '1 hour') >= 3 then
    return false;
  end if;
  -- bara den senaste koden gäller
  update public.password_reset_codes set used_at = now()
   where phone = v_phone and used_at is null;
  insert into public.password_reset_codes (user_id, phone, code_hash, expires_at)
  values (p_user, v_phone, p_hash, now() + make_interval(mins => greatest(1, least(p_minutes, 60))));
  delete from public.password_reset_codes where created_at < now() - interval '2 days';
  return true;
end $$;
revoke all on function public.password_reset_store_code(uuid, text, text, int) from public, anon, authenticated;

-- status: 'ok' (user_id ifyllt, koden förbrukad), 'invalid' (fel kod), 'expired' (ingen giltig kod), 'too_many' (5 fel)
create or replace function public.password_reset_check_code(p_phone text, p_hash text)
returns table(status text, user_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  r public.password_reset_codes%rowtype;
begin
  select * into r from public.password_reset_codes c
   where c.phone = public.normalize_phone(p_phone) and c.used_at is null
   order by c.created_at desc limit 1
   for update;
  if not found or r.expires_at <= now() then
    return query select 'expired'::text, null::uuid; return;
  end if;
  if r.attempts >= 5 then
    update public.password_reset_codes set used_at = now() where id = r.id;
    return query select 'too_many'::text, null::uuid; return;
  end if;
  if r.code_hash <> p_hash then
    update public.password_reset_codes set attempts = attempts + 1,
           used_at = case when attempts + 1 >= 5 then now() end
     where id = r.id;
    return query select (case when r.attempts + 1 >= 5 then 'too_many' else 'invalid' end)::text, null::uuid; return;
  end if;
  update public.password_reset_codes set used_at = now() where id = r.id;
  return query select 'ok'::text, r.user_id;
end $$;
revoke all on function public.password_reset_check_code(text, text) from public, anon, authenticated;

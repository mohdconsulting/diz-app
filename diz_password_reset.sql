-- ============================================================================
-- Diz – återställ lösenord via e-post
-- Kör i Supabase SQL Editor EFTER diz_supabase_schema.sql och övriga tillägg. Idempotent.
--
--   * public.users.email           kundens riktiga e-post (inloggningen är fortfarande telefon + lösenord).
--                                   Bara ägaren och admin kan läsa den (samma RLS som resten av users).
--   * handle_new_user()             sparar e-posten som appen skickar med vid registrering (metadata "email").
--   * password_reset_lookup(text)   telefon → konto + e-post. Bara service role (Edge Function), aldrig appen.
--   * password_reset_requests       logg för att begränsa antalet återställningsmejl per nummer.
--
-- Själva mejlet skickas av Edge Function supabase/functions/request-password-reset (Resend).
-- ============================================================================

alter table public.users add column if not exists email text;

-- Normaliserar ett telefonnummer på samma sätt som appens authEmail(): arabiska/persiska siffror → 0-9,
-- allt utom bokstäver/siffror bort, gemener.
create or replace function public.normalize_phone(p text) returns text
language sql immutable as $$
  select lower(regexp_replace(
    translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
    '[^a-zA-Z0-9]', '', 'g'))
$$;

-- Godtar bara något som ser ut som en e-postadress; annars null.
create or replace function public.clean_email(p text) returns text
language sql immutable as $$
  select case when lower(btrim(coalesce(p, ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(btrim(p)) end
$$;

-- Registrering: samma som i diz_supabase_schema.sql, plus e-post.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  r text := case when m->>'role' = 'driver' then 'driver' else 'customer' end;
begin
  insert into public.users (id, phone, name, role, profiles, created_at, email)
  values (
    new.id,
    coalesce(nullif(m->>'phone',''), split_part(new.email,'@',1)),
    coalesce(nullif(m->>'name',''), '?'),
    r,
    case when r = 'driver' and jsonb_typeof(m->'profiles') = 'array' then m->'profiles' else '[]'::jsonb end,
    (extract(epoch from now()) * 1000)::bigint,
    public.clean_email(m->>'email')
  );
  return new;
end $$;

-- Ändring av e-post i profilen: bara giltiga adresser (eller tomt) sparas.
create or replace function public.users_email_check() returns trigger
language plpgsql as $$
begin
  if new.email is not null and btrim(new.email) <> '' then
    new.email := public.clean_email(new.email);
    if new.email is null then raise exception 'invalid email' using errcode = '22023'; end if;
  else
    new.email := null;
  end if;
  return new;
end $$;
drop trigger if exists users_email_check on public.users;
create trigger users_email_check before insert or update of email on public.users
  for each row execute function public.users_email_check();

-- Uppslag för Edge Function (service role). Appen kan inte anropa den.
create or replace function public.password_reset_lookup(p_phone text)
returns table(id uuid, name text, email text)
language sql stable security definer set search_path = public as $$
  select u.id, u.name, u.email from public.users u
   where public.normalize_phone(u.phone) = public.normalize_phone(p_phone)
     and public.normalize_phone(p_phone) <> ''
   limit 1
$$;
revoke all on function public.password_reset_lookup(text) from public, anon, authenticated;

-- Logg över förfrågningar (begränsning: se Edge Function). Ingen RLS-policy = bara service role.
create table if not exists public.password_reset_requests (
  id bigserial primary key,
  phone text not null,
  requested_at timestamptz not null default now()
);
create index if not exists password_reset_requests_phone_idx on public.password_reset_requests (phone, requested_at);
alter table public.password_reset_requests enable row level security;
revoke all on public.password_reset_requests from anon, authenticated;

-- ============================================================================
-- Diz – "ny version finns"-notis i apparna, styrd av admin
-- Kör i Supabase SQL Editor EFTER diz_supabase_schema.sql och diz_push.sql. Idempotent.
--
--   * app_notice            en enda rad (id = 1): senaste och lägsta version per plattform, text ar/en, av/på.
--   * get_app_notice()      läses av apparna vid start (även utloggade).
--   * set_app_notice(...)   bara admin. Sparar raden; p_push = true skickar dessutom en push till alla med registrerad telefon.
--
-- Appen jämför sin version med *_latest (visar "Uppdatera / Senare") och *_min (visar "Uppdatera" utan "Senare").
-- ============================================================================

create table if not exists public.app_notice (
  id integer primary key default 1 check (id = 1),
  active boolean not null default false,
  ios_latest text not null default '',
  ios_min text not null default '',
  android_latest text not null default '',
  android_min text not null default '',
  msg_ar text not null default '',
  msg_en text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.app_notice (id) values (1) on conflict do nothing;
alter table public.app_notice enable row level security;
revoke all on public.app_notice from anon, authenticated;

create or replace function public.get_app_notice() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(n) - 'id' from public.app_notice n where id = 1
$$;
grant execute on function public.get_app_notice() to anon, authenticated;

create or replace function public.set_app_notice(
  p_active boolean, p_ios_latest text, p_ios_min text, p_android_latest text, p_android_min text,
  p_msg_ar text, p_msg_en text, p_push boolean default false
) returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record; b integer;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.app_notice set active = coalesce(p_active, false),
    ios_latest = trim(coalesce(p_ios_latest, '')), ios_min = trim(coalesce(p_ios_min, '')),
    android_latest = trim(coalesce(p_android_latest, '')), android_min = trim(coalesce(p_android_min, '')),
    msg_ar = trim(coalesce(p_msg_ar, '')), msg_en = trim(coalesce(p_msg_en, '')), updated_at = now()
  where id = 1;
  if p_push and p_active then
    -- En rad i utkorgen per användare med telefon; triggern skickar den vidare till send-push (som väljer språk per telefon).
    for r in select distinct user_id from public.push_tokens loop
      update public.users set push_badge = push_badge + 1 where id = r.user_id returning push_badge into b;
      insert into public.push_outbox (user_id, kind, params, badge)
        values (r.user_id, 'app_update', jsonb_build_object('ar', trim(p_msg_ar), 'en', trim(p_msg_en)), coalesce(b, 1));
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;
revoke all on function public.set_app_notice(boolean, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.set_app_notice(boolean, text, text, text, text, text, text, boolean) to authenticated;

-- ============================================================================
-- Diz – push-notiser till iPhone (APNs) och Android (FCM), med siffra på appikonen
-- Kör i Supabase SQL Editor EFTER diz_supabase_schema.sql, diz_chat.sql och diz_provider_approval.sql. Idempotent.
--
--   * push_tokens       en rad per telefon (token, plattform, språk). Apparna registrerar sig via register_push_token().
--   * users.push_badge   antal olästa notiser (siffran på ikonen). Nollställs av appen via reset_push_badge().
--   * push_outbox        en rad per notis och mottagare. Triggers på jobs och messages fyller den;
--                        varje ny rad skickas med pg_net till Edge Function "send-push" som pratar med Apple/Google.
--   * push_config        Edge Functions adress och en hemlig nyckel (fylls i en gång, se README).
--
-- Händelser: nytt jobb (till matchande, aktiverade leverantörer), nytt anbud (kunden), tilldelad (leverantören),
-- på plats / markerat utfört / problem / avbokat / avslutat, samt nya chattmeddelanden.
-- Den som själv orsakar händelsen får ingen notis. Bara användare med minst en registrerad telefon får notiser.
-- Ett fel här stoppar aldrig själva jobbet/meddelandet – då uteblir bara notisen.
-- ============================================================================

-- pg_net skickar HTTP-anrop från databasen (finns i Supabase; slås på här om den är av).
do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net not available: %', sqlerrm;
end $$;

create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  lang text not null default 'ar' check (lang in ('ar', 'en', 'sv')),
  env text not null default 'production' check (env in ('production', 'sandbox')),   -- APNs: Xcode-byggen använder sandbox
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;     -- bara via funktionerna nedan

alter table public.users add column if not exists push_badge integer not null default 0;

create table if not exists public.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null,
  job_id text,
  params jsonb not null default '{}'::jsonb,
  badge integer not null default 1,
  created_at timestamptz not null default now()
);
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from anon, authenticated;

create table if not exists public.push_config (
  id integer primary key default 1 check (id = 1),
  function_url text not null,          -- https://<projekt>.supabase.co/functions/v1/send-push
  secret text not null                 -- samma värde som PUSH_SECRET i Edge Function
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- ---------- Appens anrop ----------

create or replace function public.register_push_token(p_token text, p_platform text, p_lang text default 'ar', p_env text default 'production')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if coalesce(btrim(p_token), '') = '' or p_platform not in ('ios', 'android') then raise exception 'bad token' using errcode = '22023'; end if;
  insert into public.push_tokens (token, user_id, platform, lang, env, updated_at)
  values (p_token, auth.uid(), p_platform,
          case when p_lang in ('ar','en','sv') then p_lang else 'ar' end,
          case when p_env = 'sandbox' then 'sandbox' else 'production' end, now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, lang = excluded.lang, env = excluded.env, updated_at = now();
end $$;

create or replace function public.unregister_push_token(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;

create or replace function public.reset_push_badge() returns void
language sql security definer set search_path = public as $$
  update public.users set push_badge = 0 where id = auth.uid() and push_badge <> 0;
$$;

revoke all on function public.register_push_token(text, text, text, text) from public, anon;
revoke all on function public.unregister_push_token(text) from public, anon;
revoke all on function public.reset_push_badge() from public, anon;
grant execute on function public.register_push_token(text, text, text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;
grant execute on function public.reset_push_badge() to authenticated;

-- ---------- Köa en notis ----------

-- Lägger en notis i utkorgen för en användare (om hen har en registrerad telefon och inte själv orsakade händelsen).
create or replace function public.push_enqueue(p_user uuid, p_kind text, p_job text, p_params jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare b integer;
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  if not exists (select 1 from public.push_tokens t where t.user_id = p_user) then return; end if;
  update public.users set push_badge = push_badge + 1 where id = p_user returning push_badge into b;
  insert into public.push_outbox (user_id, kind, job_id, params, badge) values (p_user, p_kind, p_job, coalesce(p_params, '{}'::jsonb), coalesce(b, 1));
  if random() < 0.02 then delete from public.push_outbox where created_at < now() - interval '7 days'; end if;
exception when others then
  raise warning 'push_enqueue failed: %', sqlerrm;
end $$;

create or replace function public.push_enqueue_phone(p_phone text, p_kind text, p_job text, p_params jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if p_phone is null then return; end if;
  select id into uid from public.users where phone = p_phone limit 1;
  perform public.push_enqueue(uid, p_kind, p_job, p_params);
end $$;

-- Varje ny rad i utkorgen skickas till Edge Function (asynkront via pg_net).
create or replace function public.push_outbox_send() returns trigger
language plpgsql security definer set search_path = public as $$
declare cfg public.push_config;
begin
  select * into cfg from public.push_config where id = 1;
  if cfg is null or to_regnamespace('net') is null then return new; end if;
  perform net.http_post(
    url := cfg.function_url,
    body := jsonb_build_object('id', new.id, 'user_id', new.user_id, 'kind', new.kind, 'job_id', new.job_id,
                               'params', new.params, 'badge', new.badge),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.secret)
  );
  return new;
exception when others then
  raise warning 'push send failed: %', sqlerrm;
  return new;
end $$;
drop trigger if exists push_outbox_send on public.push_outbox;
create trigger push_outbox_send after insert on public.push_outbox
  for each row execute function public.push_outbox_send();

-- ---------- Händelser på jobb ----------

create or replace function public.jobs_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p jsonb := jsonb_build_object('service', new.service, 'cat', new.cat);
  ph text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'open' then
      -- matchande, aktiverade leverantörer (samma regel som appens jobblista)
      perform public.push_enqueue(u.id, 'new_job', new.id, p || jsonb_build_object('price', new.price))
        from public.users u
       where u.role = 'driver' and u.approved and u.phone is distinct from new.owner_phone
         and ((new.service in ('junk','moving','goods','deliver') and u.profiles ? 'driver')
           or (new.service = 'pro' and new.cat is not null and u.profiles ? new.cat)
           or (new.service = 'towing' and u.profiles ? 'towing'));
    end if;
    return new;
  end if;

  -- nytt anbud: ett telefonnummer som inte fanns bland de sökande förut
  for ph in
    select a->>'phone' from jsonb_array_elements(coalesce(new.applicants, '[]'::jsonb)) a
    except
    select a->>'phone' from jsonb_array_elements(coalesce(old.applicants, '[]'::jsonb)) a
  loop
    perform public.push_enqueue_phone(new.owner_phone, 'new_offer', new.id,
      p || jsonb_build_object('name', (select a->>'name' from jsonb_array_elements(new.applicants) a where a->>'phone' = ph limit 1)));
  end loop;

  if old.status = 'open' and new.status = 'accepted' then
    perform public.push_enqueue_phone(new.accepted_by_phone, 'assigned', new.id, p);
  end if;
  if not old.arrived and new.arrived then
    perform public.push_enqueue_phone(new.owner_phone, 'arrived', new.id, p);
  end if;
  if not old.marked_done_by_provider and new.marked_done_by_provider then
    perform public.push_enqueue_phone(new.owner_phone, 'marked_done', new.id, p);
  end if;
  if not old.problem_reported and new.problem_reported then
    perform public.push_enqueue_phone(new.accepted_by_phone, 'problem', new.id, p);
  end if;
  if (not old.payment_released and new.payment_released) or (old.status <> 'done' and new.status = 'done') then
    perform public.push_enqueue_phone(new.accepted_by_phone, 'completed', new.id, p);
  end if;
  if old.status <> 'cancelled' and new.status = 'cancelled' then
    perform public.push_enqueue_phone(new.owner_phone, 'cancelled', new.id, p);
    perform public.push_enqueue_phone(new.accepted_by_phone, 'cancelled', new.id, p);
  end if;
  return new;
exception when others then
  raise warning 'jobs_push failed: %', sqlerrm;
  return new;
end $$;
drop trigger if exists jobs_push on public.jobs;
create trigger jobs_push after insert or update on public.jobs
  for each row execute function public.jobs_push();

-- ---------- Chattmeddelanden ----------

create or replace function public.messages_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.push_enqueue_phone(new.recipient_phone, 'message', new.job_id,
    jsonb_build_object('name', (select u.name from public.users u where u.phone = new.sender_phone limit 1),
                       'text', left(new.body, 120)));
  return new;
exception when others then
  raise warning 'messages_push failed: %', sqlerrm;
  return new;
end $$;
drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages
  for each row execute function public.messages_push();

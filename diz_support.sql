-- ============================================================================
-- Diz – support: chatt mellan en användare och admin. Kör EFTER diz_supabase_schema.sql och diz_push.sql. Idempotent.
--
--  * En tråd per användare (support_messages.user_id). Användaren skriver till "Diz support"; admin läser och svarar.
--  * Läsning styrs av RLS: användaren ser bara sin egen tråd, admin ser alla. Allt skrivs via funktionerna nedan.
--  * send_support(text)                      användaren skickar (högst 10 per minut). Admin får en push.
--  * admin_reply_support(uuid, text)         admin svarar en användare. Användaren får en push.
--  * mark_support_read(uuid default null)    användaren markerar adminsvar som lästa (utan argument); admin markerar en tråd.
--  * admin_support_threads()                 en rad per användare med senaste meddelande och antal olästa.
--  * Raderas användaren raderas tråden (on delete cascade).
-- ============================================================================

create table if not exists public.support_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  from_admin boolean not null default false,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists support_messages_user_idx on public.support_messages (user_id, id);
alter table public.support_messages enable row level security;
drop policy if exists support_select on public.support_messages;
create policy support_select on public.support_messages for select to authenticated
  using (public.is_admin() or user_id = auth.uid());
revoke insert, update, delete on public.support_messages from anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.support_messages;
exception when duplicate_object then null; end $$;

create or replace function public.send_support(p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare b text := btrim(coalesce(p_body, '')); new_id bigint; nm text; a record;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if public.is_admin() then raise exception 'admins reply with admin_reply_support'; end if;
  if char_length(b) = 0 or char_length(b) > 1000 then raise exception 'invalid message'; end if;
  if (select count(*) from public.support_messages where user_id = auth.uid() and not from_admin
        and created_at > now() - interval '1 minute') >= 10 then raise exception 'too many messages'; end if;
  insert into public.support_messages (user_id, from_admin, body) values (auth.uid(), false, b) returning id into new_id;
  select name into nm from public.users where id = auth.uid();
  for a in select id from public.users where role = 'admin' loop
    perform public.push_enqueue(a.id, 'support_in', null, jsonb_build_object('name', coalesce(nm, ''), 'text', left(b, 140)));
  end loop;
  return new_id;
end $$;

create or replace function public.admin_reply_support(p_user uuid, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare b text := btrim(coalesce(p_body, '')); new_id bigint;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(b) = 0 or char_length(b) > 1000 then raise exception 'invalid message'; end if;
  if not exists (select 1 from public.users where id = p_user) then raise exception 'unknown user'; end if;
  insert into public.support_messages (user_id, from_admin, body) values (p_user, true, b) returning id into new_id;
  perform public.push_enqueue(p_user, 'support', null, jsonb_build_object('text', left(b, 140)));
  return new_id;
end $$;

create or replace function public.mark_support_read(p_user uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if public.is_admin() then
    update public.support_messages set read_at = now() where user_id = p_user and not from_admin and read_at is null;
  else
    update public.support_messages set read_at = now() where user_id = auth.uid() and from_admin and read_at is null;
  end if;
end $$;

create or replace function public.admin_support_threads()
returns table (user_id uuid, name text, phone text, role text, last_body text, last_from_admin boolean, last_at timestamptz, unread bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select u.id, u.name, u.phone, u.role, l.body, l.from_admin, l.created_at,
           (select count(*) from public.support_messages x where x.user_id = u.id and not x.from_admin and x.read_at is null)
    from public.users u
    join lateral (select m.body, m.from_admin, m.created_at from public.support_messages m where m.user_id = u.id order by m.id desc limit 1) l on true
    order by (select count(*) from public.support_messages x where x.user_id = u.id and not x.from_admin and x.read_at is null) > 0 desc, l.created_at desc;
end $$;

revoke all on function public.send_support(text) from public, anon;
revoke all on function public.admin_reply_support(uuid, text) from public, anon;
revoke all on function public.mark_support_read(uuid) from public, anon;
revoke all on function public.admin_support_threads() from public, anon;
grant execute on function public.send_support(text) to authenticated;
grant execute on function public.admin_reply_support(uuid, text) to authenticated;
grant execute on function public.mark_support_read(uuid) to authenticated;
grant execute on function public.admin_support_threads() to authenticated;

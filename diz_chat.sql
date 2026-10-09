-- ============================================================================
-- Diz – chatt mellan kund och utförare. Kör EFTER diz_supabase_schema.sql. Idempotent.
--
--  * Chatten hör till ett uppdrag och öppnas när utföraren är tilldelad (status 'accepted'). Bara kunden och den
--    tilldelade utföraren kan skriva. Efter avslut/avbrott går det inte att skriva mer, men historiken finns kvar.
--  * Läsning styrs av RLS: kunden, utföraren och admin (admin behöver kunna läsa vid reklamationer – användarna
--    informeras om det i appen). Ingen kan skriva direkt i tabellen; allt går via send_message().
--  * Meddelandena raderas automatiskt när uppdraget raderas.
-- ============================================================================

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  job_id text not null references public.jobs(id) on delete cascade,
  sender_phone text not null,
  recipient_phone text not null,
  body text not null check (char_length(body) between 1 and 1000),
  created_at bigint not null,          -- ms sedan epoch (serverns klocka)
  read_at bigint                       -- när mottagaren öppnade chatten
);
create index if not exists messages_job_idx on public.messages(job_id, id);
create index if not exists messages_recipient_idx on public.messages(recipient_phone) where read_at is null;

alter table public.messages enable row level security;
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (public.is_admin() or sender_phone = public.my_phone() or recipient_phone = public.my_phone());
-- Inga INSERT/UPDATE/DELETE-policies: allt skrivs via funktionerna nedan.
revoke insert, update, delete on public.messages from anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

-- Skicka ett meddelande. Högst 15 meddelanden per minut och uppdrag och avsändare.
create or replace function public.send_message(p_job_id text, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  j public.jobs; me text := public.my_phone(); b text := btrim(coalesce(p_body, ''));
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  rcpt text; new_id bigint;
begin
  if auth.uid() is null or me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into j from public.jobs where id = p_job_id;
  if not found or (j.owner_phone is distinct from me and j.accepted_by_phone is distinct from me) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if j.status <> 'accepted' or j.accepted_by_phone is null then raise exception 'chat is closed for this job'; end if;
  if char_length(b) = 0 or char_length(b) > 1000 then raise exception 'invalid message'; end if;
  if (select count(*) from public.messages where job_id = j.id and sender_phone = me and created_at > now_ms - 60000) >= 15 then
    raise exception 'too many messages';
  end if;
  rcpt := case when me = j.owner_phone then j.accepted_by_phone else j.owner_phone end;
  insert into public.messages(job_id, sender_phone, recipient_phone, body, created_at)
  values (j.id, me, rcpt, b, now_ms) returning id into new_id;
  return new_id;
end $$;

-- Markera allt i uppdragets chatt som läst (bara mottagaren kan göra det).
create or replace function public.mark_messages_read(p_job_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  update public.messages set read_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
  where job_id = p_job_id and recipient_phone = public.my_phone() and read_at is null;
end $$;

revoke all on function public.send_message(text, text) from public, anon, authenticated;
revoke all on function public.mark_messages_read(text) from public, anon, authenticated;
grant execute on function public.send_message(text, text) to authenticated;
grant execute on function public.mark_messages_read(text) to authenticated;

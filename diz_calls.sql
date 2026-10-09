-- ============================================================================
-- Diz – ljudsamtal i appen (WebRTC). Kör EFTER diz_supabase_schema.sql. Idempotent.
--
-- Ljudet går direkt mellan parternas webbläsare; databasen bär bara signaleringen (erbjudande, svar, ICE-kandidater, avslut).
--  * Bara kunden och den tilldelade utföraren i ett pågående uppdrag (status 'accepted') kan skicka signaler till varandra.
--  * En signal kan bara läsas av mottagaren och bara i 90 sekunder (RLS jämför mot serverns klocka). Gamla rader städas bort.
--  * Skydd mot ringspam: högst 5 samtalsförsök och 200 signaler per minut och avsändare.
--  * Inget ljud passerar eller lagras i databasen. Admin kan inte lyssna eller läsa signaler.
-- ============================================================================

create table if not exists public.call_signals (
  id bigint generated always as identity primary key,
  job_id text not null references public.jobs(id) on delete cascade,
  from_phone text not null,
  to_phone text not null,
  call_id text not null check (char_length(call_id) between 8 and 64),
  kind text not null check (kind in ('offer','answer','ice','end')),
  payload text check (payload is null or char_length(payload) <= 12000),
  created_at bigint not null           -- ms sedan epoch (serverns klocka)
);
create index if not exists call_signals_to_idx on public.call_signals(to_phone, id);

alter table public.call_signals enable row level security;
drop policy if exists call_signals_select on public.call_signals;
create policy call_signals_select on public.call_signals for select to authenticated
  using (to_phone = public.my_phone()
         and created_at > (extract(epoch from clock_timestamp()) * 1000)::bigint - 90000);
revoke insert, update, delete on public.call_signals from anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.call_signals;
exception when duplicate_object then null; end $$;

create or replace function public.send_call_signal(p_job_id text, p_call_id text, p_kind text, p_payload text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  j public.jobs; me text := public.my_phone();
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  rcpt text;
begin
  if auth.uid() is null or me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into j from public.jobs where id = p_job_id;
  if not found or (j.owner_phone is distinct from me and j.accepted_by_phone is distinct from me) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- 'end' must always get through (hang up / decline), the rest only while the job is active
  if p_kind <> 'end' and (j.status <> 'accepted' or j.accepted_by_phone is null) then raise exception 'calls are closed for this job'; end if;
  if j.accepted_by_phone is null then raise exception 'no counterpart'; end if;
  if p_kind not in ('offer','answer','ice','end') then raise exception 'invalid signal'; end if;
  if (select count(*) from public.call_signals where from_phone = me and created_at > now_ms - 60000) >= 200 then
    raise exception 'too many signals';
  end if;
  if p_kind = 'offer' and (select count(*) from public.call_signals where from_phone = me and kind = 'offer' and created_at > now_ms - 60000) >= 5 then
    raise exception 'too many calls';
  end if;
  rcpt := case when me = j.owner_phone then j.accepted_by_phone else j.owner_phone end;
  delete from public.call_signals where created_at < now_ms - 120000;
  insert into public.call_signals(job_id, from_phone, to_phone, call_id, kind, payload, created_at)
  values (j.id, me, rcpt, p_call_id, p_kind, p_payload, now_ms);
end $$;

revoke all on function public.send_call_signal(text, text, text, text) from public, anon, authenticated;
grant execute on function public.send_call_signal(text, text, text, text) to authenticated;

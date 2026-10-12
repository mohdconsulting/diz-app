-- ============================================================================
-- Diz – önskad tid för uppdraget (omgående eller valda en-timmesslottar)
-- Kör i Supabase SQL Editor EFTER diz_supabase_schema.sql. Idempotent.
--
--   jobs.schedule_type  'asap' (omgående / tidigast möjligt) eller 'slot' (valda tider); null = som 'asap' (äldre uppdrag)
--   jobs.slot_start/slot_end  millisekunder sedan epoch; ett fönster av hela timmar (varje slot = 1 timme, max 12)
--
-- Utförares förslag på annan tid ligger i jobs.applicants (proposedStart/proposedEnd per ansökan) och
-- kräver ingen databasändring: kunden godkänner genom att tilldela den utföraren.
-- ============================================================================
alter table public.jobs add column if not exists schedule_type text;
alter table public.jobs add column if not exists slot_start bigint;
alter table public.jobs add column if not exists slot_end bigint;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_schedule_check' and conrelid = 'public.jobs'::regclass) then
    alter table public.jobs add constraint jobs_schedule_check check (
      (schedule_type is null and slot_start is null and slot_end is null)
      or (schedule_type = 'asap' and slot_start is null and slot_end is null)
      or (schedule_type = 'slot' and slot_start is not null and slot_end is not null
          and slot_end > slot_start
          and (slot_end - slot_start) % 3600000 = 0
          and (slot_end - slot_start) <= 12 * 3600000)
    );
  end if;
end $$;

-- Kunden ska få ändra önskad tid när hen redigerar ett öppet uppdrag: lägg till kolumnerna i listan över
-- fält som får ändras i jobs_guard. Funktionen skrivs om utifrån sin nuvarande definition, så det fungerar oavsett
-- vilket tillägg som senast definierade den. (Kör om denna fil om du senare kör om diz_location.sql eller schemat.)
do $$
declare def text; patched text;
begin
  select pg_get_functiondef('public.jobs_guard()'::regprocedure) into def;
  if def like '%''slot_end''%' then return; end if;   -- redan patchad
  patched := replace(def, '''to_lat'',''to_lng'']', '''to_lat'',''to_lng'',''schedule_type'',''slot_start'',''slot_end'']');
  if patched = def then raise exception 'jobs_guard: expected field list not found'; end if;
  execute patched;
end $$;

-- ============================================================================
-- Diz – följ utförarens position under ett uppdrag. Kör EFTER diz_supabase_schema.sql. Idempotent.
--
-- Integritet:
--  * Utföraren startar delningen själv, per uppdrag (appen ber om platsåtkomst).
--  * Bara den senaste positionen sparas (ingen historik) och bara för uppdragets kund, utföraren själv och admin.
--  * Delningen tillåts bara medan uppdraget är tilldelat och utföraren inte markerat ankomst/klart. Så fort uppdraget
--    avslutas, avbryts, återöppnas eller utföraren markerar ankomst raderas positionen automatiskt.
-- ============================================================================

create table if not exists public.provider_locations (
  job_id text primary key references public.jobs(id) on delete cascade,
  provider_phone text not null,
  customer_phone text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy double precision,          -- meter, från enhetens GPS
  updated_at bigint not null          -- ms sedan epoch (serverns klocka)
);

alter table public.provider_locations enable row level security;
drop policy if exists provider_locations_select on public.provider_locations;
create policy provider_locations_select on public.provider_locations for select to authenticated
  using (public.is_admin() or customer_phone = public.my_phone() or provider_phone = public.my_phone());
-- Inga INSERT/UPDATE/DELETE-policies: allt skrivs via funktionerna nedan.
revoke insert, update, delete on public.provider_locations from anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.provider_locations;
exception when duplicate_object then null; end $$;

-- Utföraren skickar sin position. Högst en uppdatering per 2 sekunder och uppdrag (billigt skydd mot översvämning).
create or replace function public.share_location(p_job_id text, p_lat double precision, p_lng double precision, p_accuracy double precision default null)
returns void language plpgsql security definer set search_path = public as $$
declare j public.jobs; now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into j from public.jobs where id = p_job_id;
  if not found or j.accepted_by_phone is distinct from public.my_phone() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if j.status <> 'accepted' or j.arrived or j.marked_done_by_provider then
    raise exception 'sharing is not allowed for this job now';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid position';
  end if;
  insert into public.provider_locations(job_id, provider_phone, customer_phone, lat, lng, accuracy, updated_at)
  values (j.id, j.accepted_by_phone, j.owner_phone, p_lat, p_lng, p_accuracy, now_ms)
  on conflict (job_id) do update
    set lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy, updated_at = excluded.updated_at
    where public.provider_locations.updated_at <= now_ms - 2000;
end $$;

-- Utföraren slutar dela.
create or replace function public.stop_sharing(p_job_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  delete from public.provider_locations where job_id = p_job_id and provider_phone = public.my_phone();
end $$;

revoke all on function public.share_location(text, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.stop_sharing(text) from public, anon, authenticated;
grant execute on function public.share_location(text, double precision, double precision, double precision) to authenticated;
grant execute on function public.stop_sharing(text) to authenticated;

-- Rensa positionen så fort delningen inte längre är tillåten.
create or replace function public.jobs_location_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'accepted' or new.arrived or new.marked_done_by_provider
     or new.accepted_by_phone is distinct from old.accepted_by_phone then
    delete from public.provider_locations where job_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists jobs_location_cleanup on public.jobs;
create trigger jobs_location_cleanup after update on public.jobs
  for each row execute function public.jobs_location_cleanup();

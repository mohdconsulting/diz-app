-- Diz – valfri GPS-position på uppdragets adresser. Kör i SQL Editor på en befintlig databas (idempotent).
-- Nya installationer behöver inte köra den här filen: kolumnerna och den uppdaterade vakten finns redan i diz_supabase_schema.sql.
alter table public.jobs add column if not exists addr_lat double precision;
alter table public.jobs add column if not exists addr_lng double precision;
alter table public.jobs add column if not exists to_lat double precision;
alter table public.jobs add column if not exists to_lng double precision;

-- Samma vakt som i schemat, men kunden får även redigera positionskolumnerna på ett öppet uppdrag.
create or replace function public.jobs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me text; r text; o jsonb; n jsonb; ok boolean := false; appl jsonb;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  me := public.my_phone(); r := public.my_role();
  o := to_jsonb(old); n := to_jsonb(new);

  -- Automatisk frisläppning efter 5 dagar (kund eller utförare, som reserv till pg_cron)
  if not ok and (old.owner_phone = me or old.accepted_by_phone = me)
     and old.status = 'accepted' and new.status = 'done' and new.auto_released and new.payment_released
     and old.marked_done_by_provider and not old.problem_reported
     and old.marked_done_at is not null and old.marked_done_at < now_ms - 5*86400000
     and (n - array['status','payment_released','auto_released','completed_at']) = (o - array['status','payment_released','auto_released','completed_at'])
  then ok := true; end if;

  -- Kunden (ägaren)
  if not ok and old.owner_phone = me then
    if old.status = 'open' and new.status = 'open'
       and (n - array['service','cat','size','desc_text','addr','to_addr','price','photo','addr_lat','addr_lng','to_lat','to_lng'])
         = (o - array['service','cat','size','desc_text','addr','to_addr','price','photo','addr_lat','addr_lng','to_lat','to_lng'])
    then ok := true;                                           -- redigera öppet uppdrag
    elsif old.status = 'open' and new.status = 'accepted' then -- välj utförare bland sökande
      select v into appl from jsonb_array_elements(old.applicants) as e(v)
       where v->>'phone' = new.accepted_by_phone limit 1;
      if appl is not null and (appl->>'price')::numeric = new.price
         and (n - array['status','accepted_by_phone','price']) = (o - array['status','accepted_by_phone','price'])
      then ok := true; end if;
    elsif old.status = 'accepted' and new.status = 'done' and new.payment_released
       and (old.arrived or old.marked_done_by_provider)       -- bekräfta & släpp betalning
       and (n - array['status','payment_released','completed_at']) = (o - array['status','payment_released','completed_at'])
    then ok := true;
    elsif old.status = 'accepted' and new.status = 'accepted' and new.problem_reported and not old.problem_reported
       and (old.arrived or old.marked_done_by_provider)       -- rapportera problem
       and (n - array['problem_reported','problem_text','problem_reported_at']) = (o - array['problem_reported','problem_text','problem_reported_at'])
    then ok := true;
    end if;
  end if;

  -- Utföraren som fått jobbet
  if not ok and old.accepted_by_phone = me and old.status = 'accepted' and new.status = 'accepted'
     and (n - array['arrived','arrived_at','marked_done_by_provider','marked_done_at','provider_response','provider_response_at'])
       = (o - array['arrived','arrived_at','marked_done_by_provider','marked_done_at','provider_response','provider_response_at'])
     and (new.arrived or not old.arrived)
     and (new.marked_done_by_provider or not old.marked_done_by_provider)
     -- tidsstämpeln för "klart" styr 5-dagarsfönstret, så den får inte förfalskas
     and ( (old.marked_done_by_provider and new.marked_done_at is not distinct from old.marked_done_at)
        or (not old.marked_done_by_provider and not new.marked_done_by_provider
            and new.marked_done_at is not distinct from old.marked_done_at)
        or (not old.marked_done_by_provider and new.marked_done_by_provider
            and new.marked_done_at between now_ms - 600000 and now_ms + 600000) )
     and (new.provider_response is not distinct from old.provider_response or old.problem_reported)
  then ok := true; end if;

  -- Utförare som ansöker till ett öppet jobb: får bara röra sin egen rad i applicants
  if not ok and r = 'driver' and old.status = 'open' and new.status = 'open'
     and (n - 'applicants') = (o - 'applicants')
     and (select count(*) from jsonb_array_elements(new.applicants) as e(v) where v->>'phone' = me) <= 1
     and (select coalesce(jsonb_agg(v), '[]'::jsonb) from jsonb_array_elements(old.applicants) as e(v) where v->>'phone' <> me)
       = (select coalesce(jsonb_agg(v), '[]'::jsonb) from jsonb_array_elements(new.applicants) as e(v) where v->>'phone' <> me)
  then ok := true; end if;

  if not ok then raise exception 'forbidden job update' using errcode = '42501'; end if;
  return new;
end $$;

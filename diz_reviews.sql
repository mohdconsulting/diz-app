-- ============================================================================
-- Diz – kundrecensioner av utförare. Kör EFTER diz_supabase_schema.sql. Idempotent.
-- En recension per avslutat jobb (betyg 1–5 + valfri kommentar), skriven av jobbets kund om utföraren som utförde jobbet.
-- Recensionen kan inte ändras eller tas bort av användare. Parterna och admin kan läsa raden; alla inloggade kan bara se
-- sammanställda betyg och anonyma kommentarer via funktionerna nedan (aldrig kundens telefonnummer).
-- ============================================================================
create table if not exists public.reviews (
  job_id text primary key references public.jobs(id) on delete cascade,
  provider_phone text not null,
  customer_phone text not null,
  rating int not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 500),
  created_at bigint not null
);
create index if not exists reviews_provider_idx on public.reviews(provider_phone, created_at desc);
alter table public.reviews enable row level security;
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select to authenticated
  using (customer_phone = public.my_phone() or provider_phone = public.my_phone() or public.is_admin());
revoke insert, update, delete on public.reviews from anon, authenticated;

create or replace function public.submit_review(p_job_id text, p_rating int, p_comment text default null)
returns public.reviews language plpgsql security definer set search_path = public as $$
declare me text := public.my_phone(); j public.jobs; r public.reviews; c text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if auth.uid() is null or me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'rating must be 1-5'; end if;
  if c is not null and char_length(c) > 500 then raise exception 'comment too long'; end if;
  select * into j from public.jobs where id = p_job_id;
  if not found or j.owner_phone is distinct from me then raise exception 'only the customer of the job can review it' using errcode = '42501'; end if;
  if j.status <> 'done' or j.accepted_by_phone is null then raise exception 'the job is not completed'; end if;
  if exists (select 1 from public.reviews where job_id = p_job_id) then raise exception 'already reviewed'; end if;
  insert into public.reviews(job_id, provider_phone, customer_phone, rating, comment, created_at)
  values (p_job_id, j.accepted_by_phone, me, p_rating, c, (extract(epoch from clock_timestamp()) * 1000)::bigint)
  returning * into r;
  return r;
end $$;

-- Sammanställt betyg för givna utförare (telefonnummer) – synligt för alla inloggade.
create or replace function public.provider_ratings(p_phones text[])
returns table(provider_phone text, avg_rating numeric, review_count int)
language sql stable security definer set search_path = public as $$
  select r.provider_phone, round(avg(r.rating)::numeric, 1), count(*)::int
    from public.reviews r
   where auth.uid() is not null and r.provider_phone = any(p_phones)
   group by r.provider_phone
$$;

-- Senaste kommentarerna om en utförare, utan kundens identitet.
create or replace function public.provider_reviews(p_phone text, p_limit int default 20)
returns table(rating int, comment text, created_at bigint)
language sql stable security definer set search_path = public as $$
  select r.rating, r.comment, r.created_at from public.reviews r
   where auth.uid() is not null and r.provider_phone = p_phone
   order by r.created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

revoke all on function public.submit_review(text, int, text) from public, anon, authenticated;
revoke all on function public.provider_ratings(text[]) from public, anon, authenticated;
revoke all on function public.provider_reviews(text, int) from public, anon, authenticated;
grant execute on function public.submit_review(text, int, text) to authenticated;
grant execute on function public.provider_ratings(text[]) to authenticated;
grant execute on function public.provider_reviews(text, int) to authenticated;

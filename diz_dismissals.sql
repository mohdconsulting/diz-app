-- ============================================================================
-- Diz – tjänsteleverantören kan ignorera jobb. Kör EFTER diz_supabase_schema.sql. Idempotent.
-- Ett ignorerat jobb döljs i leverantörens jobblista (på alla enheter) men kan återställas. Det påverkar ingen annan användare.
-- ============================================================================
create table if not exists public.job_dismissals (
  provider_phone text not null,
  job_id text not null references public.jobs(id) on delete cascade,
  created_at bigint not null,
  primary key (provider_phone, job_id)
);
alter table public.job_dismissals enable row level security;
drop policy if exists job_dismissals_select on public.job_dismissals;
create policy job_dismissals_select on public.job_dismissals for select to authenticated
  using (provider_phone = public.my_phone());
revoke insert, update, delete on public.job_dismissals from anon, authenticated;

create or replace function public.dismiss_job(p_job_id text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.my_phone(); j public.jobs;
begin
  if auth.uid() is null or me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into j from public.jobs where id = p_job_id;
  if not found or j.status <> 'open' or j.owner_phone = me then raise exception 'job cannot be ignored'; end if;
  -- a job the provider has applied for is not ignorable (withdraw/assign flows stay as they are)
  if exists (select 1 from jsonb_array_elements(coalesce(j.applicants, '[]'::jsonb)) a where a->>'phone' = me) then
    raise exception 'job cannot be ignored';
  end if;
  insert into public.job_dismissals(provider_phone, job_id, created_at)
  values (me, p_job_id, (extract(epoch from clock_timestamp()) * 1000)::bigint) on conflict do nothing;
end $$;

create or replace function public.restore_job(p_job_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  delete from public.job_dismissals where job_id = p_job_id and provider_phone = public.my_phone();
end $$;

revoke all on function public.dismiss_job(text) from public, anon, authenticated;
revoke all on function public.restore_job(text) from public, anon, authenticated;
grant execute on function public.dismiss_job(text) to authenticated;
grant execute on function public.restore_job(text) to authenticated;

-- ============================================================================
-- Diz – radera eget konto (krav i App Store: kontot ska kunna raderas i appen)
-- Kör i Supabase SQL Editor EFTER diz_supabase_schema.sql och övriga tillägg. Idempotent.
--
--   rpc delete_my_account()
--     * nekas för admin och för den som har pågående uppdrag (status 'accepted')
--     * raderar egna öppna förfrågningar, egna ansökningar, chattmeddelanden och ignorerade jobb
--     * anonymiserar telefon/namn på avslutade uppdrag, recensioner och betalningsposter ('deleted')
--       (själva uppdrags- och betalningsposterna finns kvar som bokföringsunderlag)
--     * raderar inloggningen (auth.users) och profilraden
-- ============================================================================
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  me text;
  r text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select phone, role into me, r from public.users where id = uid;
  if me is null then raise exception 'unknown user' using errcode = '42501'; end if;
  if r = 'admin' then raise exception 'admin accounts are removed via SQL' using errcode = '42501'; end if;
  if exists (select 1 from public.jobs where status = 'accepted' and (owner_phone = me or accepted_by_phone = me)) then
    raise exception 'active jobs' using errcode = 'P0001';
  end if;

  -- Från och med här ska jobs_guard (som annars begränsar vad en användare får ändra) inte hindra städningen.
  -- Inställningarna gäller bara denna transaktion.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  delete from public.jobs where owner_phone = me and status = 'open';

  update public.jobs set applicants = (
      select coalesce(jsonb_agg(
               case when v->>'phone' = me then jsonb_build_object('phone','deleted','name','—','price',v->'price') else v end), '[]'::jsonb)
        from jsonb_array_elements(applicants) as e(v))
   where applicants @> jsonb_build_array(jsonb_build_object('phone', me));

  update public.jobs set owner_phone = 'deleted' where owner_phone = me;
  update public.jobs set accepted_by_phone = 'deleted' where accepted_by_phone = me;

  delete from public.messages where sender_phone = me or recipient_phone = me;
  delete from public.job_dismissals where provider_phone = me;
  if to_regclass('public.reviews') is not null then
    update public.reviews set customer_phone = 'deleted' where customer_phone = me;
    update public.reviews set provider_phone = 'deleted' where provider_phone = me;
  end if;
  if to_regclass('public.payments') is not null then
    update public.payments set customer_phone = 'deleted' where customer_phone = me;
    update public.payments set provider_phone = 'deleted' where provider_phone = me;
  end if;

  delete from auth.users where id = uid;   -- profilraden (public.users) följer med via on delete cascade
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

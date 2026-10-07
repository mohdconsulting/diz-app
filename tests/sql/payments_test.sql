-- Test av betalningslogiken mot en lokal Postgres (ingen riktig Supabase behövs).
-- Körning (som postgres-användare):
--   createdb diztest
--   cat tests/sql/supabase_mock.sql <(schema utan pg_cron-avsnittet) diz_payments.sql | psql -q -v ON_ERROR_STOP=1 diztest
--   psql -q diztest < tests/sql/payments_test.sql 2>&1 | grep -E 'PASS|FAIL'
-- Schemat utan cron: diz_supabase_schema.sql från "create extension if not exists pg_cron" till "GÖR DIG SJÄLV TILL ADMIN" borttaget.
\set ON_ERROR_STOP 0
create or replace function pg_temp.x(label text, q text, expect text) returns void language plpgsql as $$
declare n int; res text;
begin
  begin execute q; get diagnostics n = row_count; res := case when n = 0 then 'zero' else 'ok' end;
  exception when others then res := 'fail'; end;
  raise notice '% % (got %, wanted %)', case when res=expect then 'PASS' else '*** FAIL' end, label, res, expect;
end $$;
grant execute on function pg_temp.x(text,text,text) to public;
create or replace function pg_temp.eq(label text, got text, want text) returns void language plpgsql as $$
begin raise notice '% % (got %, wanted %)', case when got is not distinct from want then 'PASS' else '*** FAIL' end, label, got, want; end $$;
grant execute on function pg_temp.eq(text,text,text) to public;
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a1','c1@x','{"name":"Cust1","phone":"c1","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000a2','c2@x','{"name":"Cust2","phone":"c2","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000b1','d1@x','{"name":"Drv1","phone":"d1","role":"driver"}'),
 ('00000000-0000-0000-0000-0000000000b2','d2@x','{"name":"Drv2","phone":"d2","role":"driver"}'),
 ('00000000-0000-0000-0000-0000000000ad','ad@x','{"name":"Adm","phone":"ad"}');
update public.users set role='admin' where phone='ad';
insert into public.jobs(id,service,price,owner_phone,created_at,status,accepted_by_phone,applicants) values
 ('j1','junk',10000,'c1',1,'accepted','d1','[]'),
 ('j2','junk',5000,'c1',1,'open',null,'[{"phone":"d1","name":"Drv1","price":5000}]'),
 ('j3','junk',8000,'c2',1,'accepted','d2','[]');
update public.app_settings set value='10' where key='commission_percent';

alter role service_role bypassrls; grant usage on schema public to service_role; grant all on all tables in schema public to service_role;
set role authenticated;
-- ---- customer c1 ----
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select pg_temp.x('c1 cannot insert payment directly', $$insert into public.payments(job_id,customer_phone,provider_phone,amount,payout_amount,psp,created_at) values('j1','c1','d1',1,1,'mock',1)$$, 'fail');
select pg_temp.x('c1 cannot create payment for open job', $$select public.create_payment('j2')$$, 'fail');
select pg_temp.x('c1 cannot create payment for others job', $$select public.create_payment('j3')$$, 'fail');
select pg_temp.x('c1 creates payment j1', $$select public.create_payment('j1')$$, 'ok');
select pg_temp.eq('payment amounts', (select amount||'/'||commission||'/'||payout_amount||'/'||psp||'/'||status from public.payments where job_id='j1'), '10000/1000/9000/mock/pending');
select pg_temp.x('create_payment idempotent', $$select public.create_payment('j1')$$, 'ok');
select pg_temp.eq('still one row', (select count(*)::text from public.payments), '1');
select pg_temp.x('c1 cannot update payment status directly', $$update public.payments set status='held'$$, 'fail');
select pg_temp.x('c1 cannot delete payment', $$delete from public.payments$$, 'fail');
select pg_temp.x('c1 cannot confirm_payment', $$select public.confirm_payment((select id from public.payments limit 1),'x')$$, 'fail');
select pg_temp.x('c1 cannot admin_settle', $$select public.admin_settle_payment((select id from public.payments limit 1),'payout')$$, 'fail');
select pg_temp.x('c1 cannot set payment_released while unfunded', $$update public.jobs set status='done', payment_released=true, completed_at=1 where id='j1'$$, 'fail');
-- c2 cannot mock-pay c1's payment
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
select pg_temp.x('c2 cannot mock_pay c1 payment', $$select public.mock_pay((select id from public.payments limit 1), true)$$, 'fail');
select pg_temp.eq('c2 sees no payments', (select count(*)::text from public.payments), '0');
-- provider d1 before funding
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select pg_temp.eq('d1 sees no pending payment', (select count(*)::text from public.payments), '0');
select pg_temp.x('d1 cannot mark arrived before payment', $$update public.jobs set arrived=true, arrived_at=1 where id='j1'$$, 'fail');
select pg_temp.x('d1 cannot mock_pay', $$select public.mock_pay((select id from public.payments limit 1), true)$$, 'fail');
-- failed attempt then retry
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select pg_temp.x('c1 mock fail', $$select public.mock_pay((select id from public.payments where status='pending' limit 1), false)$$, 'ok');
select pg_temp.eq('status failed', (select status from public.payments limit 1), 'failed');
select pg_temp.x('c1 creates new payment after failure', $$select public.create_payment('j1')$$, 'ok');
select pg_temp.eq('two rows now', (select count(*)::text from public.payments), '2');
select pg_temp.x('c1 mock pay ok', $$select public.mock_pay((select id from public.payments where status='pending' limit 1), true)$$, 'ok');
select pg_temp.eq('status held', (select string_agg(status,',' order by status) from public.payments), 'failed,held');
select pg_temp.x('mock_pay again is no-op', $$select public.mock_pay((select id from public.payments where status='held' limit 1), false)$$, 'ok');
select pg_temp.eq('still held', (select count(*)::text from public.payments where status='held'), '1');
-- provider can now proceed
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select pg_temp.eq('d1 sees held payment', (select string_agg(status,',') from public.payments), 'held');
select pg_temp.x('d1 arrived after funding', $$update public.jobs set arrived=true, arrived_at=1 where id='j1'$$, 'ok');
select pg_temp.x('d1 cannot see c-other payments', $$select 1 from public.payments where job_id='j3'$$, 'zero');
-- customer releases
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select pg_temp.x('c1 releases', $$update public.jobs set status='done', payment_released=true, completed_at=1 where id='j1'$$, 'ok');
select pg_temp.eq('payment released', (select status from public.payments where job_id='j1' and status<>'failed'), 'released');
select pg_temp.x('c1 cannot payout', $$select public.admin_settle_payment((select id from public.payments where status='released'),'payout')$$, 'fail');
-- admin payout
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ad',false);
select pg_temp.eq('admin sees all payments', (select count(*)::text from public.payments), '2');
select pg_temp.x('admin cannot refund released', $$select public.admin_settle_payment((select id from public.payments where status='released'),'refund')$$, 'fail');
select pg_temp.x('admin payout', $$select public.admin_settle_payment((select id from public.payments where status='released'),'payout')$$, 'ok');
select pg_temp.eq('paid_out', (select status from public.payments where job_id='j1' and status<>'failed'), 'paid_out');
-- refund path: j3 funded then admin refunds
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
select pg_temp.x('c2 creates payment j3', $$select public.create_payment('j3')$$, 'ok');
select pg_temp.x('c2 pays j3', $$select public.mock_pay((select id from public.payments where job_id='j3'), true)$$, 'ok');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ad',false);
select pg_temp.x('admin refunds job j3', $$update public.jobs set status='cancelled', payment_released=false, resolution='refunded', resolved_at=1 where id='j3'$$, 'ok');
select pg_temp.eq('refund_due', (select status from public.payments where job_id='j3'), 'refund_due');
select pg_temp.x('admin settles refund', $$select public.admin_settle_payment((select id from public.payments where job_id='j3'),'refund')$$, 'ok');
select pg_temp.eq('refunded', (select status from public.payments where job_id='j3'), 'refunded');
-- anonymous access
reset role; set role anon;
select pg_temp.x('anon cannot read payments', $$select 1 from public.payments$$, 'zero');
select pg_temp.x('anon cannot call create_payment', $$select public.create_payment('j1')$$, 'fail');
select pg_temp.x('anon cannot call settle', $$select public.admin_settle_payment(gen_random_uuid(),'payout')$$, 'fail');
-- service role (webhook path): confirm + idempotence
reset role;
insert into public.jobs(id,service,price,owner_phone,created_at,status,accepted_by_phone,applicants) values ('j4','junk',2000,'c1',1,'accepted','d1','[]');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated; select public.create_payment('j4'); reset role;
set role service_role; select set_config('request.jwt.claim.sub','',false);
select pg_temp.x('service attach_checkout', $$select public.attach_checkout((select id from public.payments where job_id='j4'),'qi-123','https://pay.example/x')$$, 'ok');
select pg_temp.x('service confirm', $$select public.confirm_payment((select id from public.payments where job_id='j4'),'qi-123')$$, 'ok');
select pg_temp.x('service confirm twice (idempotent)', $$select public.confirm_payment((select id from public.payments where job_id='j4'),'qi-123')$$, 'ok');
select pg_temp.eq('j4 held once', (select status||'/'||psp_ref from public.payments where job_id='j4'), 'held/qi-123');
reset role; set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select pg_temp.x('authenticated cannot call confirm_payment', $$select public.confirm_payment((select id from public.payments where job_id='j4'),'x')$$, 'fail');
-- mode off: no payment required
reset role; update public.app_settings set value='off' where key='payments_mode';
insert into public.jobs(id,service,price,owner_phone,created_at,status,accepted_by_phone,applicants) values ('j5','junk',2000,'c1',1,'accepted','d1','[]');
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select pg_temp.x('mode off: provider can arrive without payment', $$update public.jobs set arrived=true, arrived_at=1 where id='j5'$$, 'ok');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select pg_temp.x('mode off: create_payment refused', $$select public.create_payment('j5')$$, 'fail');
-- delete funded job -> refund_due
reset role; update public.app_settings set value='mock' where key='payments_mode';
delete from public.jobs where id='j4';
select pg_temp.eq('deleted funded job -> refund_due', (select status from public.payments where job_id='j4'), 'refund_due');

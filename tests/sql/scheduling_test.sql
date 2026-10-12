-- Test av diz_scheduling.sql (körs efter schemat + diz_scheduling.sql).
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
 ('00000000-0000-0000-0000-0000000000c1','s1@x','{"name":"Cust","phone":"sc1","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000d1','s2@x','{"name":"Drv","phone":"sd1","role":"driver"}');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
select pg_temp.x('customer creates an ASAP request', $$insert into public.jobs(id,service,price,owner_phone,created_at,schedule_type) values('s1','junk',1000,'sc1',1,'asap')$$, 'ok');
select pg_temp.x('customer creates a 3 hour slot request', $$insert into public.jobs(id,service,price,owner_phone,created_at,schedule_type,slot_start,slot_end) values('s2','junk',1000,'sc1',1,'slot',1800000000000,1800000000000+3*3600000)$$, 'ok');
select pg_temp.x('legacy request without schedule still works', $$insert into public.jobs(id,service,price,owner_phone,created_at) values('s3','junk',1000,'sc1',1)$$, 'ok');
select pg_temp.x('slot needs start and end', $$insert into public.jobs(id,service,price,owner_phone,created_at,schedule_type) values('s4','junk',1000,'sc1',1,'slot')$$, 'fail');
select pg_temp.x('end must be after start', $$insert into public.jobs(id,service,price,owner_phone,created_at,schedule_type,slot_start,slot_end) values('s5','junk',1000,'sc1',1,'slot',1800000000000,1800000000000)$$, 'fail');
select pg_temp.x('window must be whole hours', $$insert into public.jobs(id,service,price,owner_phone,created_at,schedule_type,slot_start,slot_end) values('s6','junk',1000,'sc1',1,'slot',1800000000000,1800000000000+90*60000)$$, 'fail');
select pg_temp.x('window at most 12 hours', $$insert into public.jobs(id,service,price,owner_phone,created_at,schedule_type,slot_start,slot_end) values('s7','junk',1000,'sc1',1,'slot',1800000000000,1800000000000+13*3600000)$$, 'fail');
select pg_temp.x('asap must not carry a window', $$insert into public.jobs(id,service,price,owner_phone,created_at,schedule_type,slot_start,slot_end) values('s8','junk',1000,'sc1',1,'asap',1,2)$$, 'fail');
select pg_temp.x('unknown schedule type rejected', $$insert into public.jobs(id,service,price,owner_phone,created_at,schedule_type) values('s9','junk',1000,'sc1',1,'later')$$, 'fail');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
select pg_temp.x('provider proposes another time with the application',
  $$update public.jobs set applicants = '[{"phone":"sd1","name":"Drv","price":900,"appliedAt":5,"proposedStart":1800003600000,"proposedEnd":1800007200000}]'::jsonb where id='s2'$$, 'ok');
select pg_temp.x('provider cannot change the requested time', $$update public.jobs set slot_start = 5, slot_end = 3605000, schedule_type='slot' where id='s2'$$, 'fail');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
select pg_temp.x('customer assigns the provider who proposed', $$update public.jobs set status='accepted', accepted_by_phone='sd1', price=900 where id='s2'$$, 'ok');
select pg_temp.eq('proposal kept on the job', (select applicants->0->>'proposedStart' from public.jobs where id='s2'), '1800003600000');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
insert into public.jobs(id,service,price,owner_phone,created_at,schedule_type) values('s10','junk',1000,'sc1',1,'asap');
set role authenticated;
select pg_temp.x('customer edits an open request into a timed one', $$update public.jobs set schedule_type='slot', slot_start=1800000000000, slot_end=1800003600000 where id='s10'$$, 'ok');
select pg_temp.x('customer cannot edit the time once assigned', $$update public.jobs set slot_start=1800007200000, slot_end=1800010800000 where id='s2'$$, 'fail');

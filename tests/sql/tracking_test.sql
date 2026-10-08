-- Test av positionsdelning (körs efter schemat + diz_payments.sql + diz_tracking.sql; se payments_test.sql för uppställningen).
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
 ('00000000-0000-0000-0000-0000000000e1','tc1@x','{"name":"TCust","phone":"tc1","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000e2','tc2@x','{"name":"TCust2","phone":"tc2","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000f1','td1@x','{"name":"TDrv","phone":"td1","role":"driver"}'),
 ('00000000-0000-0000-0000-0000000000f2','td2@x','{"name":"TDrv2","phone":"td2","role":"driver"}');
update public.app_settings set value='off' where key='payments_mode';
insert into public.jobs(id,service,price,owner_phone,created_at,status,accepted_by_phone,applicants) values
 ('t1','junk',1000,'tc1',1,'accepted','td1','[]'),
 ('t2','junk',1000,'tc1',1,'open',null,'[]');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1',false);
select pg_temp.x('provider shares position', $$select public.share_location('t1', 33.3, 44.4, 12)$$, 'ok');
select pg_temp.eq('row stored', (select lat||','||lng||','||customer_phone from public.provider_locations where job_id='t1'), '33.3,44.4,tc1');
select pg_temp.x('direct insert blocked', $$insert into public.provider_locations(job_id,provider_phone,customer_phone,lat,lng,updated_at) values('t2','td1','tc1',1,1,1)$$, 'fail');
select pg_temp.x('direct update blocked', $$update public.provider_locations set lat=0$$, 'fail');
select pg_temp.x('invalid latitude rejected', $$select public.share_location('t1', 123, 44.4)$$, 'fail');
select pg_temp.x('cannot share on an open job', $$select public.share_location('t2', 33.3, 44.4)$$, 'fail');
-- rate limit: a second update right away is ignored
select pg_temp.x('immediate second update accepted but ignored', $$select public.share_location('t1', 10, 10)$$, 'ok');
select pg_temp.eq('position unchanged by too-fast update', (select lat::text from public.provider_locations where job_id='t1'), '33.3');
-- other provider
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f2',false);
select pg_temp.x('other provider cannot share for this job', $$select public.share_location('t1', 1, 1)$$, 'fail');
select pg_temp.eq('other provider sees nothing', (select count(*)::text from public.provider_locations), '0');
select pg_temp.x('other provider cannot stop it', $$select public.stop_sharing('t1')$$, 'ok');
-- customers
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e2',false);
select pg_temp.eq('other customer sees nothing', (select count(*)::text from public.provider_locations), '0');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
select pg_temp.eq('job customer sees the position', (select count(*)::text from public.provider_locations), '1');
select pg_temp.x('customer cannot write a position', $$select public.share_location('t1', 1, 1)$$, 'fail');
select pg_temp.x('customer cannot delete it', $$delete from public.provider_locations$$, 'fail');
-- arrival clears the position
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1',false);
select pg_temp.x('provider marks arrived', $$update public.jobs set arrived=true, arrived_at=1 where id='t1'$$, 'ok');
select pg_temp.eq('position removed on arrival', (select count(*)::text from public.provider_locations), '0');
select pg_temp.x('cannot share after arrival', $$select public.share_location('t1', 33.3, 44.4)$$, 'fail');
-- stop_sharing and reopen cleanup
reset role;
insert into public.jobs(id,service,price,owner_phone,created_at,status,accepted_by_phone,applicants) values ('t3','junk',1000,'tc1',1,'accepted','td1','[]');
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1',false);
select public.share_location('t3', 33.3, 44.4);
select pg_temp.x('provider stops sharing', $$select public.stop_sharing('t3')$$, 'ok');
select pg_temp.eq('row gone after stop', (select count(*)::text from public.provider_locations), '0');
reset role; update public.app_settings set value='mock' where key='payments_mode';

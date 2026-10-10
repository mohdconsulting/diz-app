-- Test av ignorerade jobb (körs efter schemat + diz_dismissals.sql; se payments_test.sql för uppställningen).
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
 ('00000000-0000-0000-0000-0000000000e1','dc1@x','{"name":"DCust","phone":"dc1","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000f1','dd1@x','{"name":"DDrv","phone":"dd1","role":"driver"}'),
 ('00000000-0000-0000-0000-0000000000f2','dd2@x','{"name":"DDrv2","phone":"dd2","role":"driver"}');
insert into public.jobs(id,service,price,owner_phone,created_at,status,accepted_by_phone,applicants) values
 ('d1','junk',1000,'dc1',1,'open',null,'[]'),
 ('d2','junk',1000,'dc1',1,'open',null,'[{"phone":"dd1","name":"DDrv","price":900}]'),
 ('d3','junk',1000,'dc1',1,'accepted','dd2','[]');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1',false);
select pg_temp.x('provider ignores an open job', $$select public.dismiss_job('d1')$$, 'ok');
select pg_temp.x('ignoring twice is harmless', $$select public.dismiss_job('d1')$$, 'ok');
select pg_temp.eq('one row stored', (select count(*)::text from public.job_dismissals), '1');
select pg_temp.x('cannot ignore a job I applied for', $$select public.dismiss_job('d2')$$, 'fail');
select pg_temp.x('cannot ignore a job that is not open', $$select public.dismiss_job('d3')$$, 'fail');
select pg_temp.x('cannot ignore an unknown job', $$select public.dismiss_job('nope')$$, 'fail');
select pg_temp.x('direct insert blocked', $$insert into public.job_dismissals values('dd1','d2',1)$$, 'fail');
select pg_temp.x('direct delete blocked', $$delete from public.job_dismissals$$, 'fail');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f2',false);
select pg_temp.eq('another provider is unaffected and sees nothing', (select count(*)::text from public.job_dismissals), '0');
select pg_temp.x('another provider cannot restore it for me', $$select public.restore_job('d1')$$, 'ok');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1',false);
select pg_temp.eq('still ignored after that', (select count(*)::text from public.job_dismissals), '1');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
select pg_temp.x('customer cannot ignore own job', $$select public.dismiss_job('d1')$$, 'fail');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1',false);
select pg_temp.x('provider restores', $$select public.restore_job('d1')$$, 'ok');
select pg_temp.eq('row removed', (select count(*)::text from public.job_dismissals), '0');
select public.dismiss_job('d1');
reset role;
delete from public.jobs where id='d1';
select pg_temp.eq('dismissal removed with the job', (select count(*)::text from public.job_dismissals), '0');

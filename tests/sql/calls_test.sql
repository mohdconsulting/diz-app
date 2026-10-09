-- Test av samtalssignalering (körs efter schemat + diz_calls.sql; se payments_test.sql för uppställningen).
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
 ('00000000-0000-0000-0000-0000000000e1','sc1@x','{"name":"SCust","phone":"sc1","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000e2','sc2@x','{"name":"SCust2","phone":"sc2","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000f1','sd1@x','{"name":"SDrv","phone":"sd1","role":"driver"}'),
 ('00000000-0000-0000-0000-0000000000f2','sd2@x','{"name":"SDrv2","phone":"sd2","role":"driver"}');
insert into public.jobs(id,service,price,owner_phone,created_at,status,accepted_by_phone,applicants) values
 ('s1','junk',1000,'sc1',1,'accepted','sd1','[]'),
 ('s2','junk',1000,'sc1',1,'open',null,'[]');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
select pg_temp.x('customer rings the provider', $$select public.send_call_signal('s1','call-0001-aaaa','offer','{"sdp":"x"}')$$, 'ok');
select pg_temp.x('customer sends ice', $$select public.send_call_signal('s1','call-0001-aaaa','ice','{"c":1}')$$, 'ok');
select pg_temp.eq('sender cannot read own signals', (select count(*)::text from public.call_signals), '0');
select pg_temp.x('no call on an open job', $$select public.send_call_signal('s2','call-0002-aaaa','offer','x')$$, 'fail');
select pg_temp.x('invalid kind rejected', $$select public.send_call_signal('s1','call-0003-aaaa','hack','x')$$, 'fail');
select pg_temp.x('short call id rejected', $$select public.send_call_signal('s1','abc','offer','x')$$, 'fail');
select pg_temp.x('direct insert blocked', $$insert into public.call_signals(job_id,from_phone,to_phone,call_id,kind,created_at) values('s1','sc1','sd1','call-0004-aaaa','offer',1)$$, 'fail');
select pg_temp.x('direct delete blocked', $$delete from public.call_signals$$, 'fail');
-- provider
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1',false);
select pg_temp.eq('provider receives both signals', (select count(*)::text from public.call_signals), '2');
select pg_temp.eq('addressed to provider', (select count(*)::text from public.call_signals where to_phone='sd1' and from_phone='sc1'), '2');
select pg_temp.x('provider answers', $$select public.send_call_signal('s1','call-0001-aaaa','answer','{"sdp":"y"}')$$, 'ok');
-- outsiders
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f2',false);
select pg_temp.eq('other provider sees nothing', (select count(*)::text from public.call_signals), '0');
select pg_temp.x('other provider cannot signal', $$select public.send_call_signal('s1','call-0001-aaaa','offer','x')$$, 'fail');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e2',false);
select pg_temp.eq('other customer sees nothing', (select count(*)::text from public.call_signals), '0');
select pg_temp.x('other customer cannot signal', $$select public.send_call_signal('s1','call-0001-aaaa','offer','x')$$, 'fail');
-- customer receives the answer
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
select pg_temp.eq('customer receives the answer', (select count(*)::text from public.call_signals where kind='answer'), '1');
-- ring spam: 1 offer used, 4 more allowed
do $$ begin for i in 1..4 loop perform public.send_call_signal('s1','call-spam'||i||'-aaaa','offer','x'); end loop; end $$;
select pg_temp.x('sixth call attempt in a minute is blocked', $$select public.send_call_signal('s1','call-spam9-aaaa','offer','x')$$, 'fail');
-- signals expire for readers (90 s)
reset role;
update public.call_signals set created_at = created_at - 100000 where kind='answer';
set role authenticated;
select pg_temp.eq('old signal no longer readable', (select count(*)::text from public.call_signals where kind='answer'), '0');
-- hang up still works after the job finished
reset role;
set session_replication_role = replica; update public.jobs set status='done' where id='s1'; set session_replication_role = origin;
set role authenticated;
select pg_temp.x('can still hang up after job ended', $$select public.send_call_signal('s1','call-0001-aaaa','end',null)$$, 'ok');
select pg_temp.x('cannot start a call after job ended', $$select public.send_call_signal('s1','call-0009-aaaa','offer','x')$$, 'fail');
reset role;
delete from public.jobs where id='s1';
select pg_temp.eq('signals removed with the job', (select count(*)::text from public.call_signals), '0');

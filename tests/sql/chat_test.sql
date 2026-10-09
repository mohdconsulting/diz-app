-- Test av chatten (körs efter schemat + diz_chat.sql; se payments_test.sql för uppställningen).
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
 ('00000000-0000-0000-0000-0000000000e1','cc1@x','{"name":"CCust","phone":"cc1","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000e2','cc2@x','{"name":"CCust2","phone":"cc2","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000f1','cd1@x','{"name":"CDrv","phone":"cd1","role":"driver"}'),
 ('00000000-0000-0000-0000-0000000000f2','cd2@x','{"name":"CDrv2","phone":"cd2","role":"driver"}');
insert into public.jobs(id,service,price,owner_phone,created_at,status,accepted_by_phone,applicants) values
 ('c1','junk',1000,'cc1',1,'accepted','cd1','[]'),
 ('c2','junk',1000,'cc1',1,'open',null,'[]');
set role authenticated;
-- customer
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
select pg_temp.x('customer sends', $$select public.send_message('c1','  Hej, porten är öppen  ')$$, 'ok');
select pg_temp.eq('body trimmed, recipient = provider', (select body||'|'||recipient_phone from public.messages where job_id='c1'), 'Hej, porten är öppen|cd1');
select pg_temp.x('empty message rejected', $$select public.send_message('c1','   ')$$, 'fail');
select pg_temp.x('too long rejected', $$select public.send_message('c1', repeat('x',1001))$$, 'fail');
select pg_temp.x('no chat on open job', $$select public.send_message('c2','hej')$$, 'fail');
select pg_temp.x('direct insert blocked', $$insert into public.messages(job_id,sender_phone,recipient_phone,body,created_at) values('c1','cc1','cd1','x',1)$$, 'fail');
select pg_temp.x('direct update blocked', $$update public.messages set body='x'$$, 'fail');
select pg_temp.x('direct delete blocked', $$delete from public.messages$$, 'fail');
select pg_temp.x('customer cannot mark own message read', $$select public.mark_messages_read('c1')$$, 'ok');
select pg_temp.eq('still unread', (select count(*)::text from public.messages where read_at is null), '1');
-- provider
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1',false);
select pg_temp.eq('provider sees it', (select count(*)::text from public.messages), '1');
select pg_temp.x('provider replies', $$select public.send_message('c1','Jag kommer 15.00')$$, 'ok');
select pg_temp.eq('reply goes to customer', (select recipient_phone from public.messages where sender_phone='cd1'), 'cc1');
select public.mark_messages_read('c1');
select pg_temp.eq('provider marked customer message read', (select count(*)::text from public.messages where sender_phone='cc1' and read_at is not null), '1');
select pg_temp.eq('provider reply still unread', (select count(*)::text from public.messages where sender_phone='cd1' and read_at is null), '1');
-- outsiders
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f2',false);
select pg_temp.eq('other provider sees nothing', (select count(*)::text from public.messages), '0');
select pg_temp.x('other provider cannot write', $$select public.send_message('c1','hej')$$, 'fail');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e2',false);
select pg_temp.eq('other customer sees nothing', (select count(*)::text from public.messages), '0');
select pg_temp.x('other customer cannot write', $$select public.send_message('c1','hej')$$, 'fail');
-- rate limit (customer already sent 1; 14 more allowed, 15th more fails)
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
do $$ begin for i in 1..14 loop perform public.send_message('c1','m'||i); end loop; end $$;
select pg_temp.x('rate limit stops the 16th message in a minute', $$select public.send_message('c1','spam')$$, 'fail');
-- admin read
reset role;
set session_replication_role = replica;   -- förbi skydds-triggers i testet
update public.users set role='admin' where phone='cc2';
set session_replication_role = origin;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e2',false);
select pg_temp.eq('admin can read the chat', (select (count(*)>0)::text from public.messages), 'true');
select pg_temp.x('admin cannot write', $$select public.send_message('c1','hej')$$, 'fail');
-- closed after completion
reset role;
set session_replication_role = replica;
update public.jobs set status='done' where id='c1';
set session_replication_role = origin;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1',false);
select pg_temp.x('cannot write after the job is done', $$select public.send_message('c1','tack')$$, 'fail');
select pg_temp.eq('history still readable', (select (count(*)>0)::text from public.messages), 'true');
-- deleting the job deletes messages
reset role;
delete from public.jobs where id='c1';
select pg_temp.eq('messages removed with the job', (select count(*)::text from public.messages), '0');

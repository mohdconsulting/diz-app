-- Test av delete_my_account (körs efter schemat + diz_payments/chat/dismissals/reviews + diz_account_delete.sql).
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
 ('00000000-0000-0000-0000-0000000000a1','a1@x','{"name":"Cust","phone":"c1","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000a2','a2@x','{"name":"Cust2","phone":"c2","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000b1','b1@x','{"name":"Drv","phone":"d1","role":"driver"}');
insert into public.jobs(id,service,price,owner_phone,created_at,status,accepted_by_phone,applicants) values
 ('o1','junk',1000,'c1',1,'open',null,'[{"phone":"d1","name":"Drv","price":900}]'),
 ('o2','junk',1000,'c2',1,'open',null,'[{"phone":"d1","name":"Drv","price":900}]'),
 ('dn','junk',1000,'c1',1,'done','d1','[{"phone":"d1","name":"Drv","price":900}]'),
 ('ac','junk',1000,'c2',1,'accepted','d1','[]');
insert into public.messages(job_id,sender_phone,recipient_phone,body,created_at) values ('dn','c1','d1','hej',1);
insert into public.job_dismissals values ('d1','o1',1);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select pg_temp.x('provider with an active job cannot delete', $$select public.delete_my_account()$$, 'fail');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select pg_temp.x('customer without active jobs can delete', $$select public.delete_my_account()$$, 'ok');
reset role;
select pg_temp.eq('auth user removed', (select count(*)::text from auth.users where id='00000000-0000-0000-0000-0000000000a1'), '0');
select pg_temp.eq('profile removed', (select count(*)::text from public.users where phone='c1'), '0');
select pg_temp.eq('open request deleted', (select count(*)::text from public.jobs where id='o1'), '0');
select pg_temp.eq('done job kept but anonymised', (select owner_phone from public.jobs where id='dn'), 'deleted');
select pg_temp.eq('messages removed', (select count(*)::text from public.messages), '0');
select pg_temp.eq('other customers job untouched', (select owner_phone from public.jobs where id='o2'), 'c2');
select pg_temp.eq('other user still there', (select count(*)::text from public.users), '2');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
select pg_temp.x('customer with an accepted job cannot delete', $$select public.delete_my_account()$$, 'fail');
reset role;
select set_config('request.jwt.claim.sub','',false);
update public.jobs set status='done' where id='ac';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
select pg_temp.x('after the job is done the account can be deleted', $$select public.delete_my_account()$$, 'ok');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select pg_temp.x('provider can delete once nothing is active', $$select public.delete_my_account()$$, 'ok');
reset role;
select pg_temp.eq('provider anonymised on done job', (select accepted_by_phone from public.jobs where id='dn'), 'deleted');
select pg_temp.eq('provider applicant entry anonymised', (select applicants->0->>'phone' from public.jobs where id='dn'), 'deleted');
select pg_temp.eq('dismissals removed', (select count(*)::text from public.job_dismissals), '0');
select pg_temp.eq('no users left', (select count(*)::text from public.users), '0');
set role anon;
select pg_temp.x('anonymous cannot call it', $$select public.delete_my_account()$$, 'fail');

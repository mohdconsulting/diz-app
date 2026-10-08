-- Test av GPS-kolumnerna på uppdrag (körs efter schemat; se payments_test.sql för uppställningen).
\set ON_ERROR_STOP 0
create or replace function pg_temp.x(label text, q text, expect text) returns void language plpgsql as $$
declare n int; res text;
begin
  begin execute q; get diagnostics n = row_count; res := case when n = 0 then 'zero' else 'ok' end;
  exception when others then res := 'fail'; end;
  raise notice '% % (got %, wanted %)', case when res=expect then 'PASS' else '*** FAIL' end, label, res, expect;
end $$;
grant execute on function pg_temp.x(text,text,text) to public;
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000c1','lc1@x','{"name":"LCust","phone":"lc1","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000d1','ld1@x','{"name":"LDrv","phone":"ld1","role":"driver"}');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
select pg_temp.x('customer creates job with pin', $$insert into public.jobs(id,service,price,owner_phone,created_at,addr,addr_lat,addr_lng) values('l1','junk',1000,'lc1',1,'Baghdad',33.3152,44.3661)$$, 'ok');
select pg_temp.x('customer edits pin on open job', $$update public.jobs set addr_lat=33.4, addr_lng=44.4, to_lat=33.5, to_lng=44.5 where id='l1'$$, 'ok');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
select pg_temp.x('driver cannot move the pin', $$update public.jobs set addr_lat=0, addr_lng=0 where id='l1'$$, 'fail');

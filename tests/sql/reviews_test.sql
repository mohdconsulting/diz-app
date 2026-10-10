-- Test av kundrecensioner (körs efter schemat + diz_reviews.sql; se payments_test.sql för uppställningen).
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
 ('00000000-0000-0000-0000-0000000000a1','rc1@x','{"name":"RCust","phone":"rc1","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000a2','rc2@x','{"name":"RCust2","phone":"rc2","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000b1','rd1@x','{"name":"RDrv","phone":"rd1","role":"driver"}'),
 ('00000000-0000-0000-0000-0000000000c1','radm@x','{"name":"RAdm","phone":"radm","role":"admin"}'),
 ('00000000-0000-0000-0000-0000000000b2','rd2@x','{"name":"RDrv2","phone":"rd2","role":"driver"}');
set session_replication_role = replica;
insert into public.jobs(id,service,price,owner_phone,created_at,status,accepted_by_phone,applicants) values
 ('r1','junk',1000,'rc1',1,'done','rd1','[]'),
 ('r2','junk',1000,'rc1',1,'done','rd1','[]'),
 ('r3','junk',1000,'rc1',1,'accepted','rd1','[]'),
 ('r4','junk',1000,'rc2',1,'done','rd1','[]'),
 ('r5','junk',1000,'rc1',1,'open',null,'[]');
set session_replication_role = origin;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select pg_temp.x('customer reviews a completed job', $$select public.submit_review('r1', 5, 'Snabb och trevlig')$$, 'ok');
select pg_temp.x('cannot review the same job twice', $$select public.submit_review('r1', 1, 'ångrar mig')$$, 'fail');
select pg_temp.x('cannot review an unfinished job', $$select public.submit_review('r3', 4, null)$$, 'fail');
select pg_temp.x('cannot review an open job', $$select public.submit_review('r5', 4, null)$$, 'fail');
select pg_temp.x('cannot review someone elses job', $$select public.submit_review('r4', 5, null)$$, 'fail');
select pg_temp.x('rating 0 rejected', $$select public.submit_review('r2', 0, null)$$, 'fail');
select pg_temp.x('rating 6 rejected', $$select public.submit_review('r2', 6, null)$$, 'fail');
select pg_temp.x('too long comment rejected', $$select public.submit_review('r2', 4, repeat('x', 501))$$, 'fail');
select pg_temp.x('unknown job rejected', $$select public.submit_review('nope', 4, null)$$, 'fail');
select pg_temp.x('review without comment, blank comment stored as null', $$select public.submit_review('r2', 3, '   ')$$, 'ok');
select pg_temp.eq('blank comment is null', (select (comment is null)::text from public.reviews where job_id='r2'), 'true');
select pg_temp.x('direct insert blocked', $$insert into public.reviews values('r4','rd1','rc1',5,null,1)$$, 'fail');
select pg_temp.x('direct update blocked', $$update public.reviews set rating = 1$$, 'fail');
select pg_temp.x('direct delete blocked', $$delete from public.reviews$$, 'fail');
select pg_temp.eq('customer sees own two reviews', (select count(*)::text from public.reviews), '2');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select pg_temp.x('provider cannot review', $$select public.submit_review('r4', 5, null)$$, 'fail');
select pg_temp.eq('provider sees reviews about them', (select count(*)::text from public.reviews), '2');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
select pg_temp.eq('another customer cannot read the rows', (select count(*)::text from public.reviews), '0');
select pg_temp.eq('another customer sees the aggregate', (select avg_rating::text || '/' || review_count from public.provider_ratings(array['rd1'])), '4.0/2');
select pg_temp.eq('comments are visible without identity', (select count(*)::text from public.provider_reviews('rd1', 10)), '2');
select pg_temp.eq('aggregate view exposes no customer column', (select count(*)::text from information_schema.columns where table_name='provider_reviews' and column_name like '%customer%'), '0');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',false);
select pg_temp.eq('provider without reviews has no rating', (select count(*)::text from public.provider_ratings(array['rd2'])), '0');
reset role;
select pg_temp.x('anon cannot call the aggregate', $$set role anon; select * from public.provider_ratings(array['rd1'])$$, 'fail');

-- moderering
reset role;
set session_replication_role = replica;
update public.users set role='admin' where phone='radm';
set session_replication_role = origin;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select pg_temp.x('customer cannot moderate', $$select public.moderate_review('r1','hide')$$, 'fail');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select pg_temp.x('provider cannot moderate', $$select public.moderate_review('r1','hide')$$, 'fail');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
select pg_temp.eq('admin reads all reviews', (select count(*)::text from public.reviews), '2');
select pg_temp.x('admin hides a review', $$select public.moderate_review('r1','hide')$$, 'ok');
select pg_temp.x('unknown action rejected', $$select public.moderate_review('r1','explode')$$, 'fail');
select pg_temp.x('unknown review rejected', $$select public.moderate_review('nope','hide')$$, 'fail');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
select pg_temp.eq('hidden review is out of the average', (select avg_rating::text || '/' || review_count from public.provider_ratings(array['rd1'])), '3.0/1');
select pg_temp.eq('hidden review is out of the comments', (select count(*)::text from public.provider_reviews('rd1', 10)), '1');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select pg_temp.eq('provider no longer sees the hidden row', (select count(*)::text from public.reviews), '1');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select pg_temp.eq('customer still sees own hidden review', (select count(*)::text from public.reviews where hidden), '1');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
select pg_temp.x('admin shows it again', $$select public.moderate_review('r1','show')$$, 'ok');
select pg_temp.x('admin clears a comment', $$select public.moderate_review('r1','clear_comment')$$, 'ok');
select pg_temp.eq('comment gone, rating kept', (select coalesce(comment,'NULL') || '/' || rating from public.reviews where job_id='r1'), 'NULL/5');
select pg_temp.x('admin cannot edit the rating directly', $$update public.reviews set rating = 1$$, 'fail');

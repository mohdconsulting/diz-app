-- Test av profilbild för leverantörer (körs efter schemat, diz_provider_approval.sql och diz_provider_avatar.sql).
-- Storage mockas med en minimal storage-schema (se början av filen) om den inte finns.
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
 ('00000000-0000-0000-0000-0000000000a1','ac1@x','{"name":"ACust","phone":"ac1","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000b1','ad1@x','{"name":"ADrv","phone":"ad1","role":"driver","profiles":["driver"]}'),
 ('00000000-0000-0000-0000-0000000000b2','ad2@x','{"name":"ADrv2","phone":"ad2","role":"driver","profiles":["driver"]}');
update public.users set approved = true where role = 'driver';
set session_replication_role = replica;
insert into public.jobs(id,service,price,owner_phone,created_at,status,applicants) values ('v1','junk',1000,'ac1',1,'open','[]');
set session_replication_role = origin;
set role authenticated;

-- leverantör utan bild
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
select pg_temp.x('offer without photo blocked', $$update public.jobs set applicants = '[{"phone":"ad1","name":"ADrv","price":900}]' where id='v1'$$, 'fail');
select pg_temp.x('avatar url to other folder rejected', $$update public.users set avatar_url = 'https://x.supabase.co/storage/v1/object/public/avatars/00000000-0000-0000-0000-0000000000b2/a.jpg' where id = auth.uid()$$, 'fail');
select pg_temp.x('external avatar url rejected', $$update public.users set avatar_url = 'https://evil.example/a.jpg' where id = auth.uid()$$, 'fail');
select pg_temp.x('own avatar url ok', $$update public.users set avatar_url = 'https://x.supabase.co/storage/v1/object/public/avatars/00000000-0000-0000-0000-0000000000b1/a.jpg?v=1' where id = auth.uid()$$, 'ok');
select pg_temp.x('offer with photo ok', $$update public.jobs set applicants = '[{"phone":"ad1","name":"ADrv","price":900}]' where id='v1'$$, 'ok');
select pg_temp.x('avatar can be removed', $$update public.users set avatar_url = null where id = auth.uid()$$, 'ok');
select pg_temp.x('withdraw without photo still allowed', $$update public.jobs set applicants = '[]' where id='v1'$$, 'ok');
update public.users set avatar_url = 'https://x.supabase.co/storage/v1/object/public/avatars/00000000-0000-0000-0000-0000000000b1/b.jpg' where id = auth.uid();

-- kunden ser bilden
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select pg_temp.eq('customer sees provider avatar', (select string_agg(phone || '=' || right(avatar_url, 5), ',') from public.provider_avatars(array['ad1','ad2','ac1'])), 'ad1=b.jpg');
select pg_temp.x('customer cannot set avatar of provider', $$update public.users set avatar_url = null where phone = 'ad1'$$, 'zero');

-- utloggad ser inget
select set_config('request.jwt.claim.sub','',false);
select pg_temp.eq('anonymous sees nothing', (select count(*)::text from public.provider_avatars(array['ad1'])), '0');
reset role;

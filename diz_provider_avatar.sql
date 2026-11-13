-- ============================================================================
-- Diz – profilbild för tjänsteleverantörer
-- Kör i Supabase SQL Editor EFTER diz_supabase_schema.sql och diz_provider_approval.sql. Idempotent.
--
--   * public.users.avatar_url     publik adress till bilden i Storage-bucketen "avatars".
--   * Bucket "avatars" (publik läsning, max 5 MB, jpeg/png/webp). Var och en skriver bara i sin egen mapp <user-id>/.
--   * provider_avatars(telefonnummer[])  bilder för leverantörer – för kundens lista över anbud och tilldelad leverantör.
--   * En leverantör utan profilbild kan inte lämna eller ändra anbud (felkod provider_no_photo).
--     Gäller även leverantörer som redan finns – de får lägga till en bild i profilen.
-- ============================================================================

alter table public.users add column if not exists avatar_url text;

-- Bucket (publik: bilden ska visas för kunder utan signerade länkar).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))
  with check (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- avatar_url får bara peka på den egna mappen i bucketen "avatars" (eller vara tom).
create or replace function public.users_avatar_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.avatar_url is not null and new.avatar_url is distinct from old.avatar_url
     and auth.uid() is not null and not public.is_admin()
     and position('/storage/v1/object/public/avatars/' || new.id::text || '/' in new.avatar_url) = 0 then
    raise exception 'invalid avatar_url' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists users_avatar_guard on public.users;
create trigger users_avatar_guard before update of avatar_url on public.users
  for each row execute function public.users_avatar_guard();

-- Har leverantören med detta nummer en profilbild?
create or replace function public.provider_has_photo(p_phone text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select u.avatar_url is not null and u.avatar_url <> '' from public.users u
                    where u.phone = p_phone and u.role = 'driver' limit 1), false)
$$;

-- Profilbilder för givna leverantörer (telefonnummer) – synliga för alla inloggade, precis som betygen.
create or replace function public.provider_avatars(p_phones text[])
returns table(phone text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select u.phone, u.avatar_url from public.users u
   where auth.uid() is not null and u.role = 'driver' and u.avatar_url is not null
     and u.phone = any(p_phones)
$$;
revoke all on function public.provider_avatars(text[]) from public, anon, authenticated;
grant execute on function public.provider_avatars(text[]) to authenticated;
revoke all on function public.provider_has_photo(text) from public, anon, authenticated;

-- Anbud kräver profilbild (att dra tillbaka ett anbud är alltid tillåtet).
create or replace function public.jobs_avatar_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me text; mine_old jsonb; mine_new jsonb;
begin
  if auth.uid() is null or public.is_admin() or public.my_role() <> 'driver' then return new; end if;
  me := public.my_phone();
  select v into mine_old from jsonb_array_elements(coalesce(old.applicants, '[]'::jsonb)) as e(v) where v->>'phone' = me limit 1;
  select v into mine_new from jsonb_array_elements(coalesce(new.applicants, '[]'::jsonb)) as e(v) where v->>'phone' = me limit 1;
  if mine_new is not null and mine_new is distinct from mine_old and not public.provider_has_photo(me) then
    raise exception 'provider_no_photo' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists jobs_avatar_guard on public.jobs;
create trigger jobs_avatar_guard before update on public.jobs
  for each row execute function public.jobs_avatar_guard();

-- ============================================================================
-- Diz – tjänsteleverantörens dokument för verifiering
-- Kör i Supabase SQL Editor EFTER diz_supabase_schema.sql och diz_provider_approval.sql. Idempotent.
--
--   * Storage-bucket "provider-docs": PRIVAT, max 10 MB, bara bilder och PDF.
--     Filer ligger i mappen <användarens id>/… och bara ägaren och admin kan läsa dem.
--   * public.provider_documents: vilka dokument som laddats upp (typ, filnamn, tid). Max 20 per leverantör.
-- Admin öppnar dokumenten via tidsbegränsade länkar (signed URL) i webbens admin-vy.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('provider-docs', 'provider-docs', false, 10485760,
        array['image/jpeg','image/png','image/heic','image/heif','image/webp','application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Filerna i bucketen
drop policy if exists provider_docs_insert on storage.objects;
create policy provider_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'provider-docs'
              and (storage.foldername(name))[1] = auth.uid()::text
              and public.my_role() = 'driver');
drop policy if exists provider_docs_select on storage.objects;
create policy provider_docs_select on storage.objects for select to authenticated
  using (bucket_id = 'provider-docs'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists provider_docs_delete on storage.objects;
create policy provider_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'provider-docs'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- Förteckning över dokumenten
create table if not exists public.provider_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('id', 'license', 'certificate', 'other')),
  file_path text not null unique,
  file_name text not null,
  mime text,
  size_bytes integer,
  created_at timestamptz not null default now()
);
create index if not exists provider_documents_user_idx on public.provider_documents (user_id, created_at);
alter table public.provider_documents enable row level security;
grant select, insert, delete on public.provider_documents to authenticated;

drop policy if exists provider_documents_select on public.provider_documents;
create policy provider_documents_select on public.provider_documents for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists provider_documents_insert on public.provider_documents;
create policy provider_documents_insert on public.provider_documents for insert to authenticated
  with check (user_id = auth.uid()
              and public.my_role() = 'driver'
              and split_part(file_path, '/', 1) = auth.uid()::text
              and (select count(*) from public.provider_documents d where d.user_id = auth.uid()) < 20);
drop policy if exists provider_documents_delete on public.provider_documents;
create policy provider_documents_delete on public.provider_documents for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

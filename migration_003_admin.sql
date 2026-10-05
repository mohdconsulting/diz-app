-- Migration 003: adminpanel (superuser)
-- 1) Nya kolumner på jobs
alter table public.jobs add column if not exists admin_note text;
alter table public.jobs add column if not exists resolution text;     -- 'released' | 'refunded' | 'cancelled' | 'reopened'
alter table public.jobs add column if not exists resolved_at bigint;
-- (status får nu även värdet 'cancelled' — kolumnen är vanlig text, ingen constraint att ändra)

-- 2) Skapa/uppdatera admin-kontot.
--    ÄNDRA de tre värdena nedan innan du kör! Skriptet stoppar om du lämnar standardvärdena.
do $$
declare
  admin_phone text := 'BYT-MIG-TELEFON';
  admin_name  text := 'Admin';
  admin_pass  text := 'BYT-MIG-LOSENORD';
  admin_id    text;
begin
  if admin_phone = 'BYT-MIG-TELEFON' or admin_pass = 'BYT-MIG-LOSENORD' then
    raise exception 'Ändra admin_phone och admin_pass i skriptet först.';
  end if;
  -- samma sanering som appen gör av telefonnumret
  admin_id := regexp_replace(admin_phone, '[^a-zA-Z0-9_.~:@+-]', '', 'g');
  insert into public.users (id, phone, name, password, role, profiles, created_at)
  values (admin_id, admin_phone, admin_name, admin_pass, 'admin', '[]'::jsonb, (extract(epoch from now()) * 1000)::bigint)
  on conflict (id) do update
    set role = 'admin', name = excluded.name, password = excluded.password;
end $$;

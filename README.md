# Diz (دز)

Prototyp för en tjänstemarknadsplats i Irak: kunder lägger upp uppdrag (flytt, leverans, bärgning, hemtjänster m.m.), leverantörer ansöker och kunden väljer vem som tilldelas. Admin kan se och hantera alla uppdrag.

- `index.html` – hela appen (fristående, sv/en/ar)
- `diz_supabase_schema.sql` – databasschema med Supabase Auth, RLS och vakt-triggers

## Kom igång
1. Skapa ett Supabase-projekt.
2. Authentication → Providers → Email: stäng av **Confirm email** (appen loggar in med telefon + lösenord, internt omvandlat till en e-postadress).
3. Kör `diz_supabase_schema.sql` i SQL Editor (OBS: återskapar tabellerna).
4. Sätt `SUPABASE_URL` och `SUPABASE_ANON_KEY` i `index.html`. (Anon/publishable-nyckeln är avsedd att vara publik – skyddet ligger i RLS.)
5. Hosta `index.html` (GitHub Pages, Netlify m.fl.).
6. Registrera ett konto i appen och gör det till admin: `update public.users set role = 'admin' where phone = '…';`

## Säkerhetsmodell
- Lösenord hanteras av Supabase Auth (inget lösenord i egna tabeller).
- RLS: kunder ser sina uppdrag, utförare ser öppna uppdrag + sina egna, admin ser allt, utloggade ser inget.
- Triggern `jobs_guard` avgör vilka fält/övergångar respektive roll får ändra (t.ex. bara kunden släpper betalning, bara utföraren markerar "anlänt/klart").
- Roll kan inte ändras av användaren själv; admin skapas bara via SQL.

# Diz (دز)

Prototyp för en tjänstemarknadsplats i Irak: kunder lägger upp uppdrag (flytt, leverans, bärgning, hemtjänster m.m.), leverantörer ansöker och kunden väljer vem som tilldelas.

- `index.html` – hela appen (fristående, sv/en/ar)
- `diz_supabase_schema.sql` – databasschema, kör i Supabase SQL Editor

## Kom igång
1. Skapa ett Supabase-projekt och kör `diz_supabase_schema.sql`.
2. Sätt `SUPABASE_URL` och `SUPABASE_ANON_KEY` i `index.html`.
3. Hosta `index.html` (GitHub Pages, Netlify m.fl.).

Obs: RLS-policyerna är öppna och lösenord lagras i klartext. Byt till Supabase Auth och riktiga policyer innan riktig användning.

# Diz (دز)

Prototyp för en tjänstemarknadsplats i Irak: kunder lägger upp uppdrag (flytt, leverans, bärgning, hemtjänster m.m.), leverantörer ansöker och kunden väljer vem som tilldelas. Admin kan se och hantera alla uppdrag.

## Struktur (TypeScript)
```
src/
  main.ts        startpunkt (kopplar inline-handlers till window och startar appen)
  app.ts         UI, state, auth, jobb-flöden, notiser, adminpanel
  db.ts          Firestore-liknande lager ovanpå Supabase (snake_case <-> camelCase)
  i18n.ts        sv/en/ar – en/ar måste ha exakt samma nycklar som sv (kompileringsfel annars)
  types.ts       Job, AppUser, Role m.m.   supabase.ts  minimala typer för supabase-js (CDN)
  pricing.ts     prisberäkning            styles.css    all CSS      template.html  HTML-skal
scripts/build.mjs   bundlar allt till EN fristående index.html (esbuild)
index.html          GENERERAD fil – redigera inte, kör `npm run build`
diz_supabase_schema.sql   databasschema med Supabase Auth, RLS och vakt-triggers
tests/e2e/          röktest (Playwright + fejkad supabase-js)
```

## Utveckla
```
npm install
npm run typecheck     # tsc --strict
npm run build         # typecheck + skriver index.html
npm run watch         # bygger om index.html när src/ ändras
```
Den byggda `index.html` är fristående: dra in den på Netlify, servera via GitHub Pages eller öppna från disk. Committa den uppdaterade `index.html` tillsammans med ändringar i `src/`.

Röktest: `npm run build && python3 tests/e2e/smoke.py` (kräver `pip install playwright && playwright install chromium`).

## Kom igång (backend)
1. Skapa ett Supabase-projekt.
2. Authentication → Providers → Email: aktivera Email-leverantören och stäng av **Confirm email** (appen loggar in med telefon + lösenord, internt omvandlat till `diz.<siffror>@gmail.com`; inget mejl skickas).
3. Kör `diz_supabase_schema.sql` i SQL Editor (OBS: återskapar tabellerna).
4. Sätt `SUPABASE_URL` och `SUPABASE_ANON_KEY` i `src/db.ts`. (Anon/publishable-nyckeln är avsedd att vara publik – skyddet ligger i RLS.)
5. Registrera ett konto i appen och gör det till admin: `update public.users set role = 'admin' where phone = '…';`

## Säkerhetsmodell
- Lösenord hanteras av Supabase Auth (inget lösenord i egna tabeller).
- RLS: kunder ser sina uppdrag, utförare ser öppna uppdrag + sina egna, admin ser allt, utloggade ser inget.
- Triggern `jobs_guard` avgör vilka fält/övergångar respektive roll får ändra (t.ex. bara kunden släpper betalning, bara utföraren markerar "anlänt/klart").
- Roll kan inte ändras av användaren själv; admin skapas bara via SQL.

## Arbetsflöde
Utveckling sker på `develop`; ändringar släpps till `main` när ägaren bestämmer det.

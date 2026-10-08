# Diz (دز)

Prototyp för en tjänstemarknadsplats i Irak: kunder lägger upp uppdrag (flytt, leverans, bärgning, hemtjänster m.m.), leverantörer ansöker och kunden väljer vem som tilldelas. Admin kan se och hantera alla uppdrag.

## Struktur (TypeScript)
```
src/
  main.ts        startpunkt (kopplar inline-handlers till window och startar appen)
  handlers.ts    funktioner som inline onclick/oninput i markup anropar (exponeras på window)
  state.ts       delat tillstånd (lang, role, jobs, currentUser …) + setters, t()/me()/db()/sb()
  util.ts        $, esc, toast, sanitizePhone, localStorage-hjälpare
  notifications.ts  röda flaggor/badges/toasts (jobEvent, seenSet)
  auth.ts        inloggning, registrering, konto/profil, boot och sessionsåterställning
  jobs.ts        uppdragsflöden: formulär, kort, ansökan, tilldelning, rapportering, listor
  payments.ts    betalningar: provider-gränssnitt (mock/live), Betala-knapp, statusrader
  admin.ts       adminpanelen (uppdrag, anteckningar, användare)
  shell.ts       navigation, språk, statiska texter, realtidsprenumeration, start()
  db.ts          Firestore-liknande lager ovanpå Supabase (snake_case <-> camelCase)
  i18n.ts        sv/en/ar – en/ar måste ha exakt samma nycklar som sv (kompileringsfel annars)
  types.ts       Job, AppUser, Role m.m.   supabase.ts  minimala typer för supabase-js (CDN)
  pricing.ts     prisberäkning            styles.css    all CSS      template.html  HTML-skal
scripts/build.mjs   bundlar allt till EN fristående index.html (esbuild)
index.html          GENERERAD fil – redigera inte, kör `npm run build`
diz_supabase_schema.sql   databasschema med Supabase Auth, RLS och vakt-triggers
diz_location.sql          valfri GPS-position på adresser (bara för befintlig databas; nya installationer får den via schemat)
diz_tracking.sql          följ utförarens position på karta (kör efter schemat; idempotent)
diz_payments.sql          betalningar/deposition (kör efter schemat; idempotent)
supabase/functions/       Edge Function-skelett för riktig betalleverantör (Qi) – ej driftsatta
tests/sql/                SQL-test för betalningslogiken (lokal Postgres)
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
5. Kör `diz_payments.sql` (betalningar, se nedan). Standardläget är `mock`; vill du inte ha betalning ännu: `update public.app_settings set value = 'off' where key = 'payments_mode';`
   Vill du ha positionsdelning/livekarta: kör även `diz_tracking.sql`.
   Har du en databas från före GPS-positionerna: kör även `diz_location.sql` (idempotent).
6. Registrera ett konto i appen och gör det till admin: `update public.users set role = 'admin' where phone = '…';`

## Säkerhetsmodell
- Lösenord hanteras av Supabase Auth (inget lösenord i egna tabeller).
- RLS: kunder ser sina uppdrag, utförare ser öppna uppdrag + sina egna, admin ser allt, utloggade ser inget.
- Triggern `jobs_guard` avgör vilka fält/övergångar respektive roll får ändra (t.ex. bara kunden släpper betalning, bara utföraren markerar "anlänt/klart").
- Roll kan inte ändras av användaren själv; admin skapas bara via SQL.

## Arbetsflöde
Utveckling sker på `develop`; ändringar släpps till `main` när ägaren bestämmer det.

## Betalningar (deposition)
Flöde: kunden trycker **Tilldela & betala** på en sökande (ett enda steg) → pengarna ligger i deposition (`held`) och **då** tilldelas uppdraget av databasen → utföraren kan markera ankomst/klart → kunden godkänner (eller 5 dagar går) → `released` → utbetalning till utföraren (`paid_out`). Avbryts/återbetalas uppdraget blir betalningen `refund_due` → `refunded`.

- **Läge** styrs av `app_settings.payments_mode`: `off` (ingen betalning), `mock` (testkassa i appen, inga riktiga pengar) eller `live` (riktig leverantör).
- **Klienten kan aldrig skriva i `payments`.** Allt går via funktioner: `create_payment` (kund), `mock_pay` (bara mock), `confirm_payment`/`fail_payment`/`attach_checkout` (bara service_role, från webhook/Edge Function) och `admin_settle_payment` (admin bokför utbetalning/återbetalning).
- Går betalningen inte igenom förblir uppdraget öppet. Hinner uppdraget ändras under tiden (annan utförare vald, budet ändrat) markeras betalningen `refund_due` i stället för att tilldela fel. Direkt tilldelning utan betalning blockeras av databasen när läget inte är `off`.
- Triggern `jobs_payment_guard` hindrar utföraren från att starta, och kunden från att släppa betalning, innan uppdraget är finansierat.
- **Byta till Qi Card:** gör `supabase/functions/start-checkout` och `qi-webhook` riktiga (markerade `TODO(Qi)`: skapa betalning, verifiera webhook-signatur, kontrollera status), driftsätt dem, lägg hemligheterna med `supabase secrets set`, och sätt `payments_mode` till `live`. Appens kod (`src/payments.ts`) och databasen behöver inte ändras.
- Utbetalning till utförare och återbetalning är idag **manuella** (admin trycker "Markera utbetald/återbetald" efter att ha flyttat pengarna). Automatisk utbetalning kräver att leverantören erbjuder det.
- SQL-test: `tests/sql/` (kräver en lokal Postgres; se kommentarerna i filerna).

## Adresser och Google Maps
Adresserna på korten är länkar till Google Maps (ingen API-nyckel behövs). Kunden kan i formuläret trycka **Använd min position** för att spara en GPS-pin (webbläsaren frågar om platsåtkomst); då öppnar länken exakt koordinat i stället för att söka på texten. Pinnen är valfri och sparas i `addr_lat/addr_lng/to_lat/to_lng`.

### Adressförslag medan man skriver
Adressfälten föreslår platser efter tre tecken (`src/place-search.ts`, `src/geocode.ts`). Tjänsten är Photon (OpenStreetMap, https://photon.komoot.io): gratis och utan API-nyckel, men **det kunden skriver skickas dit** och den har ingen servicegaranti. Väljer kunden ett förslag sparas även koordinaten som pin, så Maps-länken blir exakt; ändrar kunden texten efteråt släpps pinnen. Fungerar inte tjänsten kan man fortfarande skriva fritt. Vill du byta till Google Places eller en egen tjänst byter du bara ut `searchPlaces()` i `geocode.ts`.

## Följ utföraren på kartan
Utföraren trycker **Dela min position med kunden** på ett betalt uppdrag (webbläsaren frågar om platsåtkomst). Positionen skickas var 5:e sekund (`share_location`) och kunden ser den på en karta (Leaflet + OpenStreetMap, laddas först när kartan öppnas) tillsammans med sin egen adress om den har en pin.

- **Integritet:** delningen startas av utföraren själv, per uppdrag. Bara den senaste positionen sparas (ingen historik) och bara kunden för uppdraget, utföraren och admin kan läsa den. Den raderas automatiskt när utföraren markerar ankomst, uppdraget avslutas/avbryts/återöppnas eller utföraren loggar ut.
- **Begränsning:** en webbapp kan bara läsa position medan sidan är öppen. Släcks skärmen eller byter utföraren app stannar uppdateringarna (appen ber om att få hålla skärmen tänd, vilket stöds av de flesta moderna mobiler men inte alla). Kunden ser då "uppdaterad för X min sedan" och en varning när positionen är äldre än 3 minuter. Bakgrundsspårning kräver en riktig mobilapp.
- **Kartplattor:** OpenStreetMaps publika kartserver är avsedd för måttlig användning; vid många användare bör ni byta till en betaltjänst eller egen tile-server (`TILE_URL` i `src/leaflet.ts`).

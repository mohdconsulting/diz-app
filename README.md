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
diz_chat.sql              chatt mellan kund och utförare (kör efter schemat; idempotent)
diz_calls.sql             ljudsamtal (signalering för WebRTC; kör efter schemat; idempotent)
diz_dismissals.sql        leverantören kan ignorera jobb (kör efter schemat; idempotent)
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
   Vill du ha positionsdelning/livekarta: kör även `diz_tracking.sql`. Vill du ha chatt: kör även `diz_chat.sql`. Vill du ha ljudsamtal: kör även `diz_calls.sql`. Vill du att leverantörer kan ignorera jobb: kör även `diz_dismissals.sql`.
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
Så fort utföraren tilldelats ett uppdrag (betalningen är genomförd) börjar positionen delas **automatiskt**, utan separat godkännande per uppdrag. Utföraren informeras om detta vid registrering, på uppdragskortet och med en notis. Webbläsarens egen platsfråga kan inte kringgås och visas första gången. Positionen skickas var 5:e sekund (`share_location`) och kunden ser den på en karta (Leaflet + OpenStreetMap, laddas först när kartan öppnas) tillsammans med sin egen adress om den har en pin.

- **Integritet:** delningen startar automatiskt vid tilldelning och har ingen av/på-knapp (kan läggas till). Bara den senaste positionen sparas (ingen historik) och bara kunden för uppdraget, utföraren och admin kan läsa den. Den raderas automatiskt när utföraren markerar ankomst, uppdraget avslutas/avbryts/återöppnas eller utföraren loggar ut.
- **Begränsning:** en webbapp kan bara läsa position medan sidan är öppen. Släcks skärmen eller byter utföraren app stannar uppdateringarna (appen ber om att få hålla skärmen tänd, vilket stöds av de flesta moderna mobiler men inte alla). Kunden ser då "uppdaterad för X min sedan" och en varning när positionen är äldre än 3 minuter. Bakgrundsspårning kräver en riktig mobilapp.
- **Kartplattor:** OpenStreetMaps publika kartserver är avsedd för måttlig användning; vid många användare bör ni byta till en betaltjänst eller egen tile-server (`TILE_URL` i `src/leaflet.ts`).

## Chatt mellan kund och utförare
Så fort ett uppdrag är tilldelat (och betalt) får kund och utförare en knapp **Chatta** på uppdragskortet. Olästa meddelanden visas som antal på knappen och i fliken Profil, och en notis visas när ett nytt meddelande kommer in. Källa: `src/chat.ts`, regler i `diz_chat.sql` (kör den i Supabase SQL Editor – utan den fungerar resten av appen men chatten ger fel).

- **Behörighet:** bara kunden och den tilldelade utföraren kan skriva (via `send_message`, högst 15 meddelanden/minut, 1–1000 tecken). Ingen kan ändra eller radera meddelanden från klienten. Chatten stängs när uppdraget avslutas eller avbryts; historiken finns kvar och raderas när uppdraget raderas.
- **Admin kan läsa** konversationen (skrivskyddat, knapp på adminkortet) för att kunna utreda reklamationer. Användarna får veta det i en rad under chatten – ändra texten `chat.privacy` i `src/i18n.ts` om ni väljer en annan policy.
- **Uppdatering:** realtid plus hämtning var 7:e sekund som säkerhetsnät. Inga pushnotiser – användaren ser nya meddelanden när appen är öppen.
- **Begränsningar:** ingen bilddelning, ingen moderering/filtrering av innehåll, och telefonnummer döljs inte (parterna kan alltså byta kontaktuppgifter utanför appen).

## Ljudsamtal (WebRTC)
På ett tilldelat uppdrag finns en **📞 Ring**-knapp bredvid chatten. Mottagaren får en ringruta (Svara/Avvisa) och under samtalet finns tyst mikrofon och lägg på. Den som ringde lämnar en rad i chatten ("📞 Samtal (2:31)" eller "📞 Missat samtal"). Källa: `src/call.ts`, signalering i `diz_calls.sql` (kör den i Supabase SQL Editor).

- **Hur:** ljudet går direkt mellan parternas webbläsare (WebRTC). Databasen bär bara signaleringen (erbjudande, svar, ICE, avslut) i tabellen `call_signals`: bara parterna i ett pågående uppdrag kan skicka, bara mottagaren kan läsa och bara i 90 sekunder. Max 5 samtalsförsök/minut per användare. Inget ljud lagras, admin kan inte lyssna, telefonnummer visas inte.
- **STUN/TURN:** appen använder Googles gratis STUN-servrar för att hitta rätt adress. Det räcker för de flesta uppkopplingar, men inte när båda sidor sitter bakom vissa mobiloperatörers nät (uppskattningsvis 10–20 %). För dem behövs en TURN-relay: lägg in den i `TURN_SERVERS` överst i `src/call.ts` (Cloudflare, Twilio eller egen coturn; kostar pengar).
- **Integritet:** motparten kan se den andras IP-adress (det ligger i hur WebRTC fungerar) och Googles STUN-server ser IP-adressen vid uppkoppling. Det står i ringrutan; nämn det även i era användarvillkor.
- **Ordning på signalerna:** signalerna i ett samtal skickas i ordning (erbjudande/svar före ICE-kandidater) och mottagaren sparar kandidater som kommer före erbjudandet och håller reda på varje signal för sig i stället för ett högsta id, eftersom rader kan bli synliga i annan ordning än de fick id.
- **Begränsningar:** man kan bara ta emot samtal medan appen är öppen (en webbsida kan inte ringa i bakgrunden; det kräver pushnotiser/PWA eller mobilapp). Mikrofonbehörighet krävs och sidan måste köras över https. Samtalen är bara testade här med simulerad WebRTC – prova med två riktiga telefoner, helst på olika mobilnät, innan ni lanserar.

## Ignorera jobb (leverantör)
På varje öppet jobb finns en **Ignorera**-knapp bredvid "Ta jobbet". Jobbet försvinner då ur leverantörens lista – på alla hens enheter, eftersom valet sparas i `job_dismissals` (`diz_dismissals.sql`). Under listan finns **Visa ignorerade jobb (n)** där jobben kan återställas. Det påverkar varken kunden eller andra leverantörer. Man kan inte ignorera ett jobb man redan ansökt om. Utan SQL-filen fungerar knappen ändå, men valet gäller bara tills sidan laddas om.


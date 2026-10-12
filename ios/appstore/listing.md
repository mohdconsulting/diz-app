# App Store-underlag för Diz (iOS)

Fyll i i App Store Connect. Gula fält i `privacy-policy.html` (bolagsnamn, e-post) måste ifyllas innan policyn publiceras.

## Grunddata
- **Namn:** Diz (دز)
- **Bundle ID:** ändra `app.diz.Diz` i `ios/project.yml` till ditt eget (t.ex. `com.dittbolag.diz`)
- **Primärt språk:** arabiska (lägg även till svenska och engelska som lokalisering)
- **Kategori:** Livsstil (sekundär: Verktyg)
- **Åldersgräns:** 4+ (inget stötande innehåll; "användargenererat innehåll" = ja, eftersom chatt och recensioner finns, så svara att moderering finns: admin kan dölja recensioner)
- **Pris:** gratis. **Support-URL** och **integritetspolicy-URL:** publik adress till `privacy-policy.html` (t.ex. GitHub Pages) – samma adress ska in i `Config.privacyURL`.

## Arabiska
**Undertitel (max 30 tecken):** اطلب أي خدمة في العراق
**Kampanjtext:** نقل، إزالة نفايات، توصيل، سحب سيارات وخدمات منزلية – بسعر واضح ومتابعة مباشرة.
**Beskrivning:**
دز (Diz) تربطك بمقدمي الخدمات القريبين منك في العراق.

• اطلب: إزالة النفايات، نقل الأثاث، توصيل البضائع والطرود، سحب السيارات، كهربائي، سباك، بستاني، دهان وتنظيف
• سعر مقترح واضح، أو حدّد سعرك بنفسك
• يقدّم مقدمو الخدمة عروضهم وتختار الأنسب مع رؤية تقييمات الآخرين
• تابع مقدّم الخدمة على الخريطة أثناء توجهه إليك
• دردشة مباشرة داخل التطبيق
• ادفع بأمان – لا يُحرَّر المبلغ إلا بعد تأكيدك
• قيّم مقدم الخدمة بعد انتهاء المهمة

هل أنت مقدّم خدمة؟ سجّل واحصل على طلبات جديدة قريبة منك وابنِ سمعتك بالتقييمات.
**Nyckelord (max 100 tecken):** نقل,توصيل,سحب سيارات,خدمات منزلية,كهربائي,سباك,تنظيف,العراق,بغداد

## Svenska
**Undertitel:** Beställ tjänster i Irak
**Kampanjtext:** Flytt, skräpbortforsling, leverans, bärgning och hemtjänster – tydligt pris och live-spårning.
**Beskrivning:**
Diz kopplar ihop dig med utförare nära dig i Irak.

• Beställ skräpbortforsling, flytthjälp, varuleverans, bilbärgning, elektriker, rörmokare, trädgård, målning och städning
• Tydligt prisförslag – eller sätt ditt eget pris
• Utförare skickar offerter och du väljer, med andras betyg som stöd
• Följ utföraren på kartan när hen är på väg
• Chatt direkt i appen
• Betala tryggt – pengarna släpps först när du bekräftar
• Betygsätt utföraren när jobbet är klart

Är du utförare? Registrera dig, få nya uppdrag nära dig och bygg ditt rykte med betyg.
**Nyckelord:** flytt,leverans,bärgning,hemtjänst,elektriker,rörmokare,städning,Irak,Bagdad

## English
**Subtitle:** Order services in Iraq
**Promotional text:** Moving, junk removal, delivery, towing and home services – clear price and live tracking.
**Description:**
Diz connects you with service providers near you in Iraq.

• Order junk removal, moving help, delivery of goods and parcels, car towing, electrician, plumber, gardener, painter and cleaning
• A clear suggested price – or set your own
• Providers send offers and you choose, with other customers' ratings to help
• Follow your provider on the map while they are on the way
• Chat directly in the app
• Pay safely – money is only released when you confirm
• Rate the provider when the job is done

Are you a provider? Sign up, get new jobs near you and build your reputation with ratings.
**Keywords:** moving,delivery,towing,home services,electrician,plumber,cleaning,Iraq,Baghdad

## App Privacy (frågeformuläret i App Store Connect)
Svara att appen samlar in följande, **kopplat till användaren**, **inte** för spårning (tracking) och bara för "App-funktionalitet":
| Datatyp | Varför |
|---|---|
| Kontaktinfo → Namn, Telefonnummer | Konto och kontakt mellan kund/utförare |
| Plats → Exakt plats | Utförarens position visas för kunden |
| Användarinnehåll → Meddelanden i appen; Annat innehåll (recensioner, förfrågningar) | Chatt, betyg, uppdrag |
| Identifierare → Användar-ID | Inloggning |
| Köp/Ekonomisk info → Betalningsinfo (endast belopp/status) | Betalningar i depositionsflödet |
Spårning: **Nej**.

## Anteckningar till granskaren (App Review Information)
> Diz is a marketplace for real-world services in Iraq (moving, delivery, towing, home services). Payments are for physical services performed outside the app, so In-App Purchase does not apply (guideline 3.1.3(e)). Location is used only while the app is open, to let a customer follow a provider who is on the way to their job. Accounts can be deleted in the app under Profile → Delete my account.
> Test accounts – Customer: phone `[...]` / password `[...]`. Provider: phone `[...]` / password `[...]`.
(Skapa två riktiga testkonton i appen och skriv in dem. Låt dem ha ett exempeluppdrag så granskaren ser innehåll.)

## Skärmdumpar
Ta i simulatorn (⌘S) med iPhone 15 Pro Max eller 6,7": inloggning, ny beställning, mina förfrågningar med offerter, kartan, chatt, historik med betyg. Krävs i minst en iPhone-storlek.

## Före inskickning
1. Kör `diz_account_delete.sql` i Supabase SQL Editor (annars fungerar inte "Radera mitt konto").
2. Publicera `privacy-policy.html` och uppdatera `Config.privacyURL`.
3. Testa hela flödet i TestFlight (kund + utförare, positionsdelning på riktig telefon).
4. Archive → Distribute App → App Store Connect.

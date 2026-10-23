# App Store-underlag för Diz (iOS)

Fyll i i App Store Connect. Gula fält i `privacy-policy.html` (bolagsnamn, e-post) måste ifyllas innan policyn publiceras.

## Grunddata
- **Namn:** Diz (دز)
- **Bundle ID:** `com.mohdconsulting.diz` (ska matcha `ios/project.yml`)
- **Primärt språk:** arabiska (lägg även till svenska och engelska som lokalisering)
- **Kategori:** Livsstil (sekundär: Verktyg)
- **Åldersgräns:** 4+ (inget stötande innehåll; "användargenererat innehåll" = ja, eftersom chatt och recensioner finns, så svara att moderering finns: admin kan dölja recensioner)
- **Pris:** gratis. **Support-URL** och **integritetspolicy-URL:** publik adress till `privacy-policy.html` (t.ex. GitHub Pages) – samma adress ska in i `Config.privacyURL`.

## Arabiska
**Undertitel (max 30 tecken):** اطلب أي خدمة في العراق
**Kampanjtext:** نقل، إزالة نفايات، توصيل، سحب سيارات وخدمات منزلية – سعر واضح ومتابعة مباشرة. الدفع نقداً للمزوّد.
**Beskrivning:**
دز (Diz) تربطك بمقدمي الخدمات القريبين منك في العراق.

• اطلب: إزالة النفايات، نقل الأثاث، توصيل البضائع والطرود، سحب السيارات، كهربائي، سباك، بستاني، دهان وتنظيف
• سعر مقترح واضح، أو حدّد سعرك بنفسك
• يقدّم مقدمو الخدمة عروضهم وتختار الأنسب مع رؤية تقييمات الآخرين
• تابع مقدّم الخدمة على الخريطة أثناء توجهه إليك
• دردشة مباشرة داخل التطبيق
• الدفع نقداً مباشرةً لمقدّم الخدمة بعد إنجاز المهمة
• مكالمات صوتية داخل التطبيق
• قيّم مقدم الخدمة بعد انتهاء المهمة

هل أنت مقدّم خدمة؟ سجّل واحصل على طلبات جديدة قريبة منك وابنِ سمعتك بالتقييمات.
**Nyckelord (max 100 tecken):** نقل,توصيل,سحب سيارات,خدمات منزلية,كهربائي,سباك,تنظيف,العراق,بغداد,عمال,تصليح

## Svenska
**Undertitel:** Beställ tjänster i Irak
**Kampanjtext:** Flytt, skräpbortforsling, leverans, bärgning och hemtjänster – tydligt pris, live-spårning och kontantbetalning.
**Beskrivning:**
Diz kopplar ihop dig med utförare nära dig i Irak.

• Beställ skräpbortforsling, flytthjälp, varuleverans, bilbärgning, elektriker, rörmokare, trädgård, målning och städning
• Tydligt prisförslag – eller sätt ditt eget pris
• Utförare skickar offerter och du väljer, med andras betyg som stöd
• Följ utföraren på kartan när hen är på väg
• Chatt direkt i appen
• Betala kontant direkt till utföraren när jobbet är klart
• Röstsamtal direkt i appen
• Betygsätt utföraren när jobbet är klart

Är du utförare? Registrera dig, få nya uppdrag nära dig och bygg ditt rykte med betyg.
**Nyckelord:** flytt,leverans,bärgning,hemtjänst,elektriker,rörmokare,städning,Irak,Bagdad,hantverkare

## English
**Subtitle:** Order services in Iraq
**Promotional text:** Moving, junk removal, delivery, towing and home services – clear price, live tracking and cash payment.
**Description:**
Diz connects you with service providers near you in Iraq.

• Order junk removal, moving help, delivery of goods and parcels, car towing, electrician, plumber, gardener, painter and cleaning
• A clear suggested price – or set your own
• Providers send offers and you choose, with other customers' ratings to help
• Follow your provider on the map while they are on the way
• Chat directly in the app
• Pay in cash directly to the provider when the job is done
• Voice calls in the app
• Rate the provider when the job is done

Are you a provider? Sign up, get new jobs near you and build your reputation with ratings.
**Keywords:** moving,delivery,towing,home services,electrician,plumber,cleaning,Iraq,Baghdad,handyman

## App Privacy (frågeformuläret i App Store Connect)
Appen tar ingen betalning (kontant mellan kund och utförare), så **Betalningsinfo ska inte anges**. Röstsamtal går direkt mellan användarna (WebRTC) och spelas inte in eller lagras av oss, så ange inte ljuddata. Svara att appen samlar in följande, **kopplat till användaren**, **inte** för spårning (tracking) och bara för "App-funktionalitet":
| Datatyp | Varför |
|---|---|
| Kontaktinfo → Namn, Telefonnummer | Konto och kontakt mellan kund/utförare |
| Plats → Exakt plats | Utförarens position visas för kunden |
| Användarinnehåll → Meddelanden i appen; Annat innehåll (recensioner, förfrågningar) | Chatt, betyg, uppdrag |
| Identifierare → Användar-ID | Inloggning |
Spårning: **Nej**.

## Anteckningar till granskaren (App Review Information)
> Diz is a marketplace for real-world services in Iraq (moving, delivery, towing, home services). The app takes no payments: customers pay the provider in cash for physical services performed outside the app, so In-App Purchase does not apply. The microphone is used only for voice calls between customer and provider. Location is used only while the app is open, to let a customer follow a provider who is on the way to their job. Accounts can be deleted in the app under Profile → Delete my account.
> Test accounts – Customer: phone `[...]` / password `[...]`. Provider: phone `[...]` / password `[...]`.
(Skapa två riktiga testkonton i appen och skriv in dem. Låt dem ha ett exempeluppdrag så granskaren ser innehåll.)

## Skärmdumpar
Ta i simulatorn (⌘S) med iPhone 15 Pro Max eller 6,7": inloggning, ny beställning, mina förfrågningar med offerter, kartan, chatt, historik med betyg. Krävs i minst en iPhone-storlek.

## Före inskickning
1. Kör `diz_account_delete.sql` i Supabase SQL Editor (annars fungerar inte "Radera mitt konto").
2. Publicera `privacy-policy.html` och uppdatera `Config.privacyURL`.
3. Testa hela flödet i TestFlight (kund + utförare, positionsdelning på riktig telefon).
4. Archive → Distribute App → App Store Connect.

## Vad är nytt (What's New) – första versionen
- ar: الإصدار الأول من دز. اطلب خدمات في العراق، تابع مقدّم الخدمة على الخريطة، وادفع نقداً مباشرة.
- sv: Första versionen av Diz. Beställ tjänster i Irak, följ utföraren på kartan och betala kontant direkt.
- en: First release of Diz. Order services in Iraq, follow your provider on the map and pay in cash directly.

## Teckengränser (App Store Connect)
Namn och undertitel max 30 tecken, kampanjtext 170, nyckelord 100 (kommaseparerade, inga mellanslag), beskrivning 4000.

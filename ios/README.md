# dizli för iPhone (SwiftUI)

Native iPhone-app mot **samma Supabase-backend** som webbappen – samma konton, samma uppdrag, samma texter (sv/en/ar, arabiska som standard med RTL).

> ⚠️ **Ej kompilerad än.** Koden är skriven utan tillgång till Xcode/Swift-kompilator. Räkna med några små kompileringsfel första gången du bygger på en Mac; lägg gärna in dem som issues så fixas de.

## Bygg
1. På en Mac med Xcode 15+: `brew install xcodegen`
2. `cd ios && xcodegen generate && open Diz.xcodeproj`
3. Välj ditt Apple Developer-team under *Signing & Capabilities* (eller sätt `DEVELOPMENT_TEAM` i `project.yml`).
4. Kör på simulator eller iPhone. Tester: ⌘U (`DizTests`).

Inga externa paket – egen `URLSession`-klient för Supabase Auth och PostgREST (`API.swift`).

## Texter
`Diz/Resources/strings.json` och `catalog.json` genereras från `src/i18n.ts`:
`node scripts/gen-ios-strings.mjs` (kör efter ändrade texter i webbappen).

## Vad som finns
- Inloggning/registrering (kund, förare, bärgare, yrkesprofiler), session i Keychain
- Kund: ny förfrågan med prisförslag/eget pris, ansökningar med betyg, tilldela (+ testbetalning i `mock`-läge), bekräfta/frisläpp, rapportera problem, ta bort, följ utföraren på karta, chatt, recension
- Utförare: öppna jobb (profilfilter), ansök/föreslå pris, ignorera/återställ, anlänt/klart, svara på problem, chatt, positionsdelning (medan appen är öppen), eget betyg och kommentarer
- Tider: kunden väljer omgående/tidigast möjligt eller dag + en eller flera intilliggande timmar (varje slot = 1 timme); utföraren kan föreslå annan tid vid ansökan, och kunden godkänner genom att tilldela. Kräver att `diz_scheduling.sql` körs i Supabase.
- Uppdatering var 5:e sekund + dra för att uppdatera

## Begränsningar (v1)
Ljudsamtal (WebRTC), admin-gränssnitt, foton, riktiga betalningar (`live` – hänvisa till webben), pushnotiser och bakgrundsposition finns inte i iPhone-appen ännu.
För att publicera i App Store krävs Apple Developer-konto (99 USD/år).

## App Store
Se `appstore/listing.md` (texter på ar/sv/en, App Privacy-svar, granskarnotering, checklista) och `appstore/privacy-policy.html`.
Radera konto i appen kräver att `diz_account_delete.sql` körs i Supabase; tidsval kräver `diz_scheduling.sql`.

## Voice calls
Customer and assigned provider can call each other from the job card or the chat (📞). It uses the same signalling as
the web app (`diz_calls.sql`, must be run in Supabase), so iPhone ↔ iPhone and iPhone ↔ web calls work. The audio
connection is WebKit's WebRTC in a hidden web view (`CallEngine.swift`); call logic is in `CallManager.swift`.
Like the web app, calls ring only while the app is open (no push/CallKit), and only STUN is configured – add a TURN
server in `CallEngine.swift` if calls fail on some mobile networks. iOS asks for microphone permission on the first call.
Run `xcodegen generate` after pulling (new files and the microphone text in `project.yml`).

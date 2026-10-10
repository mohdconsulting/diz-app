# Diz för iPhone (SwiftUI)

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
- Uppdatering var 5:e sekund + dra för att uppdatera

## Begränsningar (v1)
Ljudsamtal (WebRTC), admin-gränssnitt, foton, riktiga betalningar (`live` – hänvisa till webben), pushnotiser och bakgrundsposition finns inte i iPhone-appen ännu. Appikon saknas (lägg en 1024×1024 PNG i `AppIcon.appiconset`).
För att publicera i App Store krävs Apple Developer-konto (99 USD/år).

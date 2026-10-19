# Diz (دز) – Android

Native Android app (Kotlin + Jetpack Compose) with the same features as the web and iPhone versions:
sv/en/ar (Arabic default, RTL), requests, scheduling, offers, chat, live location tracking, reviews,
voice calls, account deletion. Payment is **cash only** (`Config.CASH_ONLY`).

## Build
- Android Studio (Koala+) → open `android/` → Run. Or: `cd android && ./gradlew :app:assembleDebug`
- APK: `app/build/outputs/apk/debug/app-debug.apk`. CI (GitHub Actions) also uploads it as artifact `diz-debug-apk`.
- Tests: `./gradlew :app:testDebugUnitTest`

## Backend
Same Supabase project as web/iOS. Run these in the SQL editor if not done yet:
`diz_scheduling.sql`, `diz_cash_only.sql`, `diz_calls.sql`, `diz_account_delete.sql`.

## Notes
- Translations are generated from `src/i18n.ts`: `node scripts/gen-android-strings.mjs` (writes `app/src/main/assets`). `extra.json` is handwritten.
- Maps use osmdroid (OpenStreetMap, no API key); location uses the platform LocationManager.
- Voice calls: signalling via `call_signals`/`send_call_signal`, WebRTC runs in a hidden WebView (STUN only). Calls ring only while the app is open.
- Status: compiles and passes unit tests in CI; not yet tested on a physical device.
- Release: add the 4 ANDROID_* secrets in GitHub, then re-run the Android workflow; artifact `diz-release-aab` is the signed AAB for Google Play.

package app.diz

/** Same Supabase project as the web app and the iPhone app. The anon/publishable key is public by design;
 *  all access is limited by the row level security rules in the SQL files. */
object Config {
    const val SUPABASE_URL = "https://royjjuxojdlqrjteqsge.supabase.co"
    const val SUPABASE_KEY = "sb_publishable_NITFKxKLeHmD98dHgTfBpg_ZNgaWqGm"
    const val PRIVACY_URL = "https://mohdconsulting.github.io/diz-app/privacy-policy.html"

    /** First phase: all payment is cash, directly from the customer to the provider (no in-app payments). */
    const val CASH_ONLY = true

    const val POLL_SECONDS = 5L
    const val LOCATION_SEND_SECONDS = 10L

    /** Supabase Auth needs an email-shaped id, so each phone number is mapped to diz.<digits>@gmail.com
     *  (identical to authEmail() in src/auth.ts, otherwise web and app users could not share accounts). */
    fun authEmail(phone: String): String {
        val local = phone.asciiDigits().filter { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' }.lowercase()
        return if (local.isEmpty()) "" else "diz.$local@gmail.com"
    }
}

/** Converts Arabic-Indic (٠١٢…) and Persian (۰۱۲…) digits to ASCII 0–9 (Arabic keyboards produce them). */
fun String.asciiDigits(): String = buildString {
    for (ch in this@asciiDigits) {
        when (ch.code) {
            in 0x0660..0x0669 -> append('0' + (ch.code - 0x0660))
            in 0x06F0..0x06F9 -> append('0' + (ch.code - 0x06F0))
            else -> append(ch)
        }
    }
}

/** Whole-number value of the digits in the string (0 if none). */
val String.intValue: Int get() = asciiDigits().filter { it in '0'..'9' }.toIntOrNull() ?: 0

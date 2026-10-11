import Foundation

/// Same Supabase project as the web app (see src/db.ts). The anon/publishable key is public by design;
/// all access is limited by the row level security rules in the SQL files.
extension String {
    /// Converts Arabic-Indic (٠١٢…) and Persian (۰۱۲…) digits to ASCII 0–9. The iPhone keyboard produces
    /// Arabic-Indic digits when the system or app language is Arabic, which broke phone numbers and prices.
    var asciiDigits: String {
        var out = ""
        for ch in self {
            if let v = ch.unicodeScalars.first?.value, ch.unicodeScalars.count == 1 {
                if v >= 0x0660 && v <= 0x0669 { out.append(Character(UnicodeScalar(v - 0x0660 + 0x30)!)); continue }
                if v >= 0x06F0 && v <= 0x06F9 { out.append(Character(UnicodeScalar(v - 0x06F0 + 0x30)!)); continue }
            }
            out.append(ch)
        }
        return out
    }
    /// Whole-number value of the digits in the string (0 if none).
    var intValue: Int { Int(asciiDigits.filter { $0.isASCII && $0.isNumber }) ?? 0 }
}

enum Config {
    static let supabaseURL = URL(string: "https://royjjuxojdlqrjteqsge.supabase.co")!
    static let supabaseKey = "sb_publishable_NITFKxKLeHmD98dHgTfBpg_ZNgaWqGm"

    /// Supabase Auth needs an email-shaped id, so each phone number is mapped to diz.<digits>@gmail.com
    /// (identical to authEmail() in src/auth.ts, otherwise web and iPhone users could not share accounts).
    static func authEmail(phone: String) -> String {
        let allowed = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        let local = String(phone.asciiDigits.filter { allowed.contains($0) }).lowercased()
        return local.isEmpty ? "" : "diz." + local + "@gmail.com"
    }

    /// Public URL of the privacy policy (host ios/appstore/privacy-policy.html and change this to its address).
    static let privacyURL = URL(string: "https://mohdconsulting.github.io/diz-app/privacy-policy.html")!

    static let pollSeconds: UInt64 = 5
    static let locationSendSeconds: TimeInterval = 10
}

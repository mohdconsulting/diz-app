import Foundation

/// Same Supabase project as the web app (see src/db.ts). The anon/publishable key is public by design;
/// all access is limited by the row level security rules in the SQL files.
enum Config {
    static let supabaseURL = URL(string: "https://royjjuxojdlqrjteqsge.supabase.co")!
    static let supabaseKey = "sb_publishable_NITFKxKLeHmD98dHgTfBpg_ZNgaWqGm"

    /// Supabase Auth needs an email-shaped id, so each phone number is mapped to diz.<digits>@gmail.com
    /// (identical to authEmail() in src/auth.ts, otherwise web and iPhone users could not share accounts).
    static func authEmail(phone: String) -> String {
        let allowed = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        let local = String(phone.filter { allowed.contains($0) }).lowercased()
        return local.isEmpty ? "" : "diz." + local + "@gmail.com"
    }

    static let pollSeconds: UInt64 = 5
    static let locationSendSeconds: TimeInterval = 10
}

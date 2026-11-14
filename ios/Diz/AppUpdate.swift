import Foundation
import SwiftUI

/// "New version available" notice that the admin switches on (table app_notice, see diz_app_notice.sql).
struct AppNotice: Decodable {
    var active: Bool
    var iosLatest: String
    var iosMin: String
    var msgAr: String
    var msgEn: String
    enum CodingKeys: String, CodingKey {
        case active, iosLatest = "ios_latest", iosMin = "ios_min", msgAr = "msg_ar", msgEn = "msg_en"
    }
}

enum AppUpdate {
    static var installed: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0" }

    /// True when `a` is older than `b` ("1.0" < "1.0.1" < "1.2").
    static func older(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }, y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0 ..< max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
            if p != q { return p < q }
        }
        return false
    }

    enum State { case none, available(String), required(String) }

    static func state(_ n: AppNotice?, lang: Lang) -> State {
        guard let n = n, n.active else { return .none }
        let msg = (lang == .ar ? n.msgAr : n.msgEn).trimmingCharacters(in: .whitespacesAndNewlines)
        if !n.iosMin.isEmpty, older(installed, than: n.iosMin) { return .required(msg) }
        if !n.iosLatest.isEmpty, older(installed, than: n.iosLatest) { return .available(msg) }
        return .none
    }

    /// The App Store page of this app (looked up by bundle id, so no app id is hard-coded).
    static func storeURL() async -> URL {
        let id = Bundle.main.bundleIdentifier ?? "com.mohdconsulting.diz"
        if let u = URL(string: "https://itunes.apple.com/lookup?bundleId=\(id)"),
           let (d, _) = try? await URLSession.shared.data(from: u),
           let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let r = (o["results"] as? [[String: Any]])?.first,
           let s = r["trackViewUrl"] as? String, let url = URL(string: s) { return url }
        return URL(string: "https://apps.apple.com/search?term=Diz")!
    }
}

struct UpdateBanner: View {
    @EnvironmentObject var store: Store
    let message: String
    let required: Bool
    let onLater: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(store.tr("update.title")).font(.system(size: 18, weight: .semibold)).foregroundColor(.dizInk)
            Text(message.isEmpty ? store.tr(required ? "update.requiredText" : "update.text") : message)
                .font(.system(size: 16.5)).foregroundColor(.dizMuted)
            HStack(spacing: 10) {
                PrimaryButton(title: store.tr("update.btn")) {
                    Task {
                        let url = await AppUpdate.storeURL()
                        await UIApplication.shared.open(url)
                    }
                }
                if !required {
                    Button(store.tr("update.later"), action: onLater)
                        .font(.system(size: 17, weight: .semibold)).foregroundColor(.dizTeal2).padding(.horizontal, 8)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .overlay(Rectangle().stroke(Color.dizAmber, lineWidth: 2))
        .padding(12)
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
    }
}

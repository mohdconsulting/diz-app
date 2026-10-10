import Foundation

enum Lang: String, CaseIterable, Identifiable {
    case ar, sv, en
    var id: String { rawValue }
    var title: String { switch self { case .ar: return "AR"; case .sv: return "SV"; case .en: return "EN" } }
    var isRTL: Bool { self == .ar }
    var locale: Locale { Locale(identifier: rawValue) }
}

struct ServiceInfo: Decodable, Identifiable, Hashable {
    let key: String
    let needsToAddr: Bool
    let categories: [String]
    let sizes: [Int]
    var id: String { key }
}

/// Texts come from Resources/strings.json, generated from src/i18n.ts by scripts/gen-ios-strings.mjs,
/// so the iPhone app uses exactly the same wording as the web app.
final class Strings {
    static let shared = Strings()
    private let table: [String: [String: String]]
    let services: [ServiceInfo]

    private init() {
        func load<T: Decodable>(_ name: String, as type: T.Type) -> T? {
            guard let url = Bundle.main.url(forResource: name, withExtension: "json"),
                  let data = try? Data(contentsOf: url) else { return nil }
            return try? JSONDecoder().decode(T.self, from: data)
        }
        table = load("strings", as: [String: [String: String]].self) ?? [:]
        services = load("catalog", as: [ServiceInfo].self) ?? []
    }

    /// Looks up a text; `{name}` placeholders are replaced from `vars`. Falls back to Swedish, then to the key.
    func text(_ key: String, _ lang: Lang, _ vars: [String: String] = [:]) -> String {
        var s = table[lang.rawValue]?[key] ?? table["sv"]?[key] ?? key
        for (k, v) in vars { s = s.replacingOccurrences(of: "{" + k + "}", with: v) }
        return s
    }

    func service(_ key: String) -> ServiceInfo? { services.first { $0.key == key } }
}

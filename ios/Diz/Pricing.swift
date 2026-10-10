import Foundation

/// Same price table as src/pricing.ts.
enum Pricing {
    static let base: [String: [Int: Int]] = [
        "junk": [1: 25000, 2: 45000, 3: 75000],
        "moving": [1: 60000, 2: 120000, 3: 250000],
        "goods": [1: 10000, 2: 20000],
        "pro": [1: 30000, 2: 70000, 3: 50000],
        "towing": [1: 40000, 2: 60000, 3: 100000],
        "deliver": [1: 8000, 2: 15000],
    ]
    static let bump: [String: [String: Int]] = [
        "junk": ["appliances": 5000, "electronics": 3000, "leftover": 10000],
        "moving": ["apartment": 15000, "house": 40000],
        "goods": ["electronics": 5000, "furniture": 10000],
        "pro": ["electrician": 5000, "plumber": 5000, "painter": 4000],
        "towing": ["accident": 15000, "transport": -10000],
        "deliver": ["fragile": 5000, "package": 2000],
    ]

    static func price(service: String, size: Int?, cat: String?) -> Int {
        let b = base[service]?[size ?? 0] ?? 200
        let extra = bump[service]?[cat ?? ""] ?? 0
        return b + extra
    }
}

import Foundation
import Security

struct APIError: Error, LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

struct Session: Codable {
    var accessToken: String
    var refreshToken: String
    var userId: String
    var expiresAt: Date
}

/// Minimal Keychain wrapper (the session must not live in UserDefaults).
enum Keychain {
    private static let service = "app.diz.Diz"
    static func save(_ data: Data, account: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: service,
                                   kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }
    static func load(account: String) -> Data? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: account,
                                kSecReturnData as String: true,
                                kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }
    static func delete(account: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: account]
        SecItemDelete(q as CFDictionary)
    }
}

/// Own small client for Supabase Auth (GoTrue) and PostgREST. No external packages.
@MainActor
final class API {
    private(set) var session: Session?
    private let urlSession = URLSession(configuration: .default)
    private let sessionAccount = "session"

    init() {
        if let d = Keychain.load(account: sessionAccount) {
            let dec = JSONDecoder()
            dec.dateDecodingStrategy = .secondsSince1970
            session = try? dec.decode(Session.self, from: d)
        }
    }

    // MARK: Session

    private func store(_ s: Session?) {
        session = s
        if let s = s {
            let enc = JSONEncoder()
            enc.dateEncodingStrategy = .secondsSince1970
            if let d = try? enc.encode(s) { Keychain.save(d, account: sessionAccount) }
        } else {
            Keychain.delete(account: sessionAccount)
        }
    }

    func clearSession() { store(nil) }

    private func parseAuth(_ data: Data) throws -> Session? {
        guard let o = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        guard let access = o["access_token"] as? String,
              let refresh = o["refresh_token"] as? String,
              let user = o["user"] as? [String: Any],
              let uid = user["id"] as? String else { return nil }
        let expiresIn = (o["expires_in"] as? Double) ?? 3600
        return Session(accessToken: access, refreshToken: refresh, userId: uid,
                       expiresAt: Date().addingTimeInterval(expiresIn - 30))
    }

    /// Returns nil when the project requires e-mail confirmation (no session is issued).
    func signUp(email: String, password: String, metadata: [String: Any]) async throws -> Session? {
        let body: [String: Any] = ["email": email, "password": password, "data": metadata]
        let data = try await raw("POST", "/auth/v1/signup", body: body, auth: false)
        let s = try parseAuth(data)
        if let s = s { store(s) }
        return s
    }

    func signIn(email: String, password: String) async throws {
        let data = try await raw("POST", "/auth/v1/token", query: [URLQueryItem(name: "grant_type", value: "password")],
                                 body: ["email": email, "password": password], auth: false)
        guard let s = try parseAuth(data) else { throw APIError(status: 0, message: "Invalid auth response") }
        store(s)
    }

    private var refreshing = false
    @discardableResult
    func refreshIfNeeded(force: Bool = false) async -> Bool {
        guard let s = session else { return false }
        if !force && s.expiresAt > Date() { return true }
        if refreshing { return true }
        refreshing = true
        defer { refreshing = false }
        do {
            let data = try await raw("POST", "/auth/v1/token", query: [URLQueryItem(name: "grant_type", value: "refresh_token")],
                                     body: ["refresh_token": s.refreshToken], auth: false)
            guard let n = try parseAuth(data) else { return false }
            store(n)
            return true
        } catch let e as APIError where e.status == 400 || e.status == 401 {
            store(nil)   // refresh token is no longer valid
            return false
        } catch {
            return false // offline: keep the session and try again later
        }
    }

    // MARK: HTTP

    private func raw(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Any? = nil,
                     auth: Bool = true, prefer: String? = nil) async throws -> Data {
        var comps = URLComponents(url: Config.supabaseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = method
        req.timeoutInterval = 20
        req.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
        if auth, let s = session { req.setValue("Bearer " + s.accessToken, forHTTPHeaderField: "Authorization") }
        if let prefer = prefer { req.setValue(prefer, forHTTPHeaderField: "Prefer") }
        if let body = body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, resp) = try await urlSession.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code >= 200 && code < 300 { return data }
        var msg = "HTTP \(code)"
        if let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            msg = (o["message"] as? String) ?? (o["msg"] as? String) ?? (o["error_description"] as? String)
                ?? (o["error"] as? String) ?? msg
        }
        throw APIError(status: code, message: msg)
    }

    /// Authenticated request; refreshes the token once on 401.
    private func call(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Any? = nil,
                      prefer: String? = nil) async throws -> Data {
        await refreshIfNeeded()
        do {
            return try await raw(method, path, query: query, body: body, prefer: prefer)
        } catch let e as APIError where e.status == 401 {
            if await refreshIfNeeded(force: true) {
                return try await raw(method, path, query: query, body: body, prefer: prefer)
            }
            throw e
        }
    }

    // MARK: PostgREST

    func select<T: Decodable>(_ table: String, _ type: T.Type, filters: [URLQueryItem] = [],
                              order: String? = nil, limit: Int? = nil) async throws -> [T] {
        var q = [URLQueryItem(name: "select", value: "*")] + filters
        if let order = order { q.append(URLQueryItem(name: "order", value: order)) }
        if let limit = limit { q.append(URLQueryItem(name: "limit", value: String(limit))) }
        let data = try await call("GET", "/rest/v1/" + table, query: q)
        return try JSONDecoder().decode([T].self, from: data)
    }

    /// Returns the number of rows touched (PATCH with return=representation).
    @discardableResult
    func update(_ table: String, id: String, _ patch: [String: Any]) async throws -> Int {
        let data = try await call("PATCH", "/rest/v1/" + table, query: [URLQueryItem(name: "id", value: "eq." + id), URLQueryItem(name: "select", value: "id")],
                                  body: patch, prefer: "return=representation")
        let arr = (try? JSONSerialization.jsonObject(with: data) as? [Any]) ?? []
        if arr.isEmpty { throw APIError(status: 403, message: "No rows updated") }
        return arr.count
    }

    func insert(_ table: String, _ row: [String: Any]) async throws {
        _ = try await call("POST", "/rest/v1/" + table, body: row, prefer: "return=minimal")
    }

    func delete(_ table: String, id: String) async throws {
        _ = try await call("DELETE", "/rest/v1/" + table, query: [URLQueryItem(name: "id", value: "eq." + id)], prefer: "return=minimal")
    }

    @discardableResult
    func rpc(_ fn: String, _ args: [String: Any] = [:]) async throws -> Data {
        try await call("POST", "/rest/v1/rpc/" + fn, body: args)
    }

    func rpcDecode<T: Decodable>(_ fn: String, _ args: [String: Any] = [:], as type: T.Type) async throws -> T {
        let d = try await rpc(fn, args)
        return try JSONDecoder().decode(T.self, from: d)
    }
}

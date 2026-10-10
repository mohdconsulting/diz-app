import Foundation
import SwiftUI

private struct DismissRow: Decodable { let job_id: String }

/// All app state plus every action. Mirrors what src/*.ts does in the web app.
@MainActor
final class Store: ObservableObject {
    // MARK: Published state
    @Published var lang: Lang {
        didSet { UserDefaults.standard.set(lang.rawValue, forKey: "lang") }
    }
    @Published var user: AppUser?
    @Published var jobs: [Job] = []
    @Published var messages: [ChatMessage] = []
    @Published var locations: [String: ProviderLocation] = [:]
    @Published var payments: [String: PaymentRow] = [:]      // by job id
    @Published var paymentsMode = "off"
    @Published var dismissed: Set<String> = []
    @Published var reviews: [String: Review] = [:]           // by job id
    @Published var ratings: [String: Rating] = [:]           // by provider phone
    @Published var myComments: [ProviderComment] = []
    @Published var toastText: String?
    @Published var busy = false
    @Published var restoring = true
    @Published var locationDenied = false

    let api = API()
    let sharing = LocationSharing()
    private var pollTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?
    private var ratingsKey = ""

    init() {
        let saved = UserDefaults.standard.string(forKey: "lang") ?? ""
        lang = Lang(rawValue: saved) ?? .ar
        sharing.onFix = { [weak self] jobId, lat, lng, acc in
            guard let self = self else { return false }
            return await self.sendFix(jobId: jobId, lat: lat, lng: lng, accuracy: acc)
        }
        sharing.onDenied = { [weak self] denied in self?.locationDenied = denied }
    }

    // MARK: Helpers
    func tr(_ key: String, _ vars: [String: String] = [:]) -> String { Strings.shared.text(key, lang, vars) }
    func money(_ n: Int) -> String { "\(n) " + tr("priceUnit") }
    func toast(_ key: String, _ vars: [String: String] = [:]) { toastRaw(tr(key, vars)) }
    func toastRaw(_ s: String) {
        toastText = s
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if !Task.isCancelled { self?.toastText = nil }
        }
    }

    var isDriver: Bool { user?.isDriver ?? false }
    var myPhone: String { user?.phone ?? "" }

    // MARK: Session lifecycle
    func restore() async {
        defer { restoring = false }
        guard api.session != nil else { return }
        guard await api.refreshIfNeeded(), let s = api.session else { return }
        if let u = await fetchUser(id: s.userId, retries: 1) {
            user = u
            await afterSignIn()
        } else if api.session == nil {
            user = nil
        }
    }

    private func fetchUser(id: String, retries: Int) async -> AppUser? {
        for i in 0..<max(1, retries) {
            if let rows = try? await api.select("users", AppUser.self, filters: [URLQueryItem(name: "id", value: "eq." + id)]),
               let u = rows.first { return u }
            if i < retries - 1 { try? await Task.sleep(nanoseconds: 500_000_000) }
        }
        return nil
    }

    func login(phone: String, password: String) async {
        let email = Config.authEmail(phone: phone)
        guard !email.isEmpty, !password.isEmpty else { toast("toastAuthMissingFields"); return }
        busy = true; defer { busy = false }
        do {
            try await api.signIn(email: email, password: password)
            guard let s = api.session, let u = await fetchUser(id: s.userId, retries: 4) else {
                toast("toastDbUnavailable"); return
            }
            user = u
            toast("toastLoginSuccess")
            await afterSignIn()
        } catch let e as APIError where e.status == 400 || e.status == 401 {
            toast("toastAuthLoginFailed")
        } catch {
            toast("toastDbUnavailable")
        }
    }

    func register(name: String, phone: String, password: String, role: String, profiles: [String]) async {
        let email = Config.authEmail(phone: phone)
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty, !email.isEmpty, !password.isEmpty else {
            toast("toastAuthMissingFields"); return
        }
        guard password.count >= 6 else { toast("toastPasswordShort"); return }
        if role == "driver" && profiles.isEmpty { toast("toastAuthMissingProfiles"); return }
        busy = true; defer { busy = false }
        do {
            let meta: [String: Any] = ["name": name.trimmingCharacters(in: .whitespaces), "phone": phone,
                                       "role": role, "profiles": role == "driver" ? profiles : []]
            guard let s = try await api.signUp(email: email, password: password, metadata: meta) else {
                toast("toastAuthNeedsConfirm"); return
            }
            guard let u = await fetchUser(id: s.userId, retries: 6) else { toast("toastDbUnavailable"); return }
            user = u
            toast("toastRegisterSuccess")
            await afterSignIn()
        } catch let e as APIError {
            let m = e.message.lowercased()
            if m.contains("already") || m.contains("registered") { toast("toastAuthPhoneTaken") }
            else { toastRaw(e.message) }
        } catch {
            toast("toastDbUnavailable")
        }
    }

    func logout() {
        pollTask?.cancel(); pollTask = nil
        sharing.stop()
        api.clearSession()
        user = nil; jobs = []; messages = []; locations = [:]; payments = [:]; dismissed = []
        reviews = [:]; ratings = [:]; myComments = []; ratingsKey = ""; paymentsMode = "off"
    }

    private func afterSignIn() async {
        await loadPaymentsMode()
        await refreshAll()
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: Config.pollSeconds * 1_000_000_000)
                if Task.isCancelled { break }
                await self?.refreshAll()
            }
        }
    }

    // MARK: Loading
    func refreshAll() async {
        guard user != nil else { return }
        await loadJobs()
        async let a: Void = loadMessages()
        async let b: Void = loadLocations()
        async let c: Void = loadPayments()
        async let d: Void = loadDismissals()
        _ = await (a, b, c, d)
        await loadReviews()
        updateSharing()
    }

    func loadJobs() async {
        do {
            let rows = try await api.select("jobs", Job.self, order: "created_at.desc")
            if api.session == nil { return }
            jobs = rows
        } catch let e as APIError where e.status == 401 && api.session == nil {
            logout()
        } catch {}
    }

    func loadMessages() async {
        if let rows = try? await api.select("messages", ChatMessage.self, order: "created_at.asc") { messages = rows }
    }

    func loadLocations() async {
        if let rows = try? await api.select("provider_locations", ProviderLocation.self) {
            locations = Dictionary(rows.map { ($0.jobId, $0) }, uniquingKeysWith: { _, b in b })
        }
    }

    func loadPaymentsMode() async {
        struct Row: Decodable { let value: String }
        let rows = try? await api.select("app_settings", Row.self, filters: [URLQueryItem(name: "key", value: "eq.payments_mode")])
        let v = rows?.first?.value
        paymentsMode = (v == "mock" || v == "live") ? v! : "off"
    }

    func loadPayments() async {
        guard paymentsMode != "off" else { return }
        if let rows = try? await api.select("payments", PaymentRow.self) {
            payments = Dictionary(rows.map { ($0.jobId, $0) }, uniquingKeysWith: { _, b in b })
        }
    }

    func loadDismissals() async {
        guard isDriver else { return }
        if let rows = try? await api.select("job_dismissals", DismissRow.self) { dismissed = Set(rows.map { $0.job_id }) }
    }

    func loadReviews() async {
        let phones = Set(jobs.flatMap { j -> [String] in
            var p = j.applicants.map { $0.phone }
            if let a = j.acceptedByPhone { p.append(a) }
            return p
        }).sorted()
        let key = phones.joined(separator: ",") + "|" + String(jobs.filter { $0.status == "done" }.count)
        guard key != ratingsKey else { return }
        ratingsKey = key
        if let rows = try? await api.select("reviews", Review.self) {
            reviews = Dictionary(rows.map { ($0.jobId, $0) }, uniquingKeysWith: { _, b in b })
        }
        if !phones.isEmpty,
           let data = try? await api.rpc("provider_ratings", ["p_phones": phones]),
           let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            var out: [String: Rating] = [:]
            for r in arr {
                guard let p = r["provider_phone"] as? String else { continue }
                out[p] = Rating(avg: Store.num(r["avg_rating"]), count: Int(Store.num(r["review_count"])))
            }
            ratings = out
        }
        if isDriver,
           let data = try? await api.rpc("provider_reviews", ["p_phone": myPhone, "p_limit": 20]),
           let list = try? JSONDecoder().decode([ProviderComment].self, from: data) {
            myComments = list
        }
    }

    private static func num(_ v: Any?) -> Double {
        if let d = v as? Double { return d }
        if let s = v as? String, let d = Double(s) { return d }
        return 0
    }

    // MARK: Derived
    func providerCanTake(_ j: Job) -> Bool {
        guard let u = user else { return false }
        if u.profiles.isEmpty { return true }
        switch j.service {
        case "junk", "moving", "goods", "deliver": return u.profiles.contains("driver")
        case "pro": return u.profiles.contains(j.cat ?? "")
        case "towing": return u.profiles.contains("towing")
        default: return false
        }
    }

    func unreadCount(jobId: String) -> Int {
        messages.filter { $0.jobId == jobId && $0.recipientPhone == myPhone && $0.readAt == nil }.count
    }
    func chat(jobId: String) -> [ChatMessage] { messages.filter { $0.jobId == jobId } }

    func name(ofPhone phone: String, in j: Job) -> String {
        j.applicants.first { $0.phone == phone }?.name ?? phone
    }

    // MARK: Customer actions
    func createJob(service: String, cat: String?, size: Int?, desc: String, addr: String, toAddr: String?, price: Int) async -> Bool {
        let info = Strings.shared.service(service)
        let needsCat = !(info?.categories.isEmpty ?? true)
        if (needsCat && cat == nil) || (info?.sizes.isEmpty == false && size == nil) { toast("toastMissingCatSize"); return false }
        if desc.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || addr.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            toast("toastMissingFields"); return false
        }
        guard price > 0 else { toast("toastInvalidOffer"); return false }
        var row: [String: Any] = [
            "service": service, "desc_text": desc, "addr": addr, "price": price, "status": "open",
            "owner_phone": myPhone, "applicants": [Any](), "created_at": Int64(Date().timeIntervalSince1970 * 1000),
        ]
        if let cat = cat { row["cat"] = cat }
        if let size = size { row["size"] = size }
        if let t = toAddr, info?.needsToAddr == true, !t.isEmpty { row["to_addr"] = t }
        do {
            try await api.insert("jobs", row)
            toast("toastSubmitted")
            await loadJobs()
            return true
        } catch { toast("toastSaveFailed"); return false }
    }

    func deleteJob(_ id: String) async {
        do { try await api.delete("jobs", id: id); toast("toastRequestDeleted"); await loadJobs() }
        catch { toast("toastSaveFailed") }
    }

    func assign(_ j: Job, to a: Applicant) async {
        if paymentsMode == "off" {
            await patch(j.id, ["status": "accepted", "accepted_by_phone": a.phone, "price": a.price], ok: "toastAssigned")
            return
        }
        if paymentsMode == "live" { toastRaw("Live payments are only supported on the web version."); return }
        do {
            let d = try await api.rpc("create_payment", ["p_job_id": j.id, "p_provider_phone": a.phone])
            let p = try JSONDecoder().decode(PaymentRow.self, from: d)
            payments[j.id] = p
            if p.status == "pending" {
                _ = try await api.rpc("mock_pay", ["p_payment_id": p.id, "p_success": true])
                toast("pay.toastPaid")
            }
            await refreshAll()
        } catch { toast("pay.toastError") }
    }

    /// Pays for a job that was assigned earlier but whose payment is missing (mock mode only).
    func payMock(_ j: Job) async {
        guard paymentsMode == "mock", let phone = j.acceptedByPhone else { return }
        do {
            let d = try await api.rpc("create_payment", ["p_job_id": j.id, "p_provider_phone": phone])
            let p = try JSONDecoder().decode(PaymentRow.self, from: d)
            if p.status == "pending" { _ = try await api.rpc("mock_pay", ["p_payment_id": p.id, "p_success": true]) }
            toast("pay.toastPaid")
            await refreshAll()
        } catch { toast("pay.toastError") }
    }

    func complete(_ j: Job) async {
        guard j.arrived || j.markedDoneByProvider else { return }
        await patch(j.id, ["status": "done", "payment_released": true,
                           "completed_at": Store.nowMs()], ok: "paymentReleasedNote")
    }

    func reportProblem(_ j: Job, text: String) async -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { toast("toastReportEmpty"); return false }
        await patch(j.id, ["problem_reported": true, "problem_text": t, "problem_reported_at": Store.nowMs()], ok: "toastProblemReported")
        return true
    }

    func submitReview(job: Job, rating: Int, comment: String) async -> Bool {
        let c = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            var args: [String: Any] = ["p_job_id": job.id, "p_rating": rating]
            args["p_comment"] = c.isEmpty ? NSNull() : String(c.prefix(500))
            _ = try await api.rpc("submit_review", args)
            toast("review.thanks")
            ratingsKey = ""
            await loadReviews()
            return true
        } catch { toast("review.failed"); return false }
    }

    // MARK: Provider actions
    func apply(_ j: Job, price: Int) async {
        guard price > 0, let u = user else { toast("toastInvalidOffer"); return }
        var list = j.applicants
        let entry = Applicant(phone: u.phone, name: u.name, price: price, appliedAt: Store.nowMs())
        if let i = list.firstIndex(where: { $0.phone == u.phone }) { list[i] = entry } else { list.append(entry) }
        let enc = list.map { a -> [String: Any] in
            var d: [String: Any] = ["phone": a.phone, "name": a.name, "price": a.price]
            if let t = a.appliedAt { d["appliedAt"] = t }
            return d
        }
        await patch(j.id, ["applicants": enc], ok: "toastApplied")
    }

    func arrive(_ j: Job) async {
        await patch(j.id, ["arrived": true, "arrived_at": Store.nowMs()], ok: "toastProviderArrived")
        sharing.drop(j.id)
    }

    func markDone(_ j: Job) async {
        await patch(j.id, ["marked_done_by_provider": true, "marked_done_at": Store.nowMs()], ok: "toastProviderMarkedDone")
    }

    func respond(_ j: Job, text: String) async -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { toast("toastResponseEmpty"); return false }
        await patch(j.id, ["provider_response": t, "provider_response_at": Store.nowMs()], ok: "toastResponseSent")
        return true
    }

    func dismiss(_ id: String) async {
        dismissed.insert(id)
        do { _ = try await api.rpc("dismiss_job", ["p_job_id": id]); toast("dismiss.toast") }
        catch { dismissed.remove(id); toast("dismiss.failed") }
    }

    func restore(_ id: String) async {
        dismissed.remove(id)
        do { _ = try await api.rpc("restore_job", ["p_job_id": id]) }
        catch { dismissed.insert(id); toast("dismiss.failed") }
    }

    // MARK: Chat
    func send(jobId: String, body: String) async -> Bool {
        let b = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !b.isEmpty else { return false }
        do { _ = try await api.rpc("send_message", ["p_job_id": jobId, "p_body": b]); await loadMessages(); return true }
        catch let e as APIError where e.message.lowercased().contains("many") || e.status == 429 { toast("chat.tooMany"); return false }
        catch { toast("chat.failed"); return false }
    }

    func markRead(jobId: String) async {
        guard unreadCount(jobId: jobId) > 0 else { return }
        _ = try? await api.rpc("mark_messages_read", ["p_job_id": jobId])
        await loadMessages()
    }

    // MARK: Location sharing (provider)
    private func updateSharing() {
        guard isDriver else { sharing.update(jobIds: []); return }
        let ids = jobs.filter { $0.status == "accepted" && $0.acceptedByPhone == myPhone && !$0.arrived }.map { $0.id }
        sharing.update(jobIds: Set(ids))
    }

    private func sendFix(jobId: String, lat: Double, lng: Double, accuracy: Double?) async -> Bool {
        var args: [String: Any] = ["p_job_id": jobId, "p_lat": lat, "p_lng": lng]
        args["p_accuracy"] = accuracy ?? NSNull()
        do { _ = try await api.rpc("share_location", args); return true } catch { return false }
    }

    // MARK: Internals
    private func patch(_ id: String, _ fields: [String: Any], ok: String) async {
        do { try await api.update("jobs", id: id, fields); toast(ok); await loadJobs(); updateSharing() }
        catch { toast("toastSaveFailed") }
    }

    static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
}

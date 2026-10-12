import Foundation
import SwiftUI
import AVFoundation
import AudioToolbox

private struct SignalRow: Decodable {
    let id: Int
    let jobId: String
    let from: String
    let callId: String
    let kind: String
    let payload: String?
    enum CodingKeys: String, CodingKey { case id, jobId = "job_id", from = "from_phone", callId = "call_id", kind, payload }
}

/// Voice calls between customer and assigned provider. Same signalling as the web app (table call_signals,
/// rpc send_call_signal, see diz_calls.sql), so iPhone and web users can call each other.
/// Like the web app, an incoming call can only ring while the app is open.
@MainActor
final class CallManager: ObservableObject {
    enum Phase { case calling, incoming, connecting, active }
    struct Active { let id: String; let jobId: String; let peer: String; var phase: Phase; let outgoing: Bool
        var muted = false; var speaker = false; var startedAt: Date? }

    @Published private(set) var current: Active?
    @Published var seconds = 0

    private weak var store: Store?
    private let engine = CallEngine()
    private var seen = Set<Int>()
    private var earlyIce: [String: [String]] = [:]
    private var pendingOffer: String?
    private var pendingIce: [String] = []
    private var pollTask: Task<Void, Never>?
    private var phaseTimer: Task<Void, Never>?
    private var clock: Task<Void, Never>?
    private var ringTask: Task<Void, Never>?
    private var sendTail: Task<Void, Never>?
    private var polling = false
    private let window = CallWindow()

    private static let handledKey = "diz_calls_handled"
    private var handled: [String] { UserDefaults.standard.stringArray(forKey: Self.handledKey) ?? [] }
    private func markHandled(_ id: String) { UserDefaults.standard.set(Array((handled + [id]).suffix(30)), forKey: Self.handledKey) }

    func attach(_ s: Store) {
        store = s
        engine.onEvent = { [weak self] e in self?.engineEvent(e) }
        window.manager = self
    }

    private func tr(_ k: String) -> String { store?.tr(k) ?? k }

    /// Who is on the other end of this job, if I am one of the two parties and the job is active.
    func peer(of j: Job) -> String? {
        guard let me = store?.myPhone, !me.isEmpty, j.status == "accepted", let acc = j.acceptedByPhone else { return nil }
        if j.ownerPhone == me { return acc }
        if acc == me { return j.ownerPhone }
        return nil
    }

    // MARK: Polling
    func start() {
        stop()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.fetch()
                let busy = self?.current != nil
                try? await Task.sleep(nanoseconds: busy ? 1_500_000_000 : 3_000_000_000)
            }
        }
    }

    func stop() {
        pollTask?.cancel(); pollTask = nil
        if current != nil { Task { await end(tell: false, missed: false) } }
        seen = []; earlyIce = [:]
    }

    private func fetch() async {
        guard let store = store, store.user != nil, !polling else { return }
        polling = true; defer { polling = false }
        guard let rows = try? await store.api.select("call_signals", SignalRow.self) else { return }
        let fresh = rows.filter { !seen.contains($0.id) }.sorted { $0.id < $1.id }
        for r in fresh { seen.insert(r.id); await handle(r) }
        let live = Set(rows.map { $0.id })
        seen = seen.filter { live.contains($0) }
    }

    private func handle(_ s: SignalRow) async {
        guard let store = store else { return }
        switch s.kind {
        case "offer":
            if handled.contains(s.callId) { return }
            if let c = current {
                if c.id != s.callId { _ = try? await store.api.rpc("send_call_signal", ["p_job_id": s.jobId, "p_call_id": s.callId, "p_kind": "end", "p_payload": "busy"]) }
                return
            }
            guard let j = store.jobs.first(where: { $0.id == s.jobId }), peer(of: j) == s.from else { return }
            current = Active(id: s.callId, jobId: s.jobId, peer: s.from, phase: .incoming, outgoing: false)
            pendingOffer = s.payload
            pendingIce = earlyIce.removeValue(forKey: s.callId) ?? []
            startRinging(vibrate: true)
            window.show()
            armTimer(45) { [weak self] in if self?.current?.phase == .incoming { await self?.end(tell: false, missed: false) } }
        case "ice":
            guard let p = s.payload else { return }
            if current?.id != s.callId {
                if !handled.contains(s.callId) {
                    earlyIce[s.callId] = Array(((earlyIce[s.callId] ?? []) + [p]).suffix(40))
                    if earlyIce.count > 10, let k = earlyIce.keys.first { earlyIce.removeValue(forKey: k) }
                }
                return
            }
            if current?.phase == .incoming { pendingIce.append(p) } else { engine.addIce(p) }
        case "answer":
            guard let c = current, c.id == s.callId, c.outgoing, let p = s.payload else { return }
            engine.setAnswer(p)
            setPhase(.connecting)
        case "end":
            guard let c = current, c.id == s.callId else { return }
            let busy = s.payload == "busy"
            cleanup()
            store.toast(busy ? "call.busy" : "call.ended")
        default: break
        }
    }

    // MARK: Actions
    func startCall(job: Job) {
        guard let store = store, let p = peer(of: job) else { return }
        if current != nil { store.toast("call.alreadyInCall"); return }
        let id = "c" + String(UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "").prefix(14))
        current = Active(id: id, jobId: job.id, peer: p, phase: .calling, outgoing: true)
        window.show()
        Task {
            guard await requestMic() else { store.toast("call.micDenied"); cleanup(); return }
            configureAudio()
            engine.start()
            armTimer(45) { [weak self] in
                if self?.current?.phase == .calling { self?.store?.toast("call.noAnswer"); await self?.end(tell: true, missed: true) }
            }
            startRinging(vibrate: false)
        }
    }

    func answer() {
        guard let c = current, c.phase == .incoming, let offer = pendingOffer else { return }
        stopRinging()
        Task {
            guard await requestMic() else { store?.toast("call.micDenied"); await end(tell: true, missed: false); return }
            configureAudio()
            engine.answer(offer: offer, earlyIce: pendingIce)
            pendingIce = []
            setPhase(.connecting)
        }
    }

    func decline() { Task { await end(tell: true, missed: false) } }
    func hangUp() { Task { await end(tell: true, missed: current?.phase == .calling) } }

    func toggleMute() {
        guard var c = current else { return }
        c.muted.toggle(); current = c
        engine.mute(c.muted)
    }

    func toggleSpeaker() {
        guard var c = current else { return }
        c.speaker.toggle(); current = c
        try? AVAudioSession.sharedInstance().overrideOutputAudioPort(c.speaker ? .speaker : .none)
    }

    // MARK: Engine events
    private func engineEvent(_ e: CallEngine.Event) {
        guard let c = current else { return }
        switch e {
        case .offer(let sdp): enqueue(c, "offer", sdp)
        case .answer(let sdp): enqueue(c, "answer", sdp)
        case .ice(let cand): enqueue(c, "ice", cand)
        case .state(let st):
            if st == "connected" { setPhase(.active) }
            else if st == "failed" || st == "closed" { store?.toast("call.failed"); Task { await end(tell: true, missed: false) } }
        case .error(let name):
            store?.toast(name == "NotAllowedError" || name == "SecurityError" ? "call.micDenied" : name == "NotFoundError" ? "call.noMic" : "call.failed")
            Task { await end(tell: true, missed: false) }
        }
    }

    /// Signals of one call are sent strictly one after the other (offer/answer before the candidates).
    private func enqueue(_ c: Active, _ kind: String, _ payload: String?) {
        guard let store = store else { return }
        let prev = sendTail
        sendTail = Task {
            await prev?.value
            var args: [String: Any] = ["p_job_id": c.jobId, "p_call_id": c.id, "p_kind": kind]
            args["p_payload"] = payload ?? NSNull()
            _ = try? await store.api.rpc("send_call_signal", args)
        }
    }

    private func setPhase(_ p: Phase) {
        guard var c = current else { return }
        c.phase = p
        if p == .connecting || p == .active { stopRinging() }
        if p == .active && c.startedAt == nil {
            c.startedAt = Date(); seconds = 0
            clock?.cancel()
            clock = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    if let s = self?.current?.startedAt { self?.seconds = Int(Date().timeIntervalSince(s)) }
                }
            }
        }
        current = c
        phaseTimer?.cancel(); phaseTimer = nil
        if p == .connecting {
            armTimer(20) { [weak self] in
                if self?.current?.phase == .connecting { self?.store?.toast("call.failed"); await self?.end(tell: true, missed: false) }
            }
        }
    }

    private func armTimer(_ secs: UInt64, _ fn: @escaping () async -> Void) {
        phaseTimer?.cancel()
        phaseTimer = Task { try? await Task.sleep(nanoseconds: secs * 1_000_000_000); if !Task.isCancelled { await fn() } }
    }

    /// Ends the call. `tell`: notify the other side. `missed`: the caller gave up before an answer (a chat note is left).
    private func end(tell: Bool, missed: Bool) async {
        guard let c = current, let store = store else { return }
        let secs = c.startedAt.map { Int(Date().timeIntervalSince($0)) } ?? 0
        cleanup()
        if tell {
            enqueue(c, "end", nil)
            await sendTail?.value
        }
        if c.outgoing && (secs > 0 || missed) {
            let text = secs > 0 ? store.tr("call.chatLog", ["t": String(format: "%d:%02d", secs / 60, secs % 60)]) : store.tr("call.chatMissed")
            _ = try? await store.api.rpc("send_message", ["p_job_id": c.jobId, "p_body": text])
            await store.loadMessages()
        }
    }

    private func cleanup() {
        if let c = current { markHandled(c.id) }
        phaseTimer?.cancel(); phaseTimer = nil
        clock?.cancel(); clock = nil
        stopRinging()
        engine.close()
        pendingOffer = nil; pendingIce = []
        current = nil; seconds = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        window.hide()
    }

    // MARK: Audio
    private func requestMic() async -> Bool {
        await withCheckedContinuation { cont in AVAudioSession.sharedInstance().requestRecordPermission { cont.resume(returning: $0) } }
    }
    private func configureAudio() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
        try? s.setActive(true)
    }
    private func startRinging(vibrate: Bool) {
        stopRinging()
        ringTask = Task {
            while !Task.isCancelled {
                AudioServicesPlaySystemSound(1005)
                if vibrate { AudioServicesPlaySystemSound(kSystemSoundID_Vibrate) }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }
    private func stopRinging() { ringTask?.cancel(); ringTask = nil }

    func peerLabel(_ c: Active) -> String {
        guard let store = store else { return "" }
        let j = store.jobs.first { $0.id == c.jobId }
        return store.tr(j?.ownerPhone == c.peer ? "chat.customer" : "chat.provider")
    }
}

// MARK: - Call panel in its own window, so it shows above sheets (the chat) and screen changes never interrupt a call.

@MainActor
final class CallWindow {
    weak var manager: CallManager?
    private var win: UIWindow?

    func show() {
        guard win == nil, let m = manager, let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        let w = UIWindow(windowScene: scene)
        w.windowLevel = .alert + 1
        let host = UIHostingController(rootView: CallPanel().environmentObject(m).environmentObject(m.storeForUI))
        host.view.backgroundColor = .clear
        w.rootViewController = host
        w.makeKeyAndVisible()
        win = w
    }
    func hide() { win?.isHidden = true; win = nil }
}

extension CallManager { var storeForUI: Store { store! } }

struct CallPanel: View {
    @EnvironmentObject var m: CallManager
    @EnvironmentObject var store: Store

    var body: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
            if let c = m.current {
                VStack(spacing: 14) {
                    Text("📞 " + store.tr("call.title") + " · " + m.peerLabel(c)).font(.headline).foregroundColor(.white)
                    Text(status(c)).font(.title2.monospacedDigit()).foregroundColor(.white)
                    HStack(spacing: 12) {
                        if c.phase == .incoming {
                            button("📞 " + store.tr("call.answer"), .green) { m.answer() }
                            button("✖ " + store.tr("call.decline"), .red) { m.decline() }
                        } else {
                            if c.phase == .active {
                                button((c.muted ? "🔇 " : "🎙️ ") + store.tr(c.muted ? "call.unmute" : "call.mute"), .gray) { m.toggleMute() }
                                button((c.speaker ? "🔊 " : "🔈 ") + store.tr("call.speaker"), .gray) { m.toggleSpeaker() }
                            }
                            button(store.tr("call.hangUp"), .red) { m.hangUp() }
                        }
                    }
                    Text(store.tr("call.ipNote")).font(.caption2).multilineTextAlignment(.center).foregroundColor(.white.opacity(0.7))
                }
                .padding(20)
                .frame(maxWidth: 360)
                .background(Color.dizBrand)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .padding(24)
            }
        }
        .environment(\.layoutDirection, store.lang.isRTL ? .rightToLeft : .leftToRight)
    }

    private func status(_ c: CallManager.Active) -> String {
        switch c.phase {
        case .calling: return store.tr("call.calling")
        case .incoming: return store.tr("call.incoming")
        case .connecting: return store.tr("call.connecting")
        case .active: return String(format: "%d:%02d", m.seconds / 60, m.seconds % 60)
        }
    }
    private func button(_ title: String, _ color: Color, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title).font(.subheadline.bold()).padding(.horizontal, 12).padding(.vertical, 10).background(color).foregroundColor(.white).clipShape(Capsule()) }
    }
}

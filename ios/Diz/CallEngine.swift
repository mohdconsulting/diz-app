import Foundation
import WebKit
import AVFoundation

/// WebRTC for the calls. Instead of a large native WebRTC binary, the audio connection is run by WebKit's own WebRTC
/// inside a hidden web view. This is the same engine and the same signalling format as the web app (src/call.ts), so
/// iPhone and web users can call each other. Swift owns the call logic (CallManager); the page below only
/// creates the connection and reports offers, answers, ICE candidates and connection state back.
@MainActor
final class CallEngine: NSObject, WKScriptMessageHandler, WKUIDelegate {
    enum Event { case offer(String), answer(String), ice(String), state(String), error(String) }
    var onEvent: ((Event) -> Void)?

    private var web: WKWebView?
    private var ready = false
    private var queued: [String] = []

    private static let html = """
    <!doctype html><html><body><audio id="a" autoplay playsinline></audio><script>
    const post = o => window.webkit.messageHandlers.dz.postMessage(o);
    let pc = null, local = null, pend = [], remoteSet = false;
    async function build() {
      local = await navigator.mediaDevices.getUserMedia({ audio: true });
      pc = new RTCPeerConnection({ iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] });
      remoteSet = false; pend = [];
      local.getTracks().forEach(t => pc.addTrack(t, local));
      pc.onicecandidate = e => { if (e.candidate) post({ t: 'ice', p: JSON.stringify(e.candidate) }); };
      pc.ontrack = e => { const a = document.getElementById('a'); a.srcObject = e.streams[0]; a.play().catch(() => {}); };
      pc.onconnectionstatechange = () => post({ t: 'state', p: pc.connectionState });
    }
    async function flush() { for (const c of pend.splice(0)) { try { await pc.addIceCandidate(JSON.parse(c)); } catch (e) {} } }
    const fail = e => post({ t: 'error', p: (e && e.name) ? e.name : String(e) });
    window.dz = {
      start: async () => { try { await build(); const o = await pc.createOffer(); await pc.setLocalDescription(o);
        post({ t: 'offer', p: JSON.stringify(pc.localDescription) }); } catch (e) { fail(e); } },
      answer: async (offer, early) => { try { await build(); await pc.setRemoteDescription(JSON.parse(offer)); remoteSet = true;
        pend = early.slice(); await flush();
        const a = await pc.createAnswer(); await pc.setLocalDescription(a);
        post({ t: 'answer', p: JSON.stringify(pc.localDescription) }); } catch (e) { fail(e); } },
      setAnswer: async (ans) => { try { await pc.setRemoteDescription(JSON.parse(ans)); remoteSet = true; await flush(); } catch (e) { fail(e); } },
      addIce: async (c) => { if (pc && remoteSet) { try { await pc.addIceCandidate(JSON.parse(c)); } catch (e) {} } else { pend.push(c); } },
      mute: (m) => { if (local) local.getAudioTracks().forEach(t => { t.enabled = !m; }); },
      close: () => { try { if (pc) pc.close(); } catch (e) {} if (local) local.getTracks().forEach(t => t.stop());
        pc = null; local = null; pend = []; remoteSet = false; const a = document.getElementById('a'); a.srcObject = null; }
    };
    post({ t: 'ready' });
    </script></body></html>
    """

    func prepare() {
        guard web == nil else { return }
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        let uc = WKUserContentController()
        uc.add(self, name: "dz")
        cfg.userContentController = uc
        let w = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: cfg)
        w.uiDelegate = self
        w.isOpaque = false
        w.alpha = 0.01
        w.isUserInteractionEnabled = false
        // WebRTC needs a secure origin; the page is loaded under an https base URL (nothing is fetched from it).
        w.loadHTMLString(Self.html, baseURL: URL(string: "https://diz-app.local/"))
        web = w
        // must be in a window to be allowed to capture the microphone and play audio
        if let win = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.windows.first }).first {
            win.addSubview(w)
        }
    }

    func call(_ js: String) {
        prepare()
        if ready { web?.evaluateJavaScript(js, completionHandler: nil) } else { queued.append(js) }
    }

    private func lit(_ s: String) -> String {   // JSON string literal
        let d = try? JSONSerialization.data(withJSONObject: [s], options: [])
        let a = String(data: d ?? Data("[\"\"]".utf8), encoding: .utf8) ?? "[\"\"]"
        return String(a.dropFirst().dropLast())
    }
    func start() { call("dz.start()") }
    func answer(offer: String, earlyIce: [String]) {
        let arr = "[" + earlyIce.map(lit).joined(separator: ",") + "]"
        call("dz.answer(\(lit(offer)), \(arr))")
    }
    func setAnswer(_ s: String) { call("dz.setAnswer(\(lit(s)))") }
    func addIce(_ s: String) { call("dz.addIce(\(lit(s)))") }
    func mute(_ m: Bool) { call("dz.mute(\(m ? "true" : "false"))") }
    func close() { call("dz.close()") }

    // MARK: WKScriptMessageHandler / WKUIDelegate
    nonisolated func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let d = m.body as? [String: Any], let t = d["t"] as? String else { return }
        let p = d["p"] as? String ?? ""
        Task { @MainActor in
            switch t {
            case "ready": self.ready = true; let q = self.queued; self.queued = []; q.forEach { self.web?.evaluateJavaScript($0, completionHandler: nil) }
            case "offer": self.onEvent?(.offer(p))
            case "answer": self.onEvent?(.answer(p))
            case "ice": self.onEvent?(.ice(p))
            case "state": self.onEvent?(.state(p))
            case "error": self.onEvent?(.error(p))
            default: break
            }
        }
    }

    nonisolated func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                             initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                             decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)   // the real permission prompt is iOS's own microphone dialog
    }
}

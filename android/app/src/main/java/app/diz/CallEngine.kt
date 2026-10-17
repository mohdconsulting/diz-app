package app.diz

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject

/** WebRTC for the calls. The audio connection is run by Android System WebView's own WebRTC inside a hidden web view.
 *  It is the same engine and the same signalling format as the web app (src/call.ts) and the iPhone app, so Android,
 *  iPhone and web users can call each other. Kotlin owns the call logic (CallManager); the page below only creates the
 *  connection and reports offers, answers, ICE candidates and connection state back. */
class CallEngine {
    sealed class Event {
        data class Offer(val sdp: String) : Event()
        data class Answer(val sdp: String) : Event()
        data class Ice(val candidate: String) : Event()
        data class State(val state: String) : Event()
        data class Error(val name: String) : Event()
    }

    var onEvent: ((Event) -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())
    private var web: WebView? = null
    private var ready = false
    private val queued = mutableListOf<String>()

    /** Creates the hidden web view inside the activity. Call once from MainActivity.onCreate. */
    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    fun attachTo(activity: Activity) {
        if (web != null) return
        val w = WebView(activity)
        w.settings.javaScriptEnabled = true
        w.settings.domStorageEnabled = true
        w.settings.mediaPlaybackRequiresUserGesture = false
        w.alpha = 0.01f
        w.isEnabled = false
        w.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                // the real permission prompt is Android's own microphone dialog (requested before a call starts)
                main.post { request.grant(request.resources) }
            }
        }
        w.addJavascriptInterface(object {
            @JavascriptInterface
            fun post(json: String) { main.post { handle(json) } }
        }, "DzBridge")
        activity.addContentView(w, FrameLayout.LayoutParams(1, 1))
        // WebRTC needs a secure origin; the page is loaded under an https base URL (nothing is fetched from it).
        w.loadDataWithBaseURL("https://diz-app.local/", HTML, "text/html", "utf-8", null)
        web = w
    }

    private fun handle(json: String) {
        val o = try { JSONObject(json) } catch (e: Exception) { return }
        val p = o.optString("p", "")
        when (o.optString("t")) {
            "ready" -> { ready = true; val q = queued.toList(); queued.clear(); q.forEach { run(it) } }
            "offer" -> onEvent?.invoke(Event.Offer(p))
            "answer" -> onEvent?.invoke(Event.Answer(p))
            "ice" -> onEvent?.invoke(Event.Ice(p))
            "state" -> onEvent?.invoke(Event.State(p))
            "error" -> onEvent?.invoke(Event.Error(p))
        }
    }

    private fun run(js: String) { web?.evaluateJavascript(js, null) }
    private fun call(js: String) { if (ready) run(js) else queued.add(js) }
    private fun lit(s: String): String = JSONObject.quote(s)

    fun start() = call("dz.start()")
    fun answer(offer: String, earlyIce: List<String>) =
        call("dz.answer(${lit(offer)}, ${JSONArray(earlyIce)})")
    fun setAnswer(s: String) = call("dz.setAnswer(${lit(s)})")
    fun addIce(s: String) = call("dz.addIce(${lit(s)})")
    fun mute(m: Boolean) = call("dz.mute($m)")
    fun close() = call("dz.close()")

    companion object {
        private const val HTML = """<!doctype html><html><body><audio id="a" autoplay playsinline></audio><script>
const post = o => DzBridge.post(JSON.stringify(o));
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
</script></body></html>"""
    }
}

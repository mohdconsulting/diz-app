package app.diz

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job as CoJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

enum class CallPhase { CALLING, INCOMING, CONNECTING, ACTIVE }

data class ActiveCall(
    val id: String, val jobId: String, val peer: String, val phase: CallPhase, val outgoing: Boolean,
    val muted: Boolean = false, val speaker: Boolean = false, val startedAt: Long? = null,
)

/** Voice calls between customer and assigned provider. Same signalling as the web and iPhone apps (table call_signals,
 *  rpc send_call_signal, see diz_calls.sql), so all three can call each other. As on the web, an incoming call can only
 *  ring while the app is open. */
class CallManager(private val store: Store, private val context: Context, private val scope: CoroutineScope) {
    var current by mutableStateOf<ActiveCall?>(null)
        private set
    var seconds by mutableIntStateOf(0)
        private set

    val engine = CallEngine()
    /** Set by the activity: shows the microphone permission dialog and reports the result. */
    var micRequester: ((Boolean) -> Unit) -> Unit = { it(false) }

    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val prefs = context.getSharedPreferences("diz", Context.MODE_PRIVATE)
    private var seen = mutableSetOf<Long>()
    private val earlyIce = LinkedHashMap<String, List<String>>()
    private var pendingOffer: String? = null
    private var pendingIce = mutableListOf<String>()
    private var pollJob: CoJob? = null
    private var phaseTimer: CoJob? = null
    private var clock: CoJob? = null
    private var ringJob: CoJob? = null
    private var sendTail: CoJob? = null
    private var polling = false

    private data class Sig(val id: Long, val jobId: String, val from: String, val callId: String, val kind: String, val payload: String?)

    init { engine.onEvent = { engineEvent(it) } }

    private fun handled(): List<String> = (prefs.getString("calls_handled", "") ?: "").split(",").filter { it.isNotEmpty() }
    private fun markHandled(id: String) { prefs.edit().putString("calls_handled", (handled() + id).takeLast(30).joinToString(",")).apply() }

    /** Who is on the other end of this job, if I am one of the two parties and the job is active. */
    fun peerOf(j: app.diz.Job): String? {
        val me = store.myPhone
        val acc = j.acceptedByPhone
        if (me.isEmpty() || j.status != "accepted" || acc == null) return null
        if (j.ownerPhone == me) return acc
        if (acc == me) return j.ownerPhone
        return null
    }

    // ---- polling ----
    fun start() {
        stop()
        pollJob = scope.launch {
            while (isActive) {
                fetch()
                delay(if (current != null) 1500 else 3000)
            }
        }
    }

    fun stop() {
        pollJob?.cancel(); pollJob = null
        if (current != null) scope.launch { end(tell = false, missed = false) }
        seen = mutableSetOf(); earlyIce.clear()
    }

    private suspend fun fetch() {
        if (store.user == null || polling) return
        polling = true
        try {
            val rows = try { store.api.select("call_signals") } catch (e: Exception) { return }
            val all = rows.map { Sig(it.getLong("id"), it.getString("job_id"), it.optString("from_phone"), it.optString("call_id"), it.optString("kind"), it.str("payload")) }
            for (s in all.filter { it.id !in seen }.sortedBy { it.id }) { seen.add(s.id); handle(s) }
            val live = all.map { it.id }.toSet()
            seen = seen.filter { it in live }.toMutableSet()
        } finally { polling = false }
    }

    private suspend fun handle(s: Sig) {
        when (s.kind) {
            "offer" -> {
                if (s.callId in handled()) return
                val c = current
                if (c != null) {
                    if (c.id != s.callId) runCatching { store.api.rpc("send_call_signal", mapOf("p_job_id" to s.jobId, "p_call_id" to s.callId, "p_kind" to "end", "p_payload" to "busy")) }
                    return
                }
                val j = store.jobs.firstOrNull { it.id == s.jobId } ?: return
                if (peerOf(j) != s.from) return
                current = ActiveCall(s.callId, s.jobId, s.from, CallPhase.INCOMING, outgoing = false)
                pendingOffer = s.payload
                pendingIce = (earlyIce.remove(s.callId) ?: emptyList()).toMutableList()
                startRinging(vibrate = true)
                armTimer(45) { if (current?.phase == CallPhase.INCOMING) end(tell = false, missed = false) }
            }
            "ice" -> {
                val p = s.payload ?: return
                val c = current
                if (c == null || c.id != s.callId) {
                    if (s.callId !in handled()) {
                        earlyIce[s.callId] = ((earlyIce[s.callId] ?: emptyList()) + p).takeLast(40)
                        if (earlyIce.size > 10) earlyIce.remove(earlyIce.keys.first())
                    }
                    return
                }
                if (c.phase == CallPhase.INCOMING) pendingIce.add(p) else engine.addIce(p)
            }
            "answer" -> {
                val c = current ?: return
                val p = s.payload ?: return
                if (c.id != s.callId || !c.outgoing) return
                engine.setAnswer(p)
                setPhase(CallPhase.CONNECTING)
            }
            "end" -> {
                val c = current ?: return
                if (c.id != s.callId) return
                val busy = s.payload == "busy"
                cleanup()
                store.toast(if (busy) "call.busy" else "call.ended")
            }
        }
    }

    // ---- actions ----
    fun startCall(job: app.diz.Job) {
        val p = peerOf(job) ?: return
        if (current != null) { store.toast("call.alreadyInCall"); return }
        val id = "c" + java.util.UUID.randomUUID().toString().replace("-", "").take(14)
        current = ActiveCall(id, job.id, p, CallPhase.CALLING, outgoing = true)
        scope.launch {
            if (!requestMic()) { store.toast("call.micDenied"); cleanup(); return@launch }
            configureAudio()
            engine.start()
            armTimer(45) { if (current?.phase == CallPhase.CALLING) { store.toast("call.noAnswer"); end(tell = true, missed = true) } }
            startRinging(vibrate = false)
        }
    }

    fun answer() {
        val c = current ?: return
        val offer = pendingOffer ?: return
        if (c.phase != CallPhase.INCOMING) return
        stopRinging()
        scope.launch {
            if (!requestMic()) { store.toast("call.micDenied"); end(tell = true, missed = false); return@launch }
            configureAudio()
            engine.answer(offer, pendingIce.toList())
            pendingIce = mutableListOf()
            setPhase(CallPhase.CONNECTING)
        }
    }

    fun decline() { scope.launch { end(tell = true, missed = false) } }
    fun hangUp() { scope.launch { end(tell = true, missed = current?.phase == CallPhase.CALLING) } }

    fun toggleMute() {
        val c = current ?: return
        current = c.copy(muted = !c.muted)
        engine.mute(!c.muted)
    }

    @Suppress("DEPRECATION")
    fun toggleSpeaker() {
        val c = current ?: return
        current = c.copy(speaker = !c.speaker)
        audio.isSpeakerphoneOn = !c.speaker
    }

    // ---- engine events ----
    private fun engineEvent(e: CallEngine.Event) {
        val c = current ?: return
        when (e) {
            is CallEngine.Event.Offer -> enqueue(c, "offer", e.sdp)
            is CallEngine.Event.Answer -> enqueue(c, "answer", e.sdp)
            is CallEngine.Event.Ice -> enqueue(c, "ice", e.candidate)
            is CallEngine.Event.State -> {
                if (e.state == "connected") setPhase(CallPhase.ACTIVE)
                else if (e.state == "failed" || e.state == "closed") { store.toast("call.failed"); scope.launch { end(tell = true, missed = false) } }
            }
            is CallEngine.Event.Error -> {
                store.toast(if (e.name == "NotAllowedError" || e.name == "SecurityError") "call.micDenied" else if (e.name == "NotFoundError") "call.noMic" else "call.failed")
                scope.launch { end(tell = true, missed = false) }
            }
        }
    }

    /** Signals of one call are sent strictly one after the other (offer/answer before the candidates). */
    private fun enqueue(c: ActiveCall, kind: String, payload: String?) {
        val prev = sendTail
        sendTail = scope.launch {
            prev?.join()
            runCatching { store.api.rpc("send_call_signal", mapOf("p_job_id" to c.jobId, "p_call_id" to c.id, "p_kind" to kind, "p_payload" to payload)) }
        }
    }

    private fun setPhase(p: CallPhase) {
        var c = current ?: return
        c = c.copy(phase = p)
        if (p == CallPhase.CONNECTING || p == CallPhase.ACTIVE) stopRinging()
        if (p == CallPhase.ACTIVE && c.startedAt == null) {
            c = c.copy(startedAt = System.currentTimeMillis()); seconds = 0
            clock?.cancel()
            clock = scope.launch {
                while (isActive) {
                    delay(1000)
                    current?.startedAt?.let { seconds = ((System.currentTimeMillis() - it) / 1000).toInt() }
                }
            }
        }
        current = c
        phaseTimer?.cancel(); phaseTimer = null
        if (p == CallPhase.CONNECTING) {
            armTimer(20) { if (current?.phase == CallPhase.CONNECTING) { store.toast("call.failed"); end(tell = true, missed = false) } }
        }
    }

    private fun armTimer(secs: Long, fn: suspend () -> Unit) {
        phaseTimer?.cancel()
        phaseTimer = scope.launch { delay(secs * 1000); fn() }
    }

    /** Ends the call. [tell]: notify the other side. [missed]: the caller gave up before an answer (a chat note is left). */
    private suspend fun end(tell: Boolean, missed: Boolean) {
        val c = current ?: return
        val secs = c.startedAt?.let { ((System.currentTimeMillis() - it) / 1000).toInt() } ?: 0
        cleanup()
        if (tell) { enqueue(c, "end", null); sendTail?.join() }
        if (c.outgoing && (secs > 0 || missed)) {
            val text = if (secs > 0) store.tr("call.chatLog", mapOf("t" to "%d:%02d".format(secs / 60, secs % 60))) else store.tr("call.chatMissed")
            runCatching { store.api.rpc("send_message", mapOf("p_job_id" to c.jobId, "p_body" to text)) }
            store.loadMessages()
        }
    }

    @Suppress("DEPRECATION")
    private fun cleanup() {
        current?.let { markHandled(it.id) }
        phaseTimer?.cancel(); phaseTimer = null
        clock?.cancel(); clock = null
        stopRinging()
        engine.close()
        pendingOffer = null; pendingIce = mutableListOf()
        current = null; seconds = 0
        audio.isSpeakerphoneOn = false
        audio.mode = AudioManager.MODE_NORMAL
    }

    // ---- audio ----
    private suspend fun requestMic(): Boolean {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) return true
        return suspendCancellableCoroutine { cont -> micRequester { ok -> if (cont.isActive) cont.resume(ok) } }
    }

    private fun configureAudio() { audio.mode = AudioManager.MODE_IN_COMMUNICATION }

    @Suppress("DEPRECATION")
    private fun startRinging(vibrate: Boolean) {
        stopRinging()
        ringJob = scope.launch {
            val tone = runCatching { ToneGenerator(AudioManager.STREAM_MUSIC, 70) }.getOrNull()
            try {
                while (isActive) {
                    tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 400)
                    if (vibrate) runCatching {
                        val v = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                        if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(400, VibrationEffect.DEFAULT_AMPLITUDE)) else v.vibrate(400)
                    }
                    delay(2000)
                }
            } finally { tone?.release() }
        }
    }
    private fun stopRinging() { ringJob?.cancel(); ringJob = null }

    fun peerLabel(c: ActiveCall): String {
        val j = store.jobs.firstOrNull { it.id == c.jobId }
        return store.tr(if (j?.ownerPhone == c.peer) "chat.customer" else "chat.provider")
    }
}

package app.diz

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job as CoJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** All app state plus every action. Mirrors what the src/ files does in the web app and Store.swift in the iPhone app. */
class Store(app: Application) : AndroidViewModel(app) {
    // ---- observable state ----
    var lang by mutableStateOf(Lang.AR)
        private set
    var user by mutableStateOf<AppUser?>(null)
        private set
    var jobs by mutableStateOf<List<Job>>(emptyList())
        private set
    var messages by mutableStateOf<List<ChatMessage>>(emptyList())
        private set
    var locations by mutableStateOf<Map<String, ProviderLocation>>(emptyMap())
        private set
    var dismissed by mutableStateOf<Set<String>>(emptySet())
        private set
    var reviews by mutableStateOf<Map<String, Review>>(emptyMap())
        private set
    var ratings by mutableStateOf<Map<String, Rating>>(emptyMap())
        private set
    var myComments by mutableStateOf<List<ProviderComment>>(emptyList())
        private set
    var toastText by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var restoring by mutableStateOf(true)
        private set
    var locationDenied by mutableStateOf(false)
        private set
    /** The job whose chat is open (full-screen), or null. */
    var chatJobId by mutableStateOf<String?>(null)

    val api = Api(app)
    val sharing = LocationSharing(app)
    val calls = CallManager(this, app, viewModelScope)
    private val prefs = app.getSharedPreferences("diz", android.content.Context.MODE_PRIVATE)
    private var pollJob: CoJob? = null
    private var toastJob: CoJob? = null
    private var ratingsKey = ""

    init {
        Strings.init(app)
        lang = Lang.from(prefs.getString("lang", null))
        sharing.launch = { block -> viewModelScope.launch { block() } }
        sharing.onFix = { id, lat, lng, acc -> sendFix(id, lat, lng, acc) }
        sharing.onDenied = { locationDenied = it }
        viewModelScope.launch { restore() }
    }

    // ---- helpers ----
    fun tr(key: String, vars: Map<String, String> = emptyMap()): String = Strings.text(key, lang, vars)
    fun money(n: Int): String = "$n " + tr("priceUnit")
    fun toast(key: String, vars: Map<String, String> = emptyMap()) = toastRaw(tr(key, vars))
    fun toastRaw(s: String) {
        toastText = s
        toastJob?.cancel()
        toastJob = viewModelScope.launch { delay(3000); toastText = null }
    }
    fun changeLang(l: Lang) { lang = l; prefs.edit().putString("lang", l.code).apply() }

    val isDriver: Boolean get() = user?.isDriver ?: false
    val myPhone: String get() = user?.phone ?: ""

    // ---- session lifecycle ----
    private suspend fun restore() {
        try {
            if (api.session == null) return
            if (!api.refreshIfNeeded()) return
            val s = api.session ?: return
            val u = fetchUser(s.userId, 1)
            if (u != null) { user = u; afterSignIn() } else if (api.session == null) user = null
        } finally { restoring = false }
    }

    private suspend fun fetchUser(id: String, retries: Int): AppUser? {
        for (i in 0 until maxOf(1, retries)) {
            val rows = try { api.select("users", listOf("id" to "eq.$id")) } catch (e: Exception) { emptyList() }
            rows.firstOrNull()?.let { return AppUser.from(it) }
            if (i < retries - 1) delay(500)
        }
        return null
    }

    fun login(phone: String, password: String) {
        val email = Config.authEmail(phone)
        if (email.isEmpty() || password.isEmpty()) { toast("toastAuthMissingFields"); return }
        viewModelScope.launch {
            busy = true
            try {
                api.signIn(email, password)
                val s = api.session
                val u = if (s != null) fetchUser(s.userId, 4) else null
                if (u == null) { toast("toastDbUnavailable"); return@launch }
                user = u
                toast("toastLoginSuccess")
                afterSignIn()
            } catch (e: ApiError) {
                if (e.status == 400 || e.status == 401) toast("toastAuthLoginFailed") else toast("toastDbUnavailable")
            } catch (e: Exception) { toast("toastDbUnavailable") }
            finally { busy = false }
        }
    }

    fun register(name: String, phone: String, password: String, role: String, profiles: List<String>) {
        val email = Config.authEmail(phone)
        if (name.isBlank() || email.isEmpty() || password.isEmpty()) { toast("toastAuthMissingFields"); return }
        if (password.length < 6) { toast("toastPasswordShort"); return }
        if (role == "driver" && profiles.isEmpty()) { toast("toastAuthMissingProfiles"); return }
        viewModelScope.launch {
            busy = true
            try {
                val meta = mapOf("name" to name.trim(), "phone" to phone, "role" to role, "profiles" to if (role == "driver") profiles else emptyList<String>())
                val s = api.signUp(email, password, meta)
                if (s == null) { toast("toastAuthNeedsConfirm"); return@launch }
                val u = fetchUser(s.userId, 6)
                if (u == null) { toast("toastDbUnavailable"); return@launch }
                user = u
                toast("toastRegisterSuccess")
                afterSignIn()
            } catch (e: ApiError) {
                val m = e.message.lowercase()
                if (m.contains("already") || m.contains("registered")) toast("toastAuthPhoneTaken") else toastRaw(e.message)
            } catch (e: Exception) { toast("toastDbUnavailable") }
            finally { busy = false }
        }
    }

    fun logout() {
        pollJob?.cancel(); pollJob = null
        calls.stop()
        sharing.stop()
        api.clearSession()
        user = null; jobs = emptyList(); messages = emptyList(); locations = emptyMap(); dismissed = emptySet()
        reviews = emptyMap(); ratings = emptyMap(); myComments = emptyList(); ratingsKey = ""
    }

    private suspend fun afterSignIn() {
        refreshAll()
        calls.start()
        pollJob?.cancel()
        pollJob = viewModelScope.launch {
            while (isActive) {
                delay(Config.POLL_SECONDS * 1000)
                refreshAll()
            }
        }
    }

    // ---- loading ----
    suspend fun refreshAll() {
        if (user == null) return
        loadJobs(); loadMessages(); loadLocations(); loadDismissals(); loadReviews()
        updateSharing()
    }

    fun refresh() { viewModelScope.launch { refreshAll() } }

    suspend fun loadJobs() {
        try {
            val rows = api.select("jobs", order = "created_at.desc")
            if (api.session == null) return
            jobs = rows.map { Job.from(it) }
        } catch (e: ApiError) {
            if (e.status == 401 && api.session == null) logout()
        } catch (e: Exception) { /* offline: keep the old list */ }
    }

    suspend fun loadMessages() {
        try { messages = api.select("messages", order = "created_at.asc").map { ChatMessage.from(it) } } catch (e: Exception) { }
    }

    private suspend fun loadLocations() {
        try { locations = api.select("provider_locations").map { ProviderLocation.from(it) }.associateBy { it.jobId } } catch (e: Exception) { }
    }

    private suspend fun loadDismissals() {
        if (!isDriver) return
        try { dismissed = api.select("job_dismissals").map { it.getString("job_id") }.toSet() } catch (e: Exception) { }
    }

    private suspend fun loadReviews() {
        val phones = jobs.flatMap { j -> j.applicants.map { it.phone } + listOfNotNull(j.acceptedByPhone) }.toSortedSet().toList()
        val key = phones.joinToString(",") + "|" + jobs.count { it.status == "done" }
        if (key == ratingsKey) return
        ratingsKey = key
        try { reviews = api.select("reviews").map { Review.from(it) }.associateBy { it.jobId } } catch (e: Exception) { }
        if (phones.isNotEmpty()) {
            try {
                val arr = JSONArray(api.rpc("provider_ratings", mapOf("p_phones" to phones)))
                ratings = arr.objects().mapNotNull { r ->
                    val p = r.str("provider_phone") ?: return@mapNotNull null
                    p to Rating(num(r, "avg_rating"), num(r, "review_count").toInt())
                }.toMap()
            } catch (e: Exception) { }
        }
        if (isDriver) {
            try { myComments = JSONArray(api.rpc("provider_reviews", mapOf("p_phone" to myPhone, "p_limit" to 20))).objects().map { ProviderComment.from(it) } }
            catch (e: Exception) { }
        }
    }

    private fun num(o: JSONObject, key: String): Double {
        if (o.isNull(key)) return 0.0
        return when (val v = o.opt(key)) { is Number -> v.toDouble(); is String -> v.toDoubleOrNull() ?: 0.0; else -> 0.0 }
    }

    // ---- derived ----
    fun providerCanTake(j: Job): Boolean {
        val u = user ?: return false
        if (u.profiles.isEmpty()) return true
        return when (j.service) {
            "junk", "moving", "goods", "deliver" -> "driver" in u.profiles
            "pro" -> (j.cat ?: "") in u.profiles
            "towing" -> "towing" in u.profiles
            else -> false
        }
    }

    fun unreadCount(jobId: String): Int = messages.count { it.jobId == jobId && it.recipientPhone == myPhone && it.readAt == null }
    fun chat(jobId: String): List<ChatMessage> = messages.filter { it.jobId == jobId }
    fun nameOf(phone: String, j: Job): String = j.applicants.firstOrNull { it.phone == phone }?.name ?: phone

    // ---- customer actions ----
    suspend fun createJob(service: String, cat: String?, size: Int?, desc: String, addr: String, toAddr: String?, price: Int, schedule: ScheduleChoice): Boolean {
        val info = Strings.service(service)
        val needsCat = info?.categories?.isNotEmpty() == true
        if ((needsCat && cat == null) || (info?.sizes?.isNotEmpty() == true && size == null)) { toast("toastMissingCatSize"); return false }
        if (desc.isBlank() || addr.isBlank()) { toast("toastMissingFields"); return false }
        if (price <= 0) { toast("toastInvalidOffer"); return false }
        if (!schedule.asap && schedule.selection.isEmpty) { toast("sched.chooseTime"); return false }
        val row = mutableMapOf<String, Any?>(
            "service" to service, "desc_text" to desc, "addr" to addr, "price" to price, "status" to "open",
            "owner_phone" to myPhone, "applicants" to emptyList<Any>(), "created_at" to nowMs(),
        )
        if (schedule.asap) row["schedule_type"] = "asap"
        else {
            row["schedule_type"] = "slot"; row["slot_start"] = schedule.selection.start; row["slot_end"] = schedule.selection.end
        }
        if (cat != null) row["cat"] = cat
        if (size != null) row["size"] = size
        if (!toAddr.isNullOrEmpty() && info?.needsToAddr == true) row["to_addr"] = toAddr
        return try {
            insertJob(row, schedule)
            toast("toastSubmitted")
            loadJobs()
            true
        } catch (e: Exception) { toast("toastSaveFailed"); false }
    }

    /** If diz_scheduling.sql has not been run yet, "as soon as possible" requests are still saved (without the new column);
     *  requests with a chosen time fail instead of silently losing the time. */
    private suspend fun insertJob(row: Map<String, Any?>, schedule: ScheduleChoice) {
        try { api.insert("jobs", row) }
        catch (e: ApiError) {
            if (schedule.asap && (e.message.contains("schedule_type") || e.message.contains("column"))) api.insert("jobs", row - "schedule_type") else throw e
        }
    }

    fun deleteJob(id: String) {
        viewModelScope.launch {
            try { api.delete("jobs", id); toast("toastRequestDeleted"); loadJobs() } catch (e: Exception) { toast("toastSaveFailed") }
        }
    }

    /** Cash only: assigning needs no payment (the database has payments_mode 'off', see diz_cash_only.sql). */
    fun assign(j: Job, a: Applicant) {
        viewModelScope.launch { patch(j.id, mapOf("status" to "accepted", "accepted_by_phone" to a.phone, "price" to a.price), "toastAssigned") }
    }

    fun complete(j: Job) {
        if (!(j.arrived || j.markedDoneByProvider)) return
        viewModelScope.launch { patch(j.id, mapOf("status" to "done", "payment_released" to true, "completed_at" to nowMs()), "paymentReleasedNote") }
    }

    suspend fun reportProblem(j: Job, text: String): Boolean {
        val t = text.trim()
        if (t.isEmpty()) { toast("toastReportEmpty"); return false }
        patch(j.id, mapOf("problem_reported" to true, "problem_text" to t, "problem_reported_at" to nowMs()), "toastProblemReported")
        return true
    }

    suspend fun submitReview(job: Job, rating: Int, comment: String): Boolean {
        val c = comment.trim()
        return try {
            api.rpc("submit_review", mapOf("p_job_id" to job.id, "p_rating" to rating, "p_comment" to if (c.isEmpty()) null else c.take(500)))
            toast("review.thanks")
            ratingsKey = ""
            loadReviews()
            true
        } catch (e: Exception) { toast("review.failed"); false }
    }

    // ---- provider actions ----
    fun apply(j: Job, price: Int, proposal: SlotSelection? = null) {
        val u = user
        if (price <= 0 || u == null) { toast("toastInvalidOffer"); return }
        val entry = Applicant(u.phone, u.name, price, nowMs(),
            if (proposal != null && !proposal.isEmpty) proposal.start else null,
            if (proposal != null && !proposal.isEmpty) proposal.end else null)
        val list = j.applicants.toMutableList()
        val i = list.indexOfFirst { it.phone == u.phone }
        if (i >= 0) list[i] = entry else list.add(entry)
        viewModelScope.launch { patch(j.id, mapOf("applicants" to JSONArray().also { arr -> list.forEach { arr.put(it.toJson()) } }), "toastApplied") }
    }

    fun arrive(j: Job) {
        viewModelScope.launch { patch(j.id, mapOf("arrived" to true, "arrived_at" to nowMs()), "toastProviderArrived"); sharing.drop(j.id) }
    }

    fun markDone(j: Job) {
        viewModelScope.launch { patch(j.id, mapOf("marked_done_by_provider" to true, "marked_done_at" to nowMs()), "toastProviderMarkedDone") }
    }

    suspend fun respond(j: Job, text: String): Boolean {
        val t = text.trim()
        if (t.isEmpty()) { toast("toastResponseEmpty"); return false }
        patch(j.id, mapOf("provider_response" to t, "provider_response_at" to nowMs()), "toastResponseSent")
        return true
    }

    fun dismiss(id: String) {
        dismissed = dismissed + id
        viewModelScope.launch {
            try { api.rpc("dismiss_job", mapOf("p_job_id" to id)); toast("dismiss.toast") }
            catch (e: Exception) { dismissed = dismissed - id; toast("dismiss.failed") }
        }
    }

    fun restoreJob(id: String) {
        dismissed = dismissed - id
        viewModelScope.launch {
            try { api.rpc("restore_job", mapOf("p_job_id" to id)) } catch (e: Exception) { dismissed = dismissed + id; toast("dismiss.failed") }
        }
    }

    // ---- account ----
    /** Deletes the account on the server (rpc delete_my_account) and signs out. */
    fun deleteAccount() {
        viewModelScope.launch {
            busy = true
            try {
                api.rpc("delete_my_account")
                logout()
                toast("account.deleted")
            } catch (e: ApiError) {
                toast(if (e.message.contains("active jobs")) "account.deleteActive" else "account.deleteFailed")
            } catch (e: Exception) { toast("account.deleteFailed") }
            finally { busy = false }
        }
    }

    // ---- chat ----
    suspend fun send(jobId: String, body: String): Boolean {
        val b = body.trim()
        if (b.isEmpty()) return false
        return try { api.rpc("send_message", mapOf("p_job_id" to jobId, "p_body" to b)); loadMessages(); true }
        catch (e: ApiError) { if (e.message.lowercase().contains("many") || e.status == 429) toast("chat.tooMany") else toast("chat.failed"); false }
        catch (e: Exception) { toast("chat.failed"); false }
    }

    fun markRead(jobId: String) {
        if (unreadCount(jobId) == 0) return
        viewModelScope.launch { runCatching { api.rpc("mark_messages_read", mapOf("p_job_id" to jobId)) }; loadMessages() }
    }

    // ---- location sharing (provider) ----
    private fun updateSharing() {
        if (!isDriver) { sharing.update(emptySet()); return }
        sharing.update(jobs.filter { it.status == "accepted" && it.acceptedByPhone == myPhone && !it.arrived }.map { it.id }.toSet())
    }

    private suspend fun sendFix(jobId: String, lat: Double, lng: Double, accuracy: Double?): Boolean =
        try { api.rpc("share_location", mapOf("p_job_id" to jobId, "p_lat" to lat, "p_lng" to lng, "p_accuracy" to accuracy)); true } catch (e: Exception) { false }

    // ---- internals ----
    private suspend fun patch(id: String, fields: Map<String, Any?>, ok: String) {
        try { api.update("jobs", id, fields); toast(ok); loadJobs(); updateSharing() } catch (e: Exception) { toast("toastSaveFailed") }
    }

    companion object { fun nowMs(): Long = System.currentTimeMillis() }
}

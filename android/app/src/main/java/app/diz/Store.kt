package app.diz

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job as CoJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
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
    var providerPhotos by mutableStateOf<Map<String, String>>(emptyMap())   // provider phone -> profile photo URL
        private set
    var appNotice by mutableStateOf<AppNotice?>(null)                       // admin's "new version" notice
    var updateDismissed by mutableStateOf(false)
    var tabRequest by mutableStateOf<String?>(null)                         // asks MainTabs to switch tab (e.g. "profile")
    var myComments by mutableStateOf<List<ProviderComment>>(emptyList())
    var myDocs by mutableStateOf<List<ProviderDoc>>(emptyList())   // provider: documents for verification
    var docProgress by mutableStateOf<String?>(null)              // "Uploading 1 of 3…" while uploading
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
    fun changeLang(l: Lang) {
        val changed = l != lang
        lang = l; prefs.edit().putString("lang", l.code).apply()
        if (changed) viewModelScope.launch { registerPush() }   // notifications follow the app language
    }

    val isDriver: Boolean get() = user?.isDriver ?: false
    /** Provider not yet activated by admin: sees jobs but cannot make offers. */
    val isUnapprovedProvider: Boolean get() = isDriver && user?.approved == false
    /** Provider without a profile photo: may not make offers (diz_provider_avatar.sql). */
    val providerMissingPhoto: Boolean get() = isDriver && user?.hasAvatarColumn == true && user?.avatarUrl.isNullOrEmpty()
    /** Photo of a provider by phone (own photo for the provider themself). */
    fun photoUrl(phone: String?): String? = if (phone == null) null else if (phone == user?.phone) user?.avatarUrl else providerPhotos[phone]
    private var approvalChecked = false
    val myPhone: String get() = user?.phone ?: ""

    // ---- session lifecycle ----
    suspend fun loadAppNotice() {
        try { appNotice = AppNotice.parse(JSONObject(api.rpc("get_app_notice"))) } catch (_: Exception) {}
    }

    private suspend fun restore() {
        try {
            loadAppNotice()
            if (api.session == null) return
            if (!api.refreshIfNeeded()) return
            val s = api.session ?: return
            val u = fetchUser(s.userId, 1)
            if (u != null) { user = u; afterSignIn() } else if (api.session == null) user = null
        } finally { restoring = false }
    }

    /** Re-reads the provider's own activation status, both ways (activated or deactivated by admin). */
    suspend fun refreshApproval() {
        val id = user?.id ?: return
        if (!isDriver) return
        val fresh = fetchUser(id, 1)?.approved ?: return
        if (fresh != user?.approved) {
            user = user?.copy(approved = fresh)
            toast(if (fresh) "toastNowApproved" else "toastNotApproved")
        }
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

    fun register(name: String, phone: String, realEmail: String, password: String, role: String, profiles: List<String>) {
        val email = Config.authEmail(phone)
        val mail = realEmail.trim().lowercase()
        if (name.isBlank() || email.isEmpty() || password.isEmpty()) { toast("toastAuthMissingFields"); return }
        // E-mail is optional; if given it must be valid.
        if (mail.isNotEmpty() && !isValidEmail(mail)) { toast("toastInvalidEmail"); return }
        if (password.length < 6) { toast("toastPasswordShort"); return }
        if (role == "driver" && profiles.isEmpty()) { toast("toastAuthMissingProfiles"); return }
        viewModelScope.launch {
            busy = true
            try {
                val meta = mapOf("name" to name.trim(), "phone" to phone, "role" to role, "profiles" to if (role == "driver") profiles else emptyList<String>(), "email" to mail.ifEmpty { null })
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

    /** "Forgot password": the server mails a reset link to the account's e-mail. It always answers ok,
     *  so the app never learns whether the number exists. */
    fun requestPasswordReset(phone: String, onSent: () -> Unit) {
        if (Config.authEmail(phone).isEmpty()) { toast("toastAuthMissingFields"); return }
        viewModelScope.launch {
            busy = true
            try {
                api.invokePublic("request-password-reset", mapOf("phone" to phone, "lang" to lang.code))
                onSent()
            } catch (e: Exception) { toast("toastDbUnavailable") }
            finally { busy = false }
        }
    }

    /** "Forgot password" with a 6-digit code on WhatsApp (Edge Function whatsapp-reset). The server answers ok whether
     *  or not the number exists; not ok only when WhatsApp isn't set up (then the e-mail link is the way). */
    fun sendResetCode(phone: String, onSent: () -> Unit) {
        if (Config.authEmail(phone).isEmpty()) { toast("toastAuthMissingFields"); return }
        viewModelScope.launch {
            busy = true
            try {
                val res = org.json.JSONObject(api.invokePublic("whatsapp-reset", mapOf("action" to "send", "phone" to phone, "lang" to lang.code)))
                if (res.optBoolean("ok")) onSent() else toast("toastWaUnavailable")
            } catch (e: Exception) { toast("toastWaUnavailable") }
            finally { busy = false }
        }
    }

    /** Sets a new password with the WhatsApp code, then signs in with it. */
    fun resetWithCode(phone: String, rawCode: String, password: String, again: String) {
        val code = rawCode.asciiDigits().filter { it in '0'..'9' }
        if (code.length != 6) { toast("toastCodeInvalid"); return }
        if (password.length < 6) { toast("toastPasswordShort"); return }
        if (password != again) { toast("toastPasswordMismatch"); return }
        viewModelScope.launch {
            busy = true
            var ok = false
            try {
                val res = org.json.JSONObject(api.invokePublic("whatsapp-reset",
                    mapOf("action" to "reset", "phone" to phone, "code" to code, "password" to password)))
                if (res.optBoolean("ok")) ok = true
                else when (res.optString("error")) {
                    "expired", "too_many" -> toast("toastCodeExpired")
                    "weak" -> toast("toastPasswordShort")
                    else -> toast("toastCodeInvalid")
                }
            } catch (e: Exception) { toast("toastDbUnavailable") }
            finally { busy = false }
            if (ok) {
                toast("toastPasswordChanged")
                login(phone, password)
            }
        }
    }

    // ---- Profile photo (providers) ----
    /** Crops to a 512×512 JPEG, uploads to avatars/<user id>/…, saves users.avatar_url and removes the old file. */
    fun uploadAvatar(raw: ByteArray) {
        val u = user ?: return
        if (!isDriver) return
        viewModelScope.launch {
            busy = true
            try {
                val jpeg = withContext(Dispatchers.Default) { AvatarImages.squareJpeg(raw) }
                if (jpeg == null) { toast("avatar.badType"); return@launch }
                val path = "${u.id}/${nowMs()}.jpg"
                val url = "${Config.SUPABASE_URL}/storage/v1/object/public/avatars/$path"
                val old = avatarPath(u.avatarUrl)
                api.uploadFile("avatars", path, jpeg, "image/jpeg")
                try { api.update("users", u.id, mapOf("avatar_url" to url)) }
                catch (e: Exception) { try { api.removeFiles("avatars", listOf(path)) } catch (_: Exception) {}; throw e }
                user = user?.copy(avatarUrl = url, hasAvatarColumn = true)
                if (old != null && old != path) try { api.removeFiles("avatars", listOf(old)) } catch (_: Exception) {}
                toast("avatar.saved")
            } catch (e: Exception) { toast("toastSaveFailed") }
            finally { busy = false }
        }
    }

    private fun avatarPath(url: String?): String? {
        if (url == null) return null
        val marker = "/object/public/avatars/"
        val i = url.indexOf(marker)
        if (i < 0) return null
        return android.net.Uri.decode(url.substring(i + marker.length).substringBefore('?'))
    }

    // ---- Provider documents (verification) ----
    fun loadMyDocs() {
        val id = user?.id
        if (!isDriver || id == null) { myDocs = emptyList(); return }
        viewModelScope.launch {
            myDocs = try {
                api.select("provider_documents", listOf("user_id" to "eq.$id"), order = "created_at.asc").map { ProviderDoc.from(it) }
            } catch (e: Exception) { emptyList() }
        }
    }

    /** A file chosen or photographed for upload. */
    data class DocFile(val bytes: ByteArray, val name: String, val mime: String)

    /** Uploads the ID-document files one after another to provider-docs/<user id>/… and records them in provider_documents. */
    fun uploadDocs(files: List<DocFile>) {
        val id = user?.id ?: return
        if (!isDriver || files.isEmpty()) return
        viewModelScope.launch {
            busy = true
            var done = 0
            try {
                for ((i, f) in files.withIndex()) {
                    docProgress = tr("docs.uploadingN", mapOf("n" to "${i + 1}", "total" to "${files.size}"))
                    if (f.bytes.size > MAX_DOC_BYTES) { toast("docs.tooBig"); continue }
                    if (!(f.mime.startsWith("image/") || f.mime == "application/pdf")) { toast("docs.badType"); continue }
                    if (myDocs.size + done >= 20) { toast("docs.tooMany"); break }
                    val ext = if (f.mime == "application/pdf") "pdf" else "jpg"
                    val path = "$id/${java.util.UUID.randomUUID()}.$ext"
                    try {
                        api.uploadFile(DOC_BUCKET, path, f.bytes, f.mime)
                        try {
                            api.insert("provider_documents", mapOf("user_id" to id, "kind" to "id", "file_path" to path,
                                "file_name" to f.name.take(200), "mime" to f.mime, "size_bytes" to f.bytes.size))
                        } catch (e: Exception) {
                            try { api.removeFiles(DOC_BUCKET, listOf(path)) } catch (_: Exception) {}
                            throw e
                        }
                        done++
                    } catch (e: Exception) { toast("toastSaveFailed") }
                }
                if (done == 1) toast("docs.uploaded") else if (done > 1) toast("docs.uploadedN", mapOf("n" to "$done"))
                myDocs = try {
                    api.select("provider_documents", listOf("user_id" to "eq.$id"), order = "created_at.asc").map { ProviderDoc.from(it) }
                } catch (e: Exception) { myDocs }
            } finally { busy = false; docProgress = null }
        }
    }

    fun deleteDoc(doc: ProviderDoc) {
        viewModelScope.launch {
            busy = true
            try {
                api.delete("provider_documents", doc.id)
                try { api.removeFiles(DOC_BUCKET, listOf(doc.filePath)) } catch (_: Exception) {}
                toast("docs.deleted")
                loadMyDocs()
            } catch (e: Exception) { toast("toastSaveFailed") }
            finally { busy = false }
        }
    }

    /** Profile page: one save for the e-mail and, for providers, the skills (which kinds of jobs they see). */
    fun saveDetails(rawEmail: String, profiles: List<String>?) {
        val u = user ?: return
        val mail = rawEmail.trim().lowercase()
        if (mail.isNotEmpty() && !isValidEmail(mail)) { toast("toastInvalidEmail"); return }
        if (profiles != null && profiles.isEmpty()) { toast("toastAuthMissingProfiles"); return }
        val newEmail: String? = mail.ifEmpty { null }
        val patch: Map<String, Any?> = if (profiles != null) mapOf("email" to newEmail, "profiles" to profiles) else mapOf("email" to newEmail)
        viewModelScope.launch {
            busy = true
            try {
                api.update("users", u.id, patch)
                user = user?.copy(email = newEmail, profiles = profiles ?: u.profiles)
                toast("toastAccountSaved")
                if (profiles != null) refreshAll()
            } catch (e: Exception) { toast("toastSaveFailed") }
            finally { busy = false }
        }
    }

    fun logout() {
        pollJob?.cancel(); pollJob = null
        calls.stop()
        sharing.stop()
        // Stop notifications to this phone, then end the session (unless a new login happened meanwhile).
        val token = pushToken
        val old = api.session?.accessToken
        if (token != null && old != null) {
            viewModelScope.launch {
                try { api.rpc("unregister_push_token", mapOf("p_token" to token)) } catch (_: Exception) {}
                if (api.session?.accessToken == old) api.clearSession()
            }
        } else api.clearSession()
        Push.clear(getApplication())
        user = null; jobs = emptyList(); messages = emptyList(); locations = emptyMap(); dismissed = emptySet()
        reviews = emptyMap(); ratings = emptyMap(); myComments = emptyList(); myDocs = emptyList(); ratingsKey = ""
    }

    // ---- Push notifications ----
    private var pushToken: String? = null
    /** Asks for the Android 13+ notification permission (set by MainActivity). */
    var requestNotificationPermission: (() -> Unit)? = null

    /** Sends this phone's FCM token (and language) to Supabase so notifications reach it. */
    suspend fun registerPush() {
        if (user == null) return
        val ctx = getApplication<Application>()
        val t = Push.token(ctx) ?: Push.savedToken(ctx) ?: return
        pushToken = t
        try { api.rpc("register_push_token", mapOf("p_token" to t, "p_platform" to "android", "p_lang" to lang.code, "p_env" to "production")) } catch (_: Exception) {}
    }

    /** App opened or brought to the front: clear notifications and the number on the icon (locally and on the server). */
    fun appBecameActive() {
        viewModelScope.launch { loadAppNotice() }
        Push.clear(getApplication())
        if (user == null) return
        viewModelScope.launch { try { api.rpc("reset_push_badge") } catch (_: Exception) {} }
    }

    private suspend fun afterSignIn() {
        requestNotificationPermission?.invoke()
        registerPush()
        appBecameActive()
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
        refreshApproval()
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
            if (!isDriver) try {
                providerPhotos = JSONArray(api.rpc("provider_avatars", mapOf("p_phones" to phones))).objects().mapNotNull { r ->
                    val p = r.str("phone") ?: return@mapNotNull null
                    val u = r.str("avatar_url") ?: return@mapNotNull null
                    p to u
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
    suspend fun createJob(service: String, cat: String?, size: Int?, desc: String, addr: String, toAddr: String?, price: Int, schedule: ScheduleChoice, photo: String? = null): Boolean {
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
        if (photo != null) row["photo"] = photo
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
        if (isDriver && !approvalChecked) {
            viewModelScope.launch {
                refreshApproval()
                if (isUnapprovedProvider) toast("toastNotApproved")
                else { approvalChecked = true; try { apply(j, price, proposal) } finally { approvalChecked = false } }
            }
            return
        }
        if (providerMissingPhoto) { toast("avatar.neededToast"); return }
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
        try { api.update("jobs", id, fields); toast(ok); loadJobs(); updateSharing() } catch (e: Exception) {
            // Deactivated by admin in the meantime: the database refuses the offer.
            if (e.message?.contains("provider_not_approved") == true) { user = user?.copy(approved = false); toast("toastNotApproved") }
            else if (e.message?.contains("provider_no_photo") == true) { user = user?.copy(avatarUrl = null); toast("avatar.neededToast") }
            else toast("toastSaveFailed")
        }
    }

    companion object {
        fun nowMs(): Long = System.currentTimeMillis()
        const val DOC_BUCKET = "provider-docs"
        const val MAX_DOC_BYTES = 10 * 1024 * 1024
    }
}

fun isValidEmail(s: String): Boolean = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$").matches(s.trim())

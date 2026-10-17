package app.diz

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ApiError(val status: Int, override val message: String) : Exception(message)

data class Session(val accessToken: String, val refreshToken: String, val userId: String, val expiresAtMs: Long)

/** Converts maps / lists / primitives to org.json values (null becomes JSON null). */
fun toJson(v: Any?): Any = when (v) {
    null -> JSONObject.NULL
    is JSONObject, is JSONArray -> v
    is Map<*, *> -> JSONObject().also { o -> v.forEach { (k, x) -> o.put(k.toString(), toJson(x)) } }
    is Collection<*> -> JSONArray().also { a -> v.forEach { a.put(toJson(it)) } }
    else -> v
}

/** Own small client for Supabase Auth (GoTrue) and PostgREST. */
class Api(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("diz", Context.MODE_PRIVATE)
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
    private val json = "application/json".toMediaType()

    var session: Session? = loadSession()
        private set

    // ---- session ----
    private fun loadSession(): Session? = try {
        prefs.getString("session", null)?.let {
            val o = JSONObject(it)
            Session(o.getString("a"), o.getString("r"), o.getString("u"), o.getLong("e"))
        }
    } catch (e: Exception) { null }

    private fun store(s: Session?) {
        session = s
        prefs.edit().apply {
            if (s == null) remove("session")
            else putString("session", JSONObject().put("a", s.accessToken).put("r", s.refreshToken).put("u", s.userId).put("e", s.expiresAtMs).toString())
        }.apply()
    }

    fun clearSession() = store(null)

    private fun parseAuth(text: String): Session? {
        val o = JSONObject(text)
        val access = o.str("access_token") ?: return null
        val refresh = o.str("refresh_token") ?: return null
        val uid = o.optJSONObject("user")?.str("id") ?: return null
        val expiresIn = o.optDouble("expires_in", 3600.0)
        return Session(access, refresh, uid, System.currentTimeMillis() + ((expiresIn - 30) * 1000).toLong())
    }

    /** Returns null when the project requires e-mail confirmation (no session is issued). */
    suspend fun signUp(email: String, password: String, metadata: Map<String, Any?>): Session? {
        val text = raw("POST", "/auth/v1/signup", body = mapOf("email" to email, "password" to password, "data" to metadata), auth = false)
        val s = parseAuth(text)
        if (s != null) store(s)
        return s
    }

    suspend fun signIn(email: String, password: String) {
        val text = raw("POST", "/auth/v1/token", query = listOf("grant_type" to "password"),
            body = mapOf("email" to email, "password" to password), auth = false)
        store(parseAuth(text) ?: throw ApiError(0, "Invalid auth response"))
    }

    private var refreshing = false
    suspend fun refreshIfNeeded(force: Boolean = false): Boolean {
        val s = session ?: return false
        if (!force && s.expiresAtMs > System.currentTimeMillis()) return true
        if (refreshing) return true
        refreshing = true
        try {
            val text = raw("POST", "/auth/v1/token", query = listOf("grant_type" to "refresh_token"),
                body = mapOf("refresh_token" to s.refreshToken), auth = false)
            val n = parseAuth(text) ?: return false
            store(n)
            return true
        } catch (e: ApiError) {
            if (e.status == 400 || e.status == 401) { store(null); return false }   // refresh token is no longer valid
            return false
        } catch (e: Exception) {
            return false   // offline: keep the session and try again later
        } finally { refreshing = false }
    }

    // ---- HTTP ----
    private suspend fun raw(method: String, path: String, query: List<Pair<String, String>> = emptyList(), body: Any? = null,
                            auth: Boolean = true, prefer: String? = null): String = withContext(Dispatchers.IO) {
        val url = Config.SUPABASE_URL.toHttpUrl().newBuilder().addPathSegments(path.trimStart('/')).apply {
            query.forEach { (k, v) -> addQueryParameter(k, v) }
        }.build()
        val rb = if (body != null) toJson(body).toString().toRequestBody(json) else if (method == "GET" || method == "DELETE") null else "".toRequestBody(json)
        val req = Request.Builder().url(url).method(method, rb).header("apikey", Config.SUPABASE_KEY).apply {
            val s = session
            if (auth && s != null) header("Authorization", "Bearer " + s.accessToken)
            if (prefer != null) header("Prefer", prefer)
            if (body != null) header("Content-Type", "application/json")
        }.build()
        http.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: ""
            if (resp.isSuccessful) return@use text
            var msg = "HTTP ${resp.code}"
            try {
                val o = JSONObject(text)
                msg = o.str("message") ?: o.str("msg") ?: o.str("error_description") ?: o.str("error") ?: msg
            } catch (e: Exception) { /* not JSON */ }
            throw ApiError(resp.code, msg)
        }
    }

    /** Authenticated request; refreshes the token once on 401. */
    private suspend fun call(method: String, path: String, query: List<Pair<String, String>> = emptyList(), body: Any? = null,
                             prefer: String? = null): String {
        refreshIfNeeded()
        return try {
            raw(method, path, query, body, prefer = prefer)
        } catch (e: ApiError) {
            if (e.status == 401 && refreshIfNeeded(force = true)) raw(method, path, query, body, prefer = prefer) else throw e
        }
    }

    // ---- PostgREST ----
    suspend fun select(table: String, filters: List<Pair<String, String>> = emptyList(), order: String? = null, limit: Int? = null): List<JSONObject> {
        val q = mutableListOf("select" to "*") + filters
        val all = q.toMutableList()
        if (order != null) all.add("order" to order)
        if (limit != null) all.add("limit" to limit.toString())
        return JSONArray(call("GET", "/rest/v1/$table", all)).objects()
    }

    /** Returns the number of rows touched (PATCH with return=representation). */
    suspend fun update(table: String, id: String, patch: Map<String, Any?>): Int {
        val text = call("PATCH", "/rest/v1/$table", listOf("id" to "eq.$id", "select" to "id"), patch, "return=representation")
        val n = JSONArray(text).length()
        if (n == 0) throw ApiError(403, "No rows updated")
        return n
    }

    suspend fun insert(table: String, row: Map<String, Any?>) { call("POST", "/rest/v1/$table", body = row, prefer = "return=minimal") }

    suspend fun delete(table: String, id: String) { call("DELETE", "/rest/v1/$table", listOf("id" to "eq.$id"), prefer = "return=minimal") }

    /** Returns the raw response text (JSON or empty). */
    suspend fun rpc(fn: String, args: Map<String, Any?> = emptyMap()): String = call("POST", "/rest/v1/rpc/$fn", body = args)
}

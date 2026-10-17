package app.diz

import org.json.JSONArray
import org.json.JSONObject

// ---- small helpers for org.json (null-safe reads) ----
fun JSONObject.str(key: String): String? = if (isNull(key)) null else optString(key)
fun JSONObject.long(key: String): Long? = if (isNull(key)) null else if (has(key)) optLong(key) else null
fun JSONObject.int(key: String): Int? = if (isNull(key)) null else if (has(key)) optInt(key) else null
fun JSONObject.dbl(key: String): Double? = if (isNull(key)) null else if (has(key)) optDouble(key) else null
fun JSONObject.bool(key: String): Boolean = !isNull(key) && optBoolean(key, false)
fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }

data class Applicant(
    val phone: String,
    val name: String,
    val price: Int,
    val appliedAt: Long? = null,
    val proposedStart: Long? = null,   // provider's suggested time window (ms), if different from the requested one
    val proposedEnd: Long? = null,
) {
    val proposedWindow: Pair<Long, Long>?
        get() = if (proposedStart != null && proposedEnd != null && proposedEnd > proposedStart) proposedStart to proposedEnd else null

    fun toJson(): JSONObject = JSONObject().apply {
        put("phone", phone); put("name", name); put("price", price)
        appliedAt?.let { put("appliedAt", it) }
        if (proposedStart != null && proposedEnd != null) { put("proposedStart", proposedStart); put("proposedEnd", proposedEnd) }
    }

    companion object {
        fun from(o: JSONObject) = Applicant(
            phone = o.optString("phone"), name = o.optString("name"), price = o.optInt("price"),
            appliedAt = o.long("appliedAt"), proposedStart = o.long("proposedStart"), proposedEnd = o.long("proposedEnd"),
        )
    }
}

/** A row of the table `jobs` (snake_case columns, see diz_supabase_schema.sql). */
data class Job(
    val id: String,
    val service: String,
    val cat: String?,
    val size: Int?,
    val desc: String,
    val addr: String,
    val toAddr: String?,
    val price: Int,
    val status: String,
    val ownerPhone: String?,
    val acceptedByPhone: String?,
    val applicants: List<Applicant>,
    val arrived: Boolean,
    val markedDoneByProvider: Boolean,
    val problemReported: Boolean,
    val problemText: String?,
    val providerResponse: String?,
    val completedAt: Long?,
    val createdAt: Long,
    val scheduleType: String?,
    val slotStart: Long?,
    val slotEnd: Long?,
) {
    /** The window the customer asked for (ms); null means "as soon as possible". */
    val requestedWindow: Pair<Long, Long>?
        get() = if (scheduleType == "slot" && slotStart != null && slotEnd != null && slotEnd > slotStart) slotStart to slotEnd else null

    /** The time that applies once a provider is chosen: their proposal if they made one, otherwise the requested window. */
    val agreedWindow: Pair<Long, Long>?
        get() {
            val phone = acceptedByPhone
            val w = if (phone != null) applicants.firstOrNull { it.phone == phone }?.proposedWindow else null
            return w ?: requestedWindow
        }

    /** Same mapping as effectiveStatusKey() in src/jobs.ts. */
    val statusKey: String
        get() = when {
            status == "accepted" && problemReported -> "problem"
            status == "accepted" && (arrived || markedDoneByProvider) -> "arrived"
            else -> status
        }
    val isFinal: Boolean get() = status == "done" || status == "cancelled"

    companion object {
        fun from(o: JSONObject) = Job(
            id = o.getString("id"),
            service = o.getString("service"),
            cat = o.str("cat"),
            size = o.int("size"),
            desc = o.str("desc_text") ?: "",
            addr = o.str("addr") ?: "",
            toAddr = o.str("to_addr"),
            price = o.int("price") ?: 0,
            status = o.str("status") ?: "open",
            ownerPhone = o.str("owner_phone"),
            acceptedByPhone = o.str("accepted_by_phone"),
            applicants = o.optJSONArray("applicants")?.objects()?.map { Applicant.from(it) } ?: emptyList(),
            arrived = o.bool("arrived"),
            markedDoneByProvider = o.bool("marked_done_by_provider"),
            problemReported = o.bool("problem_reported"),
            problemText = o.str("problem_text"),
            providerResponse = o.str("provider_response"),
            completedAt = o.long("completed_at"),
            createdAt = o.long("created_at") ?: 0L,
            scheduleType = o.str("schedule_type"),
            slotStart = o.long("slot_start"),
            slotEnd = o.long("slot_end"),
        )
    }
}

data class AppUser(val id: String, val phone: String, val name: String, val role: String, val profiles: List<String>) {
    val isDriver: Boolean get() = role == "driver"

    companion object {
        fun from(o: JSONObject) = AppUser(
            id = o.getString("id"), phone = o.getString("phone"), name = o.str("name") ?: "", role = o.str("role") ?: "customer",
            profiles = o.optJSONArray("profiles")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList(),
        )
    }
}

data class ChatMessage(
    val id: Long, val jobId: String, val senderPhone: String, val recipientPhone: String,
    val body: String, val createdAt: Long, val readAt: Long?,
) {
    companion object {
        fun from(o: JSONObject) = ChatMessage(
            id = o.getLong("id"), jobId = o.getString("job_id"), senderPhone = o.optString("sender_phone"),
            recipientPhone = o.optString("recipient_phone"), body = o.optString("body"),
            createdAt = o.long("created_at") ?: 0L, readAt = o.long("read_at"),
        )
    }
}

data class Review(val jobId: String, val providerPhone: String, val rating: Int, val comment: String?, val hidden: Boolean) {
    companion object {
        fun from(o: JSONObject) = Review(
            jobId = o.getString("job_id"), providerPhone = o.optString("provider_phone"), rating = o.optInt("rating"),
            comment = o.str("comment"), hidden = o.bool("hidden"),
        )
    }
}

data class Rating(val avg: Double, val count: Int)

data class ProviderComment(val rating: Int, val comment: String?, val createdAt: Long) {
    companion object {
        fun from(o: JSONObject) = ProviderComment(o.optInt("rating"), o.str("comment"), o.long("created_at") ?: 0L)
    }
}

data class ProviderLocation(val jobId: String, val lat: Double, val lng: Double, val updatedAt: Long) {
    companion object {
        fun from(o: JSONObject) = ProviderLocation(o.getString("job_id"), o.optDouble("lat"), o.optDouble("lng"), o.long("updated_at") ?: 0L)
    }
}

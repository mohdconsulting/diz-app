package app.diz

import android.text.format.DateFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Time slots for jobs. Every slot is one hour; a customer (or a provider proposing another time) picks one
 *  or more consecutive hours on a single day. All times are epoch milliseconds. */
object Scheduling {
    const val SLOT_MS = 3_600_000L
    const val FIRST_HOUR = 8          // first slot 08:00–09:00
    const val LAST_HOUR = 20          // last slot 20:00–21:00
    const val DAYS_AHEAD = 14
    const val MAX_SLOTS = 12          // matches the database check (max 12 hours)
    const val LEAD_MS = 1_800_000L    // a slot must start at least 30 min from now

    private fun startOfDay(ms: Long): Calendar = Calendar.getInstance().apply {
        timeInMillis = ms
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }

    fun days(now: Long = System.currentTimeMillis()): List<Long> {
        val c = startOfDay(now)
        return (0 until DAYS_AHEAD).map { val t = c.timeInMillis; c.add(Calendar.DAY_OF_MONTH, 1); t }
    }

    fun slots(day: Long, now: Long = System.currentTimeMillis()): List<Long> {
        val c = startOfDay(day)
        return (FIRST_HOUR..LAST_HOUR).mapNotNull { h ->
            c.set(Calendar.HOUR_OF_DAY, h)
            val t = c.timeInMillis
            if (t > now + LEAD_MS) t else null
        }
    }

    fun sameDay(a: Long, b: Long): Boolean = startOfDay(a).timeInMillis == startOfDay(b).timeInMillis

    // ---- formatting ----
    private fun fmt(template: String, lang: Lang): SimpleDateFormat {
        val loc = lang.locale
        return SimpleDateFormat(DateFormat.getBestDateTimePattern(loc, template), loc)
    }
    fun dayText(ms: Long, lang: Lang): String = fmt("EEEdMMM", lang).format(Date(ms))
    fun shortDayText(ms: Long, lang: Lang): String = fmt("EEEd", lang).format(Date(ms))
    fun timeText(ms: Long, lang: Lang): String = SimpleDateFormat("HH:mm", lang.locale).format(Date(ms))
    fun slotText(start: Long, lang: Lang): String = timeText(start, lang) + "–" + timeText(start + SLOT_MS, lang)
    /** "Tue 14 Oct, 10:00–13:00" */
    fun windowText(start: Long, end: Long, lang: Lang): String = dayText(start, lang) + ", " + timeText(start, lang) + "–" + timeText(end, lang)
}

/** The hours a user has selected on one day. Tapping adjacent hours extends the window. */
data class SlotSelection(val start: Long? = null, val end: Long? = null) {
    val isEmpty: Boolean get() = start == null || end == null
    val hours: Int get() = if (start == null || end == null) 0 else Math.round((end - start).toDouble() / Scheduling.SLOT_MS).toInt()

    fun contains(slot: Long): Boolean = start != null && end != null && slot >= start && slot < end

    fun tap(slot: Long): SlotSelection {
        val slotEnd = slot + Scheduling.SLOT_MS
        val s = start; val e = end
        if (s == null || e == null) return SlotSelection(slot, slotEnd)
        if (contains(slot)) {
            if (hours == 1) return SlotSelection()
            return when {
                slot == s -> SlotSelection(slotEnd, e)
                slotEnd == e -> SlotSelection(s, slot)
                else -> SlotSelection(slot, slotEnd)      // tapped in the middle: start over from that hour
            }
        }
        return when {
            slot == e && hours < Scheduling.MAX_SLOTS -> SlotSelection(s, slotEnd)
            slotEnd == s && hours < Scheduling.MAX_SLOTS -> SlotSelection(slot, e)
            else -> SlotSelection(slot, slotEnd)
        }
    }
}

/** What the customer asked for when creating a request. */
data class ScheduleChoice(val asap: Boolean = true, val selection: SlotSelection = SlotSelection())

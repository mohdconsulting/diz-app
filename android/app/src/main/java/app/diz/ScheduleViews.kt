package app.diz

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Day chips + one-hour slot grid. Selecting neighbouring hours extends the window (see SlotSelection.tap). */
@Composable
fun TimeSlotPicker(store: Store, selection: SlotSelection, onChange: (SlotSelection) -> Unit) {
    val days = remember { Scheduling.days() }
    var day by remember {
        mutableStateOf(if (Scheduling.slots(days.first()).isEmpty() && days.size > 1) days[1] else days.first())
    }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(days) { d ->
                Chip(Scheduling.shortDayText(d, store.lang), Scheduling.sameDay(d, day)) {
                    day = d
                    val s = selection.start
                    if (s != null && !Scheduling.sameDay(s, d)) onChange(SlotSelection())
                }
            }
        }
        val slots = Scheduling.slots(day)
        if (slots.isEmpty()) {
            Text(store.tr("sched.noSlots"), fontSize = 13.sp, color = Color.Gray)
        } else {
            slots.chunked(3).forEach { rowSlots ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    rowSlots.forEach { s ->
                        val on = selection.contains(s)
                        Box(
                            Modifier.weight(1f).clip(RoundedCornerShape(8.dp))
                                .background(if (on) DizBrand else Color(0x1F767680))
                                .clickable { onChange(selection.tap(s)) }.padding(vertical = 10.dp),
                            contentAlignment = Alignment.Center,
                        ) { Text(Scheduling.slotText(s, store.lang), fontSize = 13.sp, color = if (on) Color.White else Color.Black, textAlign = TextAlign.Center) }
                    }
                    repeat(3 - rowSlots.size) { Box(Modifier.weight(1f)) }
                }
            }
        }
        Text(store.tr("sched.hint"), fontSize = 12.sp, color = Color.Gray)
        val s = selection.start; val e = selection.end
        if (s != null && e != null) {
            Text(
                Scheduling.windowText(s, e, store.lang) + " (" + store.tr("sched.hours", mapOf("n" to selection.hours.toString())) + ")",
                fontWeight = FontWeight.Bold, color = DizBrand,
            )
        }
    }
}

/** "ASAP / pick a time" choice for a new request. */
@Composable
fun ScheduleSection(store: Store, choice: ScheduleChoice, onChange: (ScheduleChoice) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(store.tr("sched.title"), fontWeight = FontWeight.Bold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip(store.tr("sched.asap"), choice.asap) { onChange(choice.copy(asap = true)) }
            Chip(store.tr("sched.pick"), !choice.asap) { onChange(choice.copy(asap = false)) }
        }
        if (choice.asap) Text(store.tr("sched.asapLong"), fontSize = 13.sp, color = Color.Gray)
        else TimeSlotPicker(store, choice.selection) { onChange(choice.copy(selection = it)) }
    }
}

/** Requested time (open job) or agreed time (assigned job) on a job card. */
@Composable
fun ScheduleLine(store: Store, job: Job) {
    if (job.status == "open" || job.status == "accepted" || job.status == "done") {
        val w = if (job.status == "open") job.requestedWindow else job.agreedWindow
        if (w != null) {
            Text("📅 " + store.tr(if (job.status == "open") "sched.requested" else "sched.agreed") + ": " +
                Scheduling.windowText(w.first, w.second, store.lang), fontSize = 13.sp)
        } else if (job.scheduleType == "asap") {
            Text("⚡ " + store.tr("sched.asapLong"), fontSize = 13.sp)
        }
    }
}

/** Provider: propose another date/time (and price) for an open job. The customer accepts by choosing the provider. */
@Composable
fun ProposalBox(store: Store, job: Job) {
    var open by remember { mutableStateOf(false) }
    var selection by remember { mutableStateOf(SlotSelection()) }
    var price by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (open) {
            Text(store.tr("sched.proposeNote"), fontSize = 13.sp, color = Color.Gray)
            TimeSlotPicker(store, selection) { selection = it }
            DigitField(price, { price = it }, store.tr("sched.priceLabel"))
            PrimaryButton(store.tr("sched.proposeSend"), enabled = !selection.isEmpty) {
                val p = if (price.intValue > 0) price.intValue else job.price
                store.apply(job, p, selection)
                open = false
            }
            LinkButton(store.tr("sched.proposeClose")) { open = false }
        } else {
            LinkButton(store.tr("sched.proposeBtn")) {
                if (price.isEmpty()) price = (job.applicants.firstOrNull { it.phone == store.myPhone }?.price ?: job.price).toString()
                open = true
            }
        }
    }
}

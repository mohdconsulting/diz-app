package app.diz

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

@Composable
fun JobCard(store: Store, job: Job, ignoredView: Boolean = false) {
    val context = LocalContext.current
    val isOwner = job.ownerPhone == store.myPhone
    val isMyAccepted = job.acceptedByPhone == store.myPhone

    Card {
        // header
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(store.tr("services.${job.service}.label"), fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text(store.money(job.price), fontWeight = FontWeight.Bold, color = DizBrand)
        }
        // details
        Text(store.tr("status.${job.statusKey}"), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = DizBrand)
        job.cat?.let { Text(store.tr("services.${job.service}.categories.$it"), fontSize = 14.sp) }
        job.size?.let { Text(store.tr("services.${job.service}.sizes.$it"), fontSize = 14.sp, color = Color.Gray) }
        if (job.desc.isNotEmpty()) Text(job.desc, fontSize = 14.sp)
        ScheduleLine(store, job)
        CashLine(store, job, isMyAccepted)
        if (job.addr.isNotEmpty()) LinkButton("📍 " + job.addr) { openMapsQuery(context, job.addr) }
        job.toAddr?.takeIf { it.isNotEmpty() }?.let { t -> LinkButton("🏁 $t") { openMapsQuery(context, t) } }

        if (store.isDriver) ProviderSection(store, job, ignoredView, isMyAccepted) else CustomerSection(store, job)

        if (job.status == "accepted" && (isOwner || isMyAccepted)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val n = store.unreadCount(job.id)
                SecondaryButton(if (n > 0) store.tr("chat.openUnreadBtn", mapOf("n" to n.toString())) else store.tr("chat.openBtn")) { store.chatJobId = job.id }
                SecondaryButton("📞 " + store.tr("call.btn")) { store.calls.startCall(job) }
            }
        }
    }
}

/** Payment is cash, directly from the customer to the provider. */
@Composable
private fun CashLine(store: Store, job: Job, isMyAccepted: Boolean) {
    if (job.isFinal) return
    if (job.status == "accepted") {
        CashBanner(store.tr(if (isMyAccepted) "cash.acceptedProvider" else "cash.acceptedCustomer", mapOf("amount" to store.money(job.price))))
    } else {
        Text(store.tr("cash.chip"), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = DizBrand)
    }
}

// ---------------- customer ----------------
@Composable
private fun CustomerSection(store: Store, job: Job) {
    var confirmDelete by remember { mutableStateOf(false) }
    when (job.status) {
        "open" -> {
            Text(store.tr("applicantsTitle"), fontWeight = FontWeight.Bold, fontSize = 14.sp)
            if (job.applicants.isEmpty()) Footnote(store.tr("noApplicantsYet")) else CashBanner(store.tr("cash.assignNote"))
            job.applicants.forEach { a ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(a.name)
                        RatingBadge(store, a.phone)
                        val w = a.proposedWindow
                        if (w != null) Text(store.tr("sched.proposed") + ": " + Scheduling.windowText(w.first, w.second, store.lang), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = DizWarn)
                        else if (job.requestedWindow != null) Text(store.tr("sched.fitsRequested"), fontSize = 12.sp, color = Color.Gray)
                        Footnote(store.money(a.price))
                    }
                    PrimaryButton(store.tr("assignBtn"), Modifier.weight(0.7f)) { store.assign(job, a) }
                }
            }
            if (confirmDelete) {
                Footnote(store.tr("confirmDeleteInline"), Color.Black)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryButton(store.tr("confirmDeleteBtn"), Modifier.weight(1f), danger = true) { store.deleteJob(job.id) }
                    SecondaryButton(store.tr("cancelBtn"), Modifier.weight(1f)) { confirmDelete = false }
                }
            } else LinkButton(store.tr("deleteBtn"), danger = true) { confirmDelete = true }
        }
        "accepted" -> AcceptedCustomer(store, job)
        "done" -> {
            Footnote(store.tr("paymentReleasedNote"))
            ReviewSection(store, job)
        }
    }
}

@Composable
private fun AcceptedCustomer(store: Store, job: Job) {
    var showProblem by remember { mutableStateOf(false) }
    var problemText by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    job.acceptedByPhone?.let { p ->
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(store.nameOf(p, job), fontWeight = FontWeight.Bold); RatingBadge(store, p)
        }
    }
    if (job.arrived) Footnote(store.tr("arrivedNoteCustomer"), Color.Black)
    if (job.markedDoneByProvider) Footnote(store.tr("providerMarkedDoneNote"), Color.Black)
    if (!job.arrived && !job.markedDoneByProvider) TrackingBlock(store, job)
    if (job.problemReported) {
        Footnote(store.tr("problemReportedNoteCustomer"), Color.Black)
        job.providerResponse?.takeIf { it.isNotEmpty() }?.let { Footnote(store.tr("providerResponseLabel") + ": " + it, Color.Black) }
    } else if (job.arrived || job.markedDoneByProvider) {
        PrimaryButton(store.tr("confirmReleaseBtn")) { store.complete(job) }
        if (showProblem) {
            OutlinedTextField(problemText, { problemText = it }, placeholder = { Text(store.tr("reportProblemPlaceholder")) }, minLines = 2, modifier = Modifier.fillMaxWidth())
            PrimaryButton(store.tr("sendReportBtn"), danger = true) {
                scope.launch { if (store.reportProblem(job, problemText)) { showProblem = false; problemText = "" } }
            }
        } else LinkButton(store.tr("reportProblemBtn"), danger = true) { showProblem = true }
    }
}

// ---------------- provider ----------------
@Composable
private fun ProviderSection(store: Store, job: Job, ignoredView: Boolean, isMyAccepted: Boolean) {
    when (job.status) {
        "open" -> {
            val mine = job.applicants.firstOrNull { it.phone == store.myPhone }
            if (ignoredView) {
                Footnote(store.tr("dismiss.note"))
                SecondaryButton(store.tr("dismiss.restoreBtn")) { store.restoreJob(job.id) }
            } else if (mine != null) {
                Footnote(store.tr("yourApplicationNote", mapOf("price" to store.money(mine.price))), Color.Black)
                mine.proposedWindow?.let { w ->
                    Text(store.tr("sched.yourProposal") + ": " + Scheduling.windowText(w.first, w.second, store.lang), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = DizWarn)
                }
                OfferRow(store, job)
                ProposalBox(store, job)
            } else {
                PrimaryButton(store.tr("takeJobBtn") + " " + store.money(job.price)) { store.apply(job, job.price) }
                OfferRow(store, job)
                ProposalBox(store, job)
                LinkButton(store.tr("dismiss.btn")) { store.dismiss(job.id) }
            }
        }
        "accepted" -> {
            if (isMyAccepted) AcceptedProvider(store, job)
            else job.applicants.firstOrNull { it.phone == store.myPhone }?.let {
                Footnote(store.tr("yourApplicationNote", mapOf("price" to store.money(it.price))), Color.Black)
            }
        }
        "done" -> if (isMyAccepted) {
            Footnote(store.tr("paymentReleasedNote"))
            ReviewSection(store, job)
        }
    }
}

@Composable
private fun OfferRow(store: Store, job: Job) {
    var show by remember { mutableStateOf(false) }
    var offer by remember { mutableStateOf("") }
    if (show) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            DigitField(offer, { offer = it }, store.tr("customPriceLabel"), Modifier.weight(1f))
            SecondaryButton(store.tr("proposePriceBtn")) { store.apply(job, offer.intValue); show = false }
        }
    } else LinkButton(store.tr("proposePriceBtn")) { show = true }
}

@Composable
private fun AcceptedProvider(store: Store, job: Job) {
    var showRespond by remember { mutableStateOf(false) }
    var responseText by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    if (job.problemReported) {
        Footnote(store.tr("problemReportedNoteProvider", mapOf("text" to (job.problemText ?: ""))), Color.Black)
        val r = job.providerResponse
        if (!r.isNullOrEmpty()) Footnote(store.tr("yourResponseLabel") + ": " + r, Color.Black)
        else if (showRespond) {
            OutlinedTextField(responseText, { responseText = it }, placeholder = { Text(store.tr("respondPlaceholder")) }, minLines = 2, modifier = Modifier.fillMaxWidth())
            PrimaryButton(store.tr("sendResponseBtn")) { scope.launch { if (store.respond(job, responseText)) showRespond = false } }
        } else PrimaryButton(store.tr("respondPrompt")) { showRespond = true }
    } else if (!job.arrived) {
        Footnote(store.tr("track.autoShareInfo"))
        if (store.locationDenied) Footnote(store.tr("track.shareDenied"), DizDanger)
        PrimaryButton(store.tr("providerArriveBtn")) { store.arrive(job) }
    } else if (!job.markedDoneByProvider) {
        Footnote(store.tr("arrivedNoteProvider"), Color.Black)
        PrimaryButton(store.tr("providerCompleteBtn")) { store.markDone(job) }
    } else {
        Footnote(store.tr("waitingCustomerConfirmNote"))
    }
}

// ---------------- reviews ----------------
@Composable
fun ReviewSection(store: Store, job: Job) {
    var rating by remember { mutableStateOf(0) }
    var comment by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val r = store.reviews[job.id]
    if (store.isDriver) {
        if (r != null) {
            Text(store.tr("review.theirReview"), fontSize = 13.sp, fontWeight = FontWeight.Bold)
            Stars(r.rating.toDouble())
            r.comment?.takeIf { it.isNotEmpty() }?.let { Text(it, fontSize = 13.sp) }
        } else Footnote(store.tr("review.noReviewForYou"))
    } else if (r != null) {
        Text(store.tr("review.yourReview"), fontSize = 13.sp, fontWeight = FontWeight.Bold)
        Stars(r.rating.toDouble())
        r.comment?.takeIf { it.isNotEmpty() }?.let { Text(it, fontSize = 13.sp) }
        if (r.hidden) Text(store.tr("review.hiddenForYou"), fontSize = 12.sp, color = Color.Gray)
    } else {
        Text(store.tr("review.prompt"), fontSize = 13.sp, fontWeight = FontWeight.Bold)
        StarPicker(rating) { rating = it }
        OutlinedTextField(comment, { comment = it }, placeholder = { Text(store.tr("review.commentPlaceholder")) }, minLines = 2, maxLines = 4, modifier = Modifier.fillMaxWidth())
        PrimaryButton(store.tr("review.sendBtn"), enabled = rating > 0) { scope.launch { store.submitReview(job, rating, comment) } }
    }
}

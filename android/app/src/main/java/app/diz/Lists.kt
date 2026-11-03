package app.diz

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
private fun JobList(content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    LazyColumn(Modifier.fillMaxWidth(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
}

@Composable
fun OpenJobsScreen(store: Store) {
    var showIgnored by remember { mutableStateOf(false) }
    val open = store.jobs.filter { it.status == "open" && store.providerCanTake(it) }
    val visible = open.filter { it.id !in store.dismissed }
    val ignored = open.filter { it.id in store.dismissed }
    JobList {
        item { SectionTitle(store.tr("openJobsTitle")) }
        if (visible.isEmpty()) item { EmptyBox(store.tr("emptyJobs")) }
        items(visible, key = { it.id }) { JobCard(store, it) }
        if (ignored.isNotEmpty()) {
            item {
                LinkButton(store.tr(if (showIgnored) "dismiss.hideBtn" else "dismiss.showBtn", mapOf("n" to ignored.size.toString()))) { showIgnored = !showIgnored }
            }
            if (showIgnored) items(ignored, key = { "i" + it.id }) { JobCard(store, it, ignoredView = true) }
        }
    }
}

@Composable
fun MyJobsScreen(store: Store) {
    val mine = store.jobs.filter { j ->
        if (j.isFinal && j.status != "cancelled") false
        else if (store.isDriver) j.acceptedByPhone == store.myPhone || j.applicants.any { it.phone == store.myPhone }
        else j.ownerPhone == store.myPhone
    }
    JobList {
        if (mine.isEmpty()) item { EmptyBox(store.tr(if (store.isDriver) "emptyMineDriver" else "emptyMineCustomer")) }
        items(mine, key = { it.id }) { JobCard(store, it) }
    }
}

@Composable
fun HistoryScreen(store: Store) {
    val done = store.jobs.filter { j ->
        j.status == "done" && (if (store.isDriver) j.acceptedByPhone == store.myPhone else j.ownerPhone == store.myPhone)
    }.sortedByDescending { it.completedAt ?: 0L }
    JobList {
        if (store.isDriver) item { OwnRatingCard(store) }
        if (done.isEmpty()) item { EmptyBox(store.tr(if (store.isDriver) "emptyHistoryDriver" else "emptyHistoryCustomer")) }
        items(done, key = { it.id }) { JobCard(store, it) }
    }
}

@Composable
fun OwnRatingCard(store: Store) {
    Card {
        Text(store.tr("review.yourRating"), fontSize = 14.sp, color = DizMuted)
        val r = store.ratings[store.myPhone]
        if (r != null) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { Stars(r.avg); Text("%.1f".format(java.util.Locale.US, r.avg) + " (${r.count})") }
        else Text(store.tr("review.noReviewsYet"), color = DizMuted)
        store.myComments.forEach { c ->
            val t = c.comment
            if (!t.isNullOrEmpty()) { Stars(c.rating.toDouble()); Text(t, fontSize = 13.sp) }
        }
    }
}

package app.diz

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

/** One message in the chat with Diz support (table support_messages, see diz_support.sql). The admin answers on the web. */
data class SupportMessage(val id: Long, val fromAdmin: Boolean, val body: String, val createdAt: String, val read: Boolean) {
    val whenText: String get() = try { OffsetDateTime.parse(createdAt).toLocalDateTime().format(DateTimeFormatter.ofPattern("d MMM HH:mm")) } catch (_: Exception) { "" }
    companion object {
        fun from(o: JSONObject) = SupportMessage(
            o.getLong("id"), o.optBoolean("from_admin", false), o.optString("body", ""), o.optString("created_at", ""), !o.isNull("read_at"),
        )
    }
}

@Composable
fun SupportScreen(store: Store) {
    var text by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val msgs = store.supportMessages
    val listState = rememberLazyListState()

    // Refresh while the tab is open; opening it marks the admin's replies as read.
    LaunchedEffect(Unit) { while (true) { store.loadSupport(markRead = true); delay(6000) } }
    LaunchedEffect(msgs.size) { if (msgs.isNotEmpty()) listState.animateScrollToItem(msgs.size - 1) }

    Column(Modifier.fillMaxSize().imePadding()) {
        Text(store.tr("support.intro"), fontSize = 15.sp, color = DizMuted, modifier = Modifier.padding(12.dp))
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (msgs.isEmpty()) item { Text(store.tr("support.empty"), color = DizMuted, modifier = Modifier.padding(top = 20.dp)) }
            items(msgs, key = { it.id }) { m ->
                val mine = !m.fromAdmin
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                    Column(
                        Modifier.background(if (mine) DizBrand else DizPaper).border(1.dp, if (mine) DizBrand else DizLine).padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text((if (mine) store.tr("chat.you") else store.tr("support.staff")) + if (m.whenText.isNotEmpty()) " · ${m.whenText}" else "",
                            fontSize = 11.sp, color = if (mine) Color.White.copy(alpha = 0.8f) else DizMuted)
                        Text(m.body, color = if (mine) Color.White else DizInk)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(text, { text = it }, placeholder = { Text(store.tr("support.placeholder")) }, maxLines = 4, modifier = Modifier.weight(1f))
            SecondaryButton(store.tr("chat.sendBtn")) {
                val t = text
                if (t.isNotBlank()) scope.launch { if (store.sendSupport(t)) text = "" }
            }
        }
    }
}

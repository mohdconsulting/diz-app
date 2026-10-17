package app.diz

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

@Composable
fun ChatScreen(store: Store, job: Job) {
    var text by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val msgs = store.chat(job.id)
    val listState = rememberLazyListState()
    BackHandler { store.chatJobId = null }

    LaunchedEffect(msgs.size) {
        if (msgs.isNotEmpty()) listState.animateScrollToItem(msgs.size - 1)
        store.markRead(job.id)
    }

    Column(Modifier.fillMaxSize().background(Color.White).systemBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            LinkButton(store.tr("chat.closeBtn")) { store.chatJobId = null }
            Text(store.tr("services.${job.service}.label"), fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            if (!job.isFinal && store.calls.peerOf(job) != null) LinkButton("📞 " + store.tr("call.btn")) { store.calls.startCall(job) }
        }
        Text(store.tr("chat.privacy"), fontSize = 12.sp, color = Color.Gray, modifier = Modifier.padding(8.dp))
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (msgs.isEmpty()) item { Text(store.tr("chat.empty"), color = Color.Gray, modifier = Modifier.padding(top = 20.dp)) }
            items(msgs, key = { it.id }) { m ->
                val mine = m.senderPhone == store.myPhone
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                    Column(
                        Modifier.clip(RoundedCornerShape(14.dp)).background(if (mine) DizBrand else DizCard).padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(if (mine) store.tr("chat.you") else store.tr(if (store.isDriver) "chat.customer" else "chat.provider"),
                            fontSize = 11.sp, color = if (mine) Color.White.copy(alpha = 0.8f) else Color.Gray)
                        Text(m.body, color = if (mine) Color.White else Color.Black)
                    }
                }
            }
        }
        if (job.isFinal) {
            Text(store.tr("chat.closed"), fontSize = 13.sp, color = Color.Gray, modifier = Modifier.padding(16.dp))
        } else {
            Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(text, { text = it }, placeholder = { Text(store.tr("chat.placeholder")) }, maxLines = 4, modifier = Modifier.weight(1f))
                SecondaryButton(store.tr("chat.sendBtn")) {
                    val t = text
                    if (t.isNotBlank()) scope.launch { if (store.send(job.id, t)) text = "" }
                }
            }
        }
    }
}

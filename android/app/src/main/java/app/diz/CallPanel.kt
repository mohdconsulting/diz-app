package app.diz

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Full-screen call overlay, drawn above everything (the chat included). */
@Composable
fun CallPanel(store: Store) {
    val m = store.calls
    val c = m.current ?: return
    Box(Modifier.fillMaxSize().background(Color(0x8C000000)).clickable(enabled = true) {}, contentAlignment = Alignment.Center) {
        Column(
            Modifier.padding(24.dp).widthIn(max = 360.dp).clip(RoundedCornerShape(20.dp)).background(DizBrand).padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("📞 " + store.tr("call.title") + " · " + m.peerLabel(c), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            Text(
                when (c.phase) {
                    CallPhase.CALLING -> store.tr("call.calling")
                    CallPhase.INCOMING -> store.tr("call.incoming")
                    CallPhase.CONNECTING -> store.tr("call.connecting")
                    CallPhase.ACTIVE -> "%d:%02d".format(m.seconds / 60, m.seconds % 60)
                },
                color = Color.White, fontSize = 24.sp,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (c.phase == CallPhase.INCOMING) {
                    CallButton("📞 " + store.tr("call.answer"), Color(0xFF2E9E4F)) { m.answer() }
                    CallButton("✖ " + store.tr("call.decline"), Color(0xFFD32F2F)) { m.decline() }
                } else {
                    if (c.phase == CallPhase.ACTIVE) {
                        CallButton((if (c.muted) "🔇 " else "🎙️ ") + store.tr(if (c.muted) "call.unmute" else "call.mute"), Color.Gray) { m.toggleMute() }
                        CallButton((if (c.speaker) "🔊 " else "🔈 ") + store.tr("call.speaker"), Color.Gray) { m.toggleSpeaker() }
                    }
                    CallButton(store.tr("call.hangUp"), Color(0xFFD32F2F)) { m.hangUp() }
                }
            }
            Text(store.tr("call.ipNote"), color = Color.White.copy(alpha = 0.7f), fontSize = 11.sp, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun CallButton(title: String, color: Color, onClick: () -> Unit) {
    Box(Modifier.clip(CircleShape).background(color).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp)) {
        Text(title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
    }
}

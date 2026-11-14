package app.diz

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

/** "New version available" notice that the admin switches on (table app_notice, see diz_app_notice.sql). */
class AppNotice(val active: Boolean, val androidLatest: String, val androidMin: String, val msgAr: String, val msgEn: String) {
    companion object {
        fun parse(o: JSONObject) = AppNotice(
            o.optBoolean("active", false), o.optString("android_latest", ""), o.optString("android_min", ""),
            o.optString("msg_ar", ""), o.optString("msg_en", ""),
        )
    }
}

object AppUpdate {
    /** True when [a] is older than [b] ("1.0" < "1.0.1" < "1.2"). */
    fun older(a: String, b: String): Boolean {
        val x = a.split(".").map { it.toIntOrNull() ?: 0 }
        val y = b.split(".").map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(x.size, y.size)) {
            val p = x.getOrElse(i) { 0 }; val q = y.getOrElse(i) { 0 }
            if (p != q) return p < q
        }
        return false
    }
}

@Composable
fun UpdateNotice(store: Store) {
    val n = store.appNotice ?: return
    if (!n.active) return
    val ctx = LocalContext.current
    val installed = remember { try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "0" } catch (_: Exception) { "0" } }
    val required = n.androidMin.isNotEmpty() && AppUpdate.older(installed, n.androidMin)
    val available = n.androidLatest.isNotEmpty() && AppUpdate.older(installed, n.androidLatest)
    if (!required && !(available && !store.updateDismissed)) return
    val custom = (if (store.lang == Lang.AR) n.msgAr else n.msgEn).trim()
    val openStore = {
        val pkg = ctx.packageName
        try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        catch (_: Exception) {
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
    val card: @Composable () -> Unit = {
        Column(
            Modifier.fillMaxWidth().padding(12.dp).shadow(6.dp).background(Color.White)
                .border(BorderStroke(2.dp, DizAmber)).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(store.tr("update.title"), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = DizInk)
            Text(custom.ifEmpty { store.tr(if (required) "update.requiredText" else "update.text") }, fontSize = 16.sp, color = DizMuted)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                PrimaryButton(store.tr("update.btn"), modifier = Modifier.weight(1f)) { openStore() }
                if (!required) TextButton(onClick = { store.updateDismissed = true }) {
                    Text(store.tr("update.later"), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = DizTeal2)
                }
            }
        }
    }
    if (required) {
        // Blocks the app underneath until the person has updated.
        Box(
            Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f))
                .clickable(interactionSource = MutableInteractionSource(), indication = null) {},
            contentAlignment = Alignment.Center,
        ) { card() }
    } else {
        Box(Modifier.fillMaxWidth().statusBarsPadding()) { card() }
    }
}

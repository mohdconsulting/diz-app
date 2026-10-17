package app.diz

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun App(store: Store) {
    val dir = if (store.lang.isRtl) LayoutDirection.Rtl else LayoutDirection.Ltr
    CompositionLocalProvider(LocalLayoutDirection provides dir) {
        DizTheme {
            Box(Modifier.fillMaxSize().background(Color.White)) {
                when {
                    store.restoring -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    store.user == null -> AuthScreen(store)
                    else -> {
                        MainTabs(store)
                        val chatJob = store.chatJobId?.let { id -> store.jobs.firstOrNull { it.id == id } }
                        if (chatJob != null) ChatScreen(store, chatJob)
                    }
                }
                ToastHost(store, Modifier.align(Alignment.BottomCenter))
                CallPanel(store)
            }
        }
    }
}

@Composable
private fun MainTabs(store: Store) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val driver = store.isDriver
    val tabs = if (driver) listOf("💼" to "tabs.jobs", "✅" to "mineTitleDriver", "🕘" to "tabs.history", "👤" to "tabs.mine")
    else listOf("➕" to "tabs.new", "📋" to "mineTitleCustomer", "🕘" to "tabs.history", "👤" to "tabs.mine")
    val unread = store.messages.count { it.recipientPhone == store.myPhone && it.readAt == null }

    Column(Modifier.fillMaxSize().systemBarsPadding()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (tab) {
                0 -> if (driver) OpenJobsScreen(store) else NewRequestScreen(store)
                1 -> MyJobsScreen(store)
                2 -> HistoryScreen(store)
                else -> ProfileScreen(store)
            }
        }
        NavigationBar(containerColor = Color.White) {
            tabs.forEachIndexed { i, (icon, key) ->
                NavigationBarItem(
                    selected = tab == i, onClick = { tab = i },
                    icon = { Text(if (i == 1 && unread > 0) "$icon $unread" else icon, fontSize = 20.sp) },
                    label = { Text(store.tr(key), fontSize = 11.sp, maxLines = 1) },
                )
            }
        }
    }
}

@Composable
fun ProfileScreen(store: Store) {
    var confirmDelete by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val u = store.user
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(store.tr("tabs.mine"), fontSize = 22.sp, fontWeight = FontWeight.Bold)
        if (u != null) {
            Card {
                Text(u.name, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                Text(u.phone, color = Color.Gray)
                Text(store.tr(if (u.isDriver) "roleDriver" else "roleCustomer"), color = Color.Gray)
                if (u.isDriver && u.profiles.isNotEmpty()) {
                    Text(u.profiles.joinToString(", ") {
                        if (it == "driver") store.tr("profileDriver") else if (it == "towing") store.tr("profileTowing") else store.tr("services.pro.categories.$it")
                    }, fontSize = 13.sp, color = Color.Gray)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Lang.values().forEach { l -> Chip(l.title, store.lang == l) { store.changeLang(l) } }
        }
        if (store.isDriver && store.locationDenied) Footnote(store.tr("track.shareDenied"), DizDanger)
        LinkButton(store.tr("account.privacy")) { openUrl(context, Config.PRIVACY_URL) }
        PrimaryButton(store.tr("logoutBtn"), danger = true) { store.logout() }
        LinkButton(store.tr("account.deleteBtn"), danger = true) { confirmDelete = true }
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(store.tr("account.deleteTitle")) },
            text = { Text(store.tr("account.deleteMsg")) },
            confirmButton = { TextButton(onClick = { confirmDelete = false; store.deleteAccount() }) { Text(store.tr("account.deleteConfirm"), color = DizDanger) } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(store.tr("cancelBtn")) } },
        )
    }
}

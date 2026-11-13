package app.diz

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.clickable
import androidx.compose.runtime.remember
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
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
    var showAuth by rememberSaveable { mutableStateOf(false) }
    // A successful login or registration closes the sign-in screen.
    LaunchedEffect(store.user?.id) { if (store.user != null) showAuth = false }
    CompositionLocalProvider(LocalLayoutDirection provides dir) {
        DizTheme {
            Box(Modifier.fillMaxSize().background(DizPaper)) {
                when {
                    store.restoring -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = DizBrand) }
                    else -> {
                        MainTabs(store, onLogin = { showAuth = true })
                        val chatJob = store.chatJobId?.let { id -> store.jobs.firstOrNull { it.id == id } }
                        if (chatJob != null) ChatScreen(store, chatJob)
                        if (showAuth && store.user == null) {
                            BackHandler { showAuth = false }
                            AuthScreen(store, onClose = { showAuth = false })
                        }
                    }
                }
                ToastHost(store, Modifier.align(Alignment.BottomCenter))
                CallPanel(store)
            }
        }
    }
}

/** Guests browse freely (Home, New request, Profile); an account is only needed to send an order. */
@Composable
private fun MainTabs(store: Store, onLogin: () -> Unit) {
    var tab by rememberSaveable { mutableStateOf("home") }
    LaunchedEffect(store.user?.id) { tab = "home" }
    LaunchedEffect(store.tabRequest) { store.tabRequest?.let { tab = it; store.tabRequest = null } }
    val guest = store.user == null
    val driver = store.isDriver
    val unread = store.messages.count { it.recipientPhone == store.myPhone && it.readAt == null }

    // id, icon, label key
    val tabs: List<Triple<String, String, String>> = when {
        guest -> listOf(Triple("home", "🏠", "tabs.home"), Triple("new", "➕", "tabs.new"), Triple("profile", "👤", "tabs.mine"))
        driver -> listOf(
            Triple("home", "🏠", "tabs.home"), Triple("open", "💼", "tabs.jobs"), Triple("mine", "✅", "mineTitleDriver"),
            Triple("history", "🕘", "tabs.history"), Triple("profile", "👤", "tabs.mine"),
        )
        else -> listOf(
            Triple("home", "🏠", "tabs.home"), Triple("new", "➕", "tabs.new"), Triple("mine", "📋", "mineTitleCustomer"),
            Triple("history", "🕘", "tabs.history"), Triple("profile", "👤", "tabs.mine"),
        )
    }
    val current = if (tabs.any { it.first == tab }) tab else "home"

    Column(Modifier.fillMaxSize()) {
        if (current != "home") {
            TopBar(store.tr(when (current) {
                "new" -> "titles.new"
                "open" -> "titles.jobs"
                "mine" -> if (driver) "mineTitleDriver" else "mineTitleCustomer"
                "history" -> "titles.history"
                else -> "tabs.mine"
            }))
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (current) {
                "home" -> HomeScreen(store) { tab = if (driver) "open" else "new" }
                "new" -> NewRequestScreen(store, onLogin)
                "open" -> OpenJobsScreen(store)
                "mine" -> MyJobsScreen(store)
                "history" -> HistoryScreen(store)
                else -> ProfileScreen(store, onLogin)
            }
        }
        HorizontalDivider(color = DizLine)
        NavigationBar(containerColor = Color.White, tonalElevation = 0.dp) {
            tabs.forEach { (id, icon, key) ->
                NavigationBarItem(
                    selected = current == id, onClick = { tab = id },
                    icon = { Text(if (id == "mine" && unread > 0) "$icon $unread" else icon, fontSize = 20.sp) },
                    label = { Text(store.tr(key), fontSize = 11.sp, maxLines = 1, fontWeight = FontWeight.SemiBold) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedTextColor = DizBrand, unselectedTextColor = DizMuted, indicatorColor = DizSoft,
                    ),
                )
            }
        }
    }
}

/** Home tab like the web app: teal hero with the main call to action, two counters and the latest requests. */
@Composable
fun HomeScreen(store: Store, onStart: () -> Unit) {
    val mine = store.jobs.filter { j ->
        if (store.isDriver) j.acceptedByPhone == store.myPhone || j.applicants.any { it.phone == store.myPhone }
        else j.ownerPhone == store.myPhone
    }
    val active = mine.count { !it.isFinal }
    val done = mine.count { it.status == "done" }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Column(
            Modifier.fillMaxWidth().background(DizBrand).statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                androidx.compose.foundation.layout.Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.background(DizAmber, androidx.compose.foundation.shape.CircleShape).padding(3.5.dp))
                    Text(store.tr("brand"), color = Color.White.copy(alpha = 0.9f), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                }
                LangPills(store)
            }
            Text(store.tr("heroTitle"), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp))
            Text(store.tr("heroText"), color = DizHeroText, fontSize = 14.sp, modifier = Modifier.padding(bottom = 8.dp))
            Box(
                Modifier.fillMaxWidth().background(DizAmber).clickable(onClick = onStart).padding(vertical = 13.dp),
                contentAlignment = Alignment.Center,
            ) { Text(store.tr(if (store.isDriver) "tabs.jobs" else "heroBtn"), color = DizInk, fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }
            if (store.user != null) {
                androidx.compose.foundation.layout.Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    Stat(active, store.tr("statActiveLabel"))
                    Stat(done, store.tr("statDoneLabel"))
                }
            }
        }
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (store.user != null) {
                SectionTitle(store.tr("recentTitle"))
                if (mine.isEmpty()) EmptyBox(store.tr("emptyHome")) else mine.take(3).forEach { JobCard(store, it) }
            } else {
                Footnote(store.tr("guest.hint"))
            }
        }
    }
}

@Composable
private fun Stat(n: Int, label: String) {
    Column {
        Text("$n", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        Text(label, color = Color(0xFFA9C3BA), fontSize = 12.5.sp)
    }
}

@Composable
fun ProfileScreen(store: Store, onLogin: () -> Unit) {
    var confirmDelete by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val u = store.user
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (u == null) {
            Card {
                Footnote(store.tr("guest.hint"))
                PrimaryButton(store.tr("guest.signIn")) { onLogin() }
            }
        } else {
            Card {
                Text(u.name, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                Text(u.phone, color = DizMuted, fontSize = 14.sp)
                Text(store.tr(if (u.isDriver) "roleDriver" else "roleCustomer"), color = DizMuted, fontSize = 14.sp)
                if (u.isDriver && u.profiles.isNotEmpty()) {
                    Text(u.profiles.joinToString(", ") {
                        if (it == "driver") store.tr("profileDriver") else if (it == "towing") store.tr("profileTowing") else store.tr("services.pro.categories.$it")
                    }, fontSize = 12.5.sp, color = DizMuted)
                }
            }
        }
        if (u != null && u.isDriver) AvatarCard(store)
        if (u != null && u.role != "admin") AccountDetailsCard(store)
        if (u != null && u.isDriver) DocumentsCard(store)
        LangPills(store, light = true)
        if (store.isDriver && store.locationDenied) Footnote(store.tr("track.shareDenied"), DizDanger)
        LinkButton(store.tr("account.privacy")) { openUrl(context, Config.PRIVACY_URL) }
        if (u != null) {
            PrimaryButton(store.tr("logoutBtn"), danger = true) { store.logout() }
            PrimaryButton(store.tr("account.deleteBtn"), danger = true) { confirmDelete = true }
        }
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            containerColor = Color.White,
            title = { Text(store.tr("account.deleteTitle")) },
            text = { Text(store.tr("account.deleteMsg")) },
            confirmButton = { TextButton(onClick = { confirmDelete = false; store.deleteAccount() }) { Text(store.tr("account.deleteConfirm"), color = DizDanger) } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(store.tr("cancelBtn")) } },
        )
    }
}

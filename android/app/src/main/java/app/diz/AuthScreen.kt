package app.diz

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val proCats = listOf("electrician", "plumber", "smith", "carpenter", "appliance_repair", "ac_fridge", "cleaner", "carpet_cleaning", "painter", "pest_control")

/** Sign in / register, shown over the app when the user chooses to log in (e.g. to send an order). */
@Composable
fun AuthScreen(store: Store, onClose: () -> Unit) {
    var registering by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var forgot by remember { mutableStateOf(false) }
    var resetSent by remember { mutableStateOf(false) }
    var role by remember { mutableStateOf("customer") }
    var profiles by remember { mutableStateOf(setOf<String>()) }

    Box(Modifier.fillMaxSize().background(DizPaper).systemBarsPadding()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Spacer8()
                LinkButton(store.tr("guest.close")) { onClose() }
            }
            Column(
                Modifier.fillMaxWidth().background(Color.White).border(1.dp, DizLine).padding(22.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.background(DizAmber, CircleShape).padding(3.5.dp))
                    Text("دز  Diz", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = DizBrand)
                }
                if (forgot) {
                    // "Forgot password": the e-mailed link opens the web app, where the new password is chosen.
                    LangPills(store, light = true)
                    Text(store.tr("forgotTitle"), fontSize = 21.sp, fontWeight = FontWeight.SemiBold)
                    Text(store.tr("forgotText"), color = DizMuted, fontSize = 13.5.sp)
                    DigitField(phone, { phone = it }, store.tr("authPhoneLabel"), phone = true)
                    PrimaryButton(store.tr("forgotSend"), enabled = !store.busy) { store.requestPasswordReset(phone) { resetSent = true } }
                    if (resetSent) Text(store.tr("forgotSent"), color = DizBrand, fontSize = 13.sp)
                    LinkButton(store.tr("forgotBack")) { forgot = false; resetSent = false }
                    return@Column
                }
                Text(store.tr(if (registering) "authSubtitleRegister" else "authSubtitleLogin"), color = DizMuted, fontSize = 13.5.sp)
                LangPills(store, light = true)
                Text(store.tr(if (registering) "authTitleRegister" else "authTitleLogin"), fontSize = 21.sp, fontWeight = FontWeight.SemiBold)

                if (registering) {
                    OutlinedTextField(name, { name = it }, label = { Text(store.tr("authNameLabel")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                }
                DigitField(phone, { phone = it }, store.tr("authPhoneLabel"), phone = true)
                if (registering) EmailField(email, { email = it }, store.tr("authEmailLabel"))
                OutlinedTextField(
                    password, { password = it }, label = { Text(store.tr("authPassLabel")) }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )

                if (registering) {
                    FieldLabel(store.tr("authRoleLabel"))
                    ChipRow {
                        Chip(store.tr("roleCustomer"), role == "customer") { role = "customer" }
                        Chip(store.tr("roleDriver"), role == "driver") { role = "driver" }
                    }
                    if (role == "driver") {
                        FieldLabel(store.tr("authProfileLabel"))
                        ProfileRow(store.tr("profileDriver"), "driver" in profiles) { profiles = profiles.toggle("driver") }
                        ProfileRow(store.tr("profileTowing"), "towing" in profiles) { profiles = profiles.toggle("towing") }
                        proCats.forEach { c -> ProfileRow(store.tr("services.pro.categories.$c"), c in profiles) { profiles = profiles.toggle(c) } }
                        Footnote(store.tr("authShareNote"))
                    }
                }

                PrimaryButton(store.tr(if (registering) "authSubmitRegister" else "authSubmitLogin"), enabled = !store.busy) {
                    if (registering) store.register(name, phone, email, password, role, if (role == "driver") profiles.sorted() else emptyList())
                    else store.login(phone, password)
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(store.tr(if (registering) "authSwitchTextRegister" else "authSwitchTextLogin"), color = DizMuted, fontSize = 14.sp)
                    LinkButton(store.tr(if (registering) "authSwitchBtnRegister" else "authSwitchBtnLogin")) { registering = !registering }
                }
                if (!registering) LinkButton(store.tr("forgotLink")) { forgot = true; resetSent = false }
            }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.Spacer8() {
    Box(Modifier.weight(1f))
}

private fun Set<String>.toggle(k: String): Set<String> = if (k in this) this - k else this + k

@Composable
private fun ProfileRow(title: String, on: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(if (on) DizBrand else Color.White).border(1.dp, if (on) DizBrand else DizLine)
            .clickable(onClick = onClick).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(if (on) "☑" else "☐", color = if (on) Color.White else DizInk)
        Text(title, color = if (on) Color.White else DizInk, fontSize = 14.sp)
    }
}

/** E-mail field (always left-to-right, e-mail keyboard). */
@Composable
fun EmailField(value: String, onChange: (String) -> Unit, label: String) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
        OutlinedTextField(
            value, { onChange(it.trim()) }, label = { Text(label) }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** E-mail used for password reset. Shown in the profile, and on the home screen while the account has none. */
@Composable
fun EmailEditCard(store: Store, nudge: Boolean = false) {
    var email by remember(store.user?.id) { mutableStateOf(store.user?.email ?: "") }
    Card {
        Text(store.tr(if (nudge) "emailNudge" else "authEmailLabel"), color = if (nudge) DizInk else DizMuted, fontSize = 13.sp)
        EmailField(email, { email = it }, store.tr("authEmailLabel"))
        PrimaryButton(store.tr(if (nudge) "emailNudgeBtn" else "accountSaveBtn"), enabled = !store.busy) { store.saveEmail(email) }
    }
}

/** Profile page: e-mail and, for providers, skills (job types they see), saved with one button like on the web. */
@Composable
fun AccountDetailsCard(store: Store) {
    val u = store.user ?: return
    var email by remember(u.id) { mutableStateOf(u.email ?: "") }
    var picked by remember(u.id) { mutableStateOf(u.profiles.toSet()) }
    Card {
        EmailField(email, { email = it }, store.tr("authEmailLabel"))
        if (u.isDriver) {
            FieldLabel(store.tr("profileEditTitle"))
            ProfileRow(store.tr("profileDriver"), "driver" in picked) { picked = picked.toggle("driver") }
            ProfileRow(store.tr("profileTowing"), "towing" in picked) { picked = picked.toggle("towing") }
            proCats.forEach { c -> ProfileRow(store.tr("services.pro.categories.$c"), c in picked) { picked = picked.toggle(c) } }
        }
        PrimaryButton(store.tr("accountSaveBtn"), enabled = !store.busy) {
            store.saveDetails(email, if (u.isDriver) picked.sorted() else null)
        }
    }
}

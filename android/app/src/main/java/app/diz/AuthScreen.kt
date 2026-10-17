package app.diz

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val proCats = listOf("electrician", "plumber", "gardener", "painter", "cleaner")

@Composable
fun AuthScreen(store: Store) {
    var registering by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("customer") }
    var profiles by remember { mutableStateOf(setOf<String>()) }

    Column(
        Modifier.fillMaxSize().systemBarsPadding().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("دز  Diz", fontSize = 34.sp, fontWeight = FontWeight.Bold, color = DizBrand)
        Text(store.tr(if (registering) "authSubtitleRegister" else "authSubtitleLogin"), color = Color.Gray)

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Lang.values().forEach { l -> Chip(l.title, store.lang == l) { store.changeLang(l) } }
        }

        Text(store.tr(if (registering) "authTitleRegister" else "authTitleLogin"), fontSize = 22.sp, fontWeight = FontWeight.Bold)

        if (registering) {
            OutlinedTextField(name, { name = it }, label = { Text(store.tr("authNameLabel")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
        DigitField(phone, { phone = it }, store.tr("authPhoneLabel"), phone = true)
        OutlinedTextField(
            password, { password = it }, label = { Text(store.tr("authPassLabel")) }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )

        if (registering) {
            Text(store.tr("authRoleLabel"), fontSize = 13.sp, color = Color.Gray)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip(store.tr("roleCustomer"), role == "customer") { role = "customer" }
                Chip(store.tr("roleDriver"), role == "driver") { role = "driver" }
            }
            if (role == "driver") {
                Text(store.tr("authProfileLabel"), fontSize = 13.sp, color = Color.Gray)
                ProfileRow(store.tr("profileDriver"), "driver" in profiles) { profiles = profiles.toggle("driver") }
                ProfileRow(store.tr("profileTowing"), "towing" in profiles) { profiles = profiles.toggle("towing") }
                proCats.forEach { c -> ProfileRow(store.tr("services.pro.categories.$c"), c in profiles) { profiles = profiles.toggle(c) } }
                Text(store.tr("authShareNote"), fontSize = 13.sp, color = Color.Gray)
            }
        }

        PrimaryButton(store.tr(if (registering) "authSubmitRegister" else "authSubmitLogin"), enabled = !store.busy) {
            if (registering) store.register(name, phone, password, role, if (role == "driver") profiles.sorted() else emptyList())
            else store.login(phone, password)
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(store.tr(if (registering) "authSwitchTextRegister" else "authSwitchTextLogin"), color = Color.Gray, fontSize = 14.sp)
            LinkButton(store.tr(if (registering) "authSwitchBtnRegister" else "authSwitchBtnLogin")) { registering = !registering }
        }
    }
}

private fun Set<String>.toggle(k: String): Set<String> = if (k in this) this - k else this + k

@Composable
private fun ProfileRow(title: String, on: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = on, onCheckedChange = { onClick() })
        Text(title)
    }
}

package app.diz

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/** New request: services, categories, sizes and schedule are chips like the web app. Guests can fill it in; an account is
 *  needed only when the order is sent. */
@Composable
fun NewRequestScreen(store: Store, onLogin: () -> Unit) {
    var picked by rememberSaveable { mutableStateOf(false) }
    var service by rememberSaveable { mutableStateOf("junk") }
    var cat by remember { mutableStateOf<String?>(null) }
    var size by remember { mutableStateOf<Int?>(null) }
    var desc by remember { mutableStateOf("") }
    var addr by remember { mutableStateOf("") }
    var toAddr by remember { mutableStateOf("") }
    var custom by remember { mutableStateOf(false) }
    var customPrice by remember { mutableStateOf("") }
    var schedule by remember { mutableStateOf(ScheduleChoice()) }
    val scope = rememberCoroutineScope()

    val info = Strings.service(service)
    val estimate = Pricing.price(service, size, cat)
    val finalPrice = if (custom) customPrice.intValue else estimate

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        SectionTitle(store.tr("serviceSelectTitle"))
        ChipRow {
            Strings.services.forEach { s ->
                Chip(store.tr("services.${s.key}.label"), picked && s.key == service) {
                    service = s.key; cat = null; size = null; picked = true
                }
            }
        }

        if (picked && info != null) {
            FieldLabel(store.tr("services.$service.categoryLabel"))
            ChipRow {
                info.categories.forEach { c ->
                    Chip(store.tr("services.$service.categories.$c"), cat == c) { cat = if (cat == c) null else c }
                }
            }
            OutlinedTextField(desc, { desc = it }, placeholder = { Text(store.tr("services.$service.descPlaceholder"), fontSize = 14.sp) },
                minLines = 3, maxLines = 6, modifier = Modifier.fillMaxWidth())
            FieldLabel(store.tr("services.$service.sizeLabel"))
            ChipRow {
                info.sizes.forEach { n ->
                    Chip(store.tr("services.$service.sizes.$n"), size == n) { size = if (size == n) null else n }
                }
            }
            FieldLabel(store.tr("services.$service.addrLabel"))
            OutlinedTextField(addr, { addr = it }, placeholder = { Text(store.tr("services.$service.addrPlaceholder"), fontSize = 14.sp) },
                singleLine = true, modifier = Modifier.fillMaxWidth())
            if (info.needsToAddr) {
                FieldLabel(store.tr("services.$service.toAddrLabel"))
                OutlinedTextField(toAddr, { toAddr = it }, placeholder = { Text(store.tr("services.$service.toAddrPlaceholder"), fontSize = 14.sp) },
                    singleLine = true, modifier = Modifier.fillMaxWidth())
            }

            ScheduleSection(store, schedule) { schedule = it }
            CashBanner(store.tr("cash.formText"), store.tr("cash.formTitle"))

            Row(
                Modifier.fillMaxWidth().background(DizSoft).border(1.dp, DizBrand).padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(store.tr("estimateLabel"), fontSize = 14.sp)
                    Text(store.tr(if (custom) "estimateSubCustom" else "estimateSub"), fontSize = 11.5.sp, color = DizMuted)
                }
                Text(if (custom) (if (customPrice.isEmpty()) "–" else store.money(finalPrice)) else store.money(estimate),
                    fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
            ChipRow { Chip(store.tr("customPriceChipLabel"), custom) { custom = !custom } }
            if (custom) DigitField(customPrice, { customPrice = it }, store.tr("customPriceLabel"))

            PrimaryButton(store.tr(if (store.user == null) "guest.submit" else "submitBtn"), enabled = !store.busy) {
                if (store.user == null) { onLogin(); return@PrimaryButton }
                scope.launch {
                    val ok = store.createJob(service, cat, size, desc, addr, toAddr, finalPrice, schedule)
                    if (ok) {
                        desc = ""; addr = ""; toAddr = ""; cat = null; size = null; custom = false; customPrice = ""
                        schedule = ScheduleChoice(); picked = false
                    }
                }
            }
        }
    }
}

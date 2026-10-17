package app.diz

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import kotlinx.coroutines.launch

@Composable
fun NewRequestScreen(store: Store) {
    var service by remember { mutableStateOf("junk") }
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

    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(store.tr("titles.new"), fontSize = 22.sp, fontWeight = FontWeight.Bold)

        Text(store.tr("serviceSelectTitle"), fontWeight = FontWeight.Bold)
        Strings.services.forEach { s ->
            Row(
                Modifier.fillMaxWidth().clickable { service = s.key; cat = null; size = null }.padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(store.tr("services.${s.key}.label"), modifier = Modifier.weight(1f))
                if (s.key == service) Text("✓", color = DizBrand, fontWeight = FontWeight.Bold)
            }
        }

        if (info != null) {
            DropdownField(store.tr("services.$service.categoryLabel"), info.categories, cat, { store.tr("services.$service.categories.$it") }) { cat = it }
            DropdownField(store.tr("services.$service.sizeLabel"), info.sizes, size, { store.tr("services.$service.sizes.$it") }) { size = it }
            OutlinedTextField(desc, { desc = it }, label = { Text(store.tr("services.$service.descPlaceholder")) }, minLines = 3, maxLines = 6, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(addr, { addr = it }, label = { Text(store.tr("services.$service.addrLabel")) },
                placeholder = { Text(store.tr("services.$service.addrPlaceholder")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            if (info.needsToAddr) {
                OutlinedTextField(toAddr, { toAddr = it }, label = { Text(store.tr("services.$service.toAddrLabel")) },
                    placeholder = { Text(store.tr("services.$service.toAddrPlaceholder")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
        }

        ScheduleSection(store, schedule) { schedule = it }
        CashBanner(store.tr("cash.formText"), store.tr("cash.formTitle"))

        Text(store.tr("estimateLabel"), fontWeight = FontWeight.Bold)
        if (custom) {
            DigitField(customPrice, { customPrice = it }, store.tr("customPriceLabel"))
            Text(store.tr("estimateSubCustom"), fontSize = 13.sp, color = Color.Gray)
        } else {
            Text(store.money(estimate), fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Text(store.tr("estimateSub"), fontSize = 13.sp, color = Color.Gray)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(store.tr("customPriceChipLabel"), modifier = Modifier.weight(1f))
            Switch(checked = custom, onCheckedChange = { custom = it })
        }

        PrimaryButton(store.tr("submitBtn"), enabled = !store.busy) {
            scope.launch {
                val ok = store.createJob(service, cat, size, desc, addr, toAddr, finalPrice, schedule)
                if (ok) { desc = ""; addr = ""; toAddr = ""; cat = null; size = null; custom = false; customPrice = ""; schedule = ScheduleChoice() }
            }
        }
    }
}

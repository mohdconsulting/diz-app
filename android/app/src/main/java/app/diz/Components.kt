package app.diz

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val DizBrand = Color(0xFF2B5A52)
val DizCard = Color(0xFFF2F2F7)
val DizWarn = Color(0xFFE08A00)
val DizDanger = Color(0xFFC62828)

@Composable
fun DizTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = androidx.compose.material3.lightColorScheme(
            primary = DizBrand, onPrimary = Color.White, secondary = DizBrand, background = Color.White, surface = Color.White,
            error = DizDanger,
        ),
        content = content,
    )
}

@Composable
fun Card(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(DizCard).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) { content() }
}

@Composable
fun PrimaryButton(title: String, modifier: Modifier = Modifier, danger: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = enabled, modifier = modifier.fillMaxWidth(),
        colors = ButtonDefaults.buttonColors(containerColor = if (danger) DizDanger else DizBrand),
    ) { Text(title, fontWeight = FontWeight.SemiBold) }
}

@Composable
fun SecondaryButton(title: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, modifier = modifier, border = BorderStroke(1.dp, DizBrand)) { Text(title, color = DizBrand) }
}

@Composable
fun LinkButton(title: String, danger: Boolean = false, onClick: () -> Unit) {
    TextButton(onClick = onClick) { Text(title, fontSize = 13.sp, color = if (danger) DizDanger else DizBrand) }
}

@Composable
fun Footnote(text: String, color: Color = Color.Gray, bold: Boolean = false) {
    Text(text, fontSize = 13.sp, color = color, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal)
}

@Composable
fun Stars(rating: Double) {
    Row {
        for (i in 1..5) Text(if (i <= Math.round(rating)) "★" else "☆", color = DizWarn, fontSize = 18.sp)
    }
}

@Composable
fun StarPicker(value: Int, onChange: (Int) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for (i in 1..5) Text(if (i <= value) "★" else "☆", color = DizWarn, fontSize = 30.sp, modifier = Modifier.clickable { onChange(i) })
    }
}

@Composable
fun RatingBadge(store: Store, phone: String) {
    val r = store.ratings[phone]
    if (r != null) Text("★ " + "%.1f".format(java.util.Locale.US, r.avg) + " (${r.count})", fontSize = 12.sp, color = DizWarn)
    else Text(store.tr("review.noReviewsYet"), fontSize = 12.sp, color = Color.Gray)
}

/** Highlighted note: payment is cash, directly between customer and provider. */
@Composable
fun CashBanner(text: String, title: String? = null) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(DizBrand.copy(alpha = 0.12f))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        if (title != null) Text("💵 $title", fontWeight = FontWeight.Bold, fontSize = 14.sp)
        Text(text, fontSize = 13.sp)
    }
}

/** Number field for phone numbers and prices: only digits (plus "+" and space for phones) are kept; Arabic-Indic digits
 *  from an Arabic keyboard are converted to 0–9 as they are typed. Always left-to-right. */
@Composable
fun DigitField(value: String, onChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, phone: Boolean = false) {
    OutlinedTextField(
        value = value,
        onValueChange = { raw -> onChange(raw.asciiDigits().filter { it in '0'..'9' || (phone && (it == '+' || it == ' ')) }) },
        label = { Text(label) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = if (phone) androidx.compose.ui.text.input.KeyboardType.Phone else androidx.compose.ui.text.input.KeyboardType.Number),
        textStyle = TextStyle(textDirection = TextDirection.Ltr),
        modifier = modifier.fillMaxWidth(),
    )
}

/** Simple dropdown: shows the selected option's label; null selection shows "—". */
@Composable
fun <T> DropdownField(label: String, options: List<T>, selected: T?, optionLabel: (T) -> String, onSelect: (T?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        Text(label, fontSize = 13.sp, color = Color.Gray)
        Box {
            OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(10.dp)) {
                Text(if (selected == null) "—" else optionLabel(selected), modifier = Modifier.weight(1f), color = Color.Black)
                Text("▾", color = Color.Gray)
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                DropdownMenuItem(text = { Text("—") }, onClick = { onSelect(null); open = false })
                options.forEach { o -> DropdownMenuItem(text = { Text(optionLabel(o)) }, onClick = { onSelect(o); open = false }) }
            }
        }
    }
}

@Composable
fun Chip(text: String, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.clip(CircleShape).background(if (on) DizBrand else Color(0x1F767680)).clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) { Text(text, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = if (on) Color.White else Color.Black) }
}

@Composable
fun ToastHost(store: Store, modifier: Modifier = Modifier) {
    val t = store.toastText
    if (t != null) {
        Box(modifier.fillMaxWidth().padding(bottom = 90.dp), contentAlignment = Alignment.BottomCenter) {
            Text(
                t, color = Color.White, fontSize = 14.sp,
                modifier = Modifier.clip(RoundedCornerShape(22.dp)).background(Color(0xD9000000)).padding(horizontal = 16.dp, vertical = 10.dp),
            )
        }
    }
}

fun openMapsQuery(context: Context, query: String) {
    runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(query))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

fun openMapsPoint(context: Context, lat: Double, lng: Double) {
    runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:$lat,$lng?q=$lat,$lng(Diz)")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

fun openUrl(context: Context, url: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

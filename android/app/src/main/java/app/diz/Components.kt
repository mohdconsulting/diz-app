package app.diz

import androidx.compose.ui.unit.Density
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.runtime.CompositionLocalProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Shapes
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Colours from the web app (--ink, --teal, --teal-2, --amber, --paper, --line, --muted, --danger).
val DizInk = Color(0xFF17211D)
val DizBrand = Color(0xFF1C3D37)
val DizTeal2 = Color(0xFF2C5A51)
val DizAmber = Color(0xFFE5A13A)
val DizPaper = Color(0xFFF6F4EE)
val DizLine = Color(0xFFD8D3C6)
val DizMuted = Color(0xFF6B7570)
val DizDanger = Color(0xFFB3462F)
val DizSoft = Color(0xFFEAF3F1)
val DizCard = Color.White
val DizWarn = Color(0xFFC98A00)
val DizHeroText = Color(0xFFCFE0DA)

@Composable
fun DizTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = androidx.compose.material3.lightColorScheme(
            primary = DizBrand, onPrimary = Color.White, secondary = DizTeal2, background = DizPaper, onBackground = DizInk,
            surface = Color.White, onSurface = DizInk, onSurfaceVariant = DizMuted, outline = DizLine, outlineVariant = DizLine,
            error = DizDanger,
        ),
        // The web design has no rounded corners.
        shapes = Shapes(
            extraSmall = RoundedCornerShape(0.dp), small = RoundedCornerShape(0.dp), medium = RoundedCornerShape(0.dp),
            large = RoundedCornerShape(0.dp), extraLarge = RoundedCornerShape(0.dp),
        ),
        content = {
            // All text ~12 % larger than the system setting (on top of the user's own font-size choice).
            val d = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(d.density, d.fontScale * 1.12f), content = content)
        },
    )
}

/** White card with a thin border (web: .card). */
@Composable
fun Card(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier.fillMaxWidth().background(DizCard).border(1.dp, DizLine).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) { content() }
}

/** Amber filled button (web: button.primary); `danger` gives the outlined red variant. */
@Composable
fun PrimaryButton(title: String, modifier: Modifier = Modifier, danger: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = enabled, modifier = modifier.fillMaxWidth(), shape = RectangleShape,
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 13.dp),
        border = if (danger) BorderStroke(1.dp, DizDanger) else null,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (danger) Color.White else DizAmber, contentColor = if (danger) DizDanger else DizInk,
            disabledContainerColor = (if (danger) Color.White else DizAmber).copy(alpha = 0.5f),
            disabledContentColor = (if (danger) DizDanger else DizInk).copy(alpha = 0.6f),
        ),
    ) { Text(title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, textAlign = TextAlign.Center) }
}

@Composable
fun SecondaryButton(title: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick, modifier = modifier, shape = RectangleShape, border = BorderStroke(1.dp, DizBrand),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 9.dp),
    ) { Text(title, color = DizBrand, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
}

@Composable
fun LinkButton(title: String, danger: Boolean = false, onClick: () -> Unit) {
    TextButton(onClick = onClick) { Text(title, fontSize = 13.sp, color = if (danger) DizDanger else DizTeal2) }
}

@Composable
fun Footnote(text: String, color: Color = DizMuted, bold: Boolean = false) {
    Text(text, fontSize = 13.sp, color = color, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal)
}

/** Small grey section heading (web: .section-title). */
@Composable
fun SectionTitle(text: String) {
    Text(text, fontSize = 12.5.sp, color = DizMuted, fontWeight = FontWeight.SemiBold)
}

/** Field label (web: label). */
@Composable
fun FieldLabel(text: String) {
    Text(text, fontSize = 12.5.sp, color = DizMuted, modifier = Modifier.fillMaxWidth())
}

/** Small bordered status label (web: .status). */
@Composable
fun StatusBadge(text: String, color: Color = DizTeal2, dashed: Boolean = false) {
    Text(
        text, fontSize = 11.5.sp, color = color,
        modifier = Modifier.then(if (dashed) Modifier.dashedBorder(color) else Modifier.border(1.dp, color))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

fun Modifier.dashedBorder(color: Color): Modifier = this.drawBehind {
    drawRect(color, style = Stroke(width = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f))))
}

/** Dashed empty-state box (web: .empty). */
@Composable
fun EmptyBox(text: String) {
    Box(Modifier.fillMaxWidth().dashedBorder(DizLine).padding(horizontal = 18.dp, vertical = 26.dp), contentAlignment = Alignment.Center) {
        Text(text, fontSize = 14.sp, color = DizMuted, textAlign = TextAlign.Center)
    }
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
    else Text(store.tr("review.noReviewsYet"), fontSize = 12.sp, color = DizMuted)
}

/** Highlighted note: payment is cash, directly between customer and provider. */
@Composable
fun CashBanner(text: String, title: String? = null) {
    Column(
        Modifier.fillMaxWidth().background(DizSoft).border(1.dp, DizBrand).padding(horizontal = 12.dp, vertical = 10.dp),
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

/** Selectable square chip (web: .chip / .chip.on). */
@Composable
fun Chip(text: String, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.background(if (on) DizBrand else Color.White).border(1.dp, if (on) DizBrand else DizLine)
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp),
    ) { Text(text, fontSize = 13.sp, color = if (on) Color.White else DizInk) }
}

/** Wrapping row of chips (web: .chip-row). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChipRow(content: @Composable () -> Unit) {
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
}

/** AR / EN selector. `light` = for the paper background, otherwise for the teal hero. */
@Composable
fun LangPills(store: Store, light: Boolean = false) {
    Row(Modifier.border(1.dp, if (light) DizBrand else Color.White.copy(alpha = 0.8f))) {
        Lang.selectable.forEach { l ->
            val on = store.lang == l
            Box(
                Modifier.defaultMinSize(minWidth = 44.dp)
                    .background(if (on) DizAmber else if (light) Color.White else Color.White.copy(alpha = 0.12f))
                    .clickable { store.changeLang(l) }.padding(horizontal = 6.dp, vertical = 7.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(l.title, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = if (on) DizInk else if (light) DizBrand else Color.White)
            }
        }
    }
}

/** Teal title bar (web: header.topbar) for the tabs other than Home. */
@Composable
fun TopBar(title: String) {
    Box(Modifier.fillMaxWidth().background(DizBrand).statusBarsPadding().padding(horizontal = 16.dp, vertical = 14.dp), contentAlignment = Alignment.Center) {
        Text(title, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun ToastHost(store: Store, modifier: Modifier = Modifier) {
    val t = store.toastText
    if (t != null) {
        Box(modifier.fillMaxWidth().padding(bottom = 90.dp), contentAlignment = Alignment.BottomCenter) {
            Text(
                t, color = Color.White, fontSize = 13.5.sp, textAlign = TextAlign.Center,
                modifier = Modifier.background(DizInk).padding(horizontal = 18.dp, vertical = 10.dp),
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

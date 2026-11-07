package app.diz

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Provider profile: documents for verification (ID, licence, certificate …), images or PDF up to 10 MB.
 *  Files go to the private Storage bucket provider-docs; only the provider and admin can read them. */
@Composable
fun DocumentsCard(store: Store) {
    val context = LocalContext.current
    var kind by remember { mutableStateOf("id") }
    fun kindLabel(k: String) = store.tr(when (k) { "id" -> "docs.kId"; "license" -> "docs.kLicense"; "certificate" -> "docs.kCertificate"; else -> "docs.kOther" })

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val resolver = context.contentResolver
        val mime = resolver.getType(uri) ?: ""
        var name = "document"
        var size = -1L
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getString(0)?.let { name = it }
                if (!c.isNull(1)) size = c.getLong(1)
            }
        }
        if (size > Store.MAX_DOC_BYTES) { store.toast("docs.tooBig"); return@rememberLauncherForActivityResult }
        val bytes = try { resolver.openInputStream(uri)?.use { it.readBytes() } } catch (e: Exception) { null }
        if (bytes == null) { store.toast("toastSaveFailed"); return@rememberLauncherForActivityResult }
        store.uploadDoc(kind, bytes, name, mime)
    }

    LaunchedEffect(store.user?.id) { store.loadMyDocs() }

    Card {
        FieldLabel(store.tr("docs.title"))
        Text(store.tr("docs.hint"), fontSize = 12.5.sp, color = DizMuted)
        if (store.myDocs.isEmpty()) Footnote(store.tr("docs.empty"))
        store.myDocs.forEach { doc ->
            Row(
                Modifier.fillMaxWidth().border(1.dp, DizLine).padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(kindLabel(doc.kind), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = DizBrand)
                    Text(doc.fileName, fontSize = 13.sp, color = DizInk, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                LinkButton(store.tr("docs.remove"), danger = true) { if (!store.busy) store.deleteDoc(doc) }
            }
        }
        FieldLabel(store.tr("docs.kindLabel"))
        ChipRow { Store.DOC_KINDS.forEach { k -> Chip(kindLabel(k), kind == k) { kind = k } } }
        PrimaryButton(store.tr(if (store.busy) "docs.uploading" else "docs.upload"), enabled = !store.busy) {
            picker.launch(arrayOf("image/*", "application/pdf"))
        }
    }
}

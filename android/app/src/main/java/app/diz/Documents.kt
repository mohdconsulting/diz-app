package app.diz

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File

/** Provider profile: ID document for verification. The provider can take a photo or choose one or more
 *  images/PDFs; uploads start right away. Files go to the private Storage bucket provider-docs. */
@Composable
fun DocumentsCard(store: Store) {
    val context = LocalContext.current
    var cameraUri by remember { mutableStateOf<Uri?>(null) }

    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = cameraUri
        if (ok && uri != null) readDocFile(context, uri)?.let { store.uploadDocs(listOf(it)) }
    }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val list = uris.mapNotNull { readDocFile(context, it) }
        if (uris.isNotEmpty() && list.isEmpty()) store.toast("docs.badType") else store.uploadDocs(list)
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
                Text("📄 " + doc.fileName, Modifier.weight(1f), fontSize = 13.sp, color = DizInk, maxLines = 1, overflow = TextOverflow.Ellipsis)
                LinkButton(store.tr("docs.remove"), danger = true) { if (!store.busy) store.deleteDoc(doc) }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryButton(store.tr("docs.takePhoto"), Modifier.weight(1f), enabled = !store.busy) {
                val dir = File(context.cacheDir, "camera").apply { mkdirs() }
                val file = File(dir, "id-${System.currentTimeMillis()}.jpg")
                val uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
                cameraUri = uri
                try { camera.launch(uri) } catch (e: Exception) { store.toast("toastSaveFailed") }
            }
            PrimaryButton(store.tr("docs.chooseFiles"), Modifier.weight(1f), enabled = !store.busy) {
                files.launch(arrayOf("image/*", "application/pdf"))
            }
        }
        store.docProgress?.let { Footnote(it) }
    }
}

/** Reads a chosen/photographed file. Images are scaled to at most 2000 px and sent as JPEG (keeps them well under 10 MB). */
private fun readDocFile(context: Context, uri: Uri): Store.DocFile? {
    val resolver = context.contentResolver
    val mime = resolver.getType(uri) ?: ""
    var name = "photo.jpg"
    try {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0)?.let { name = it }
        }
    } catch (_: Exception) {}
    val bytes = try { resolver.openInputStream(uri)?.use { it.readBytes() } } catch (e: Exception) { null } ?: return null
    if (mime == "application/pdf") return Store.DocFile(bytes, name, mime)
    val jpeg = toJpeg(bytes) ?: return null
    return Store.DocFile(jpeg, name.substringBeforeLast('.') + ".jpg", "image/jpeg")
}

private fun toJpeg(bytes: ByteArray, maxSide: Int = 2000): ByteArray? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
    val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    val scale = minOf(1f, maxSide.toFloat() / maxOf(bmp.width, bmp.height))
    val out = if (scale < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true) else bmp
    return ByteArrayOutputStream().use { s -> out.compress(Bitmap.CompressFormat.JPEG, 85, s); s.toByteArray() }
}

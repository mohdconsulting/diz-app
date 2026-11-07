package app.diz

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File

/** Job photos are stored like on the web: a JPEG data URL (max 800 px wide, quality 60) in jobs.photo. */
object JobPhoto {
    fun dataUrl(context: Context, uri: Uri, maxWidth: Int = 800): String? {
        val bytes = try { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } } catch (e: Exception) { null } ?: return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0) return null
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= maxWidth) sample *= 2
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val scale = minOf(1f, maxWidth.toFloat() / bmp.width)
        val out = if (scale < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt().coerceAtLeast(1), (bmp.height * scale).toInt().coerceAtLeast(1), true) else bmp
        val jpeg = ByteArrayOutputStream().use { s -> out.compress(Bitmap.CompressFormat.JPEG, 60, s); s.toByteArray() }
        return "data:image/jpeg;base64," + Base64.encodeToString(jpeg, Base64.NO_WRAP)
    }

    fun bitmap(dataUrl: String?): Bitmap? {
        if (dataUrl == null || !dataUrl.startsWith("data:image")) return null
        val comma = dataUrl.indexOf(',').takeIf { it > 0 } ?: return null
        return try {
            val bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (e: Exception) { null }
    }
}

/** Shows a job photo (if any). */
@Composable
fun JobPhotoImage(dataUrl: String?, heightDp: Int) {
    val bmp = remember(dataUrl) { JobPhoto.bitmap(dataUrl) } ?: return
    Image(bmp.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop,
        modifier = Modifier.fillMaxWidth().height(heightDp.dp).border(1.dp, DizLine))
}

/** "Photo (optional)" on the request form: take a photo or choose one; preview with "Remove photo". */
@Composable
fun JobPhotoField(store: Store, photo: String?, onChange: (String?) -> Unit) {
    val context = LocalContext.current
    var cameraUri by remember { mutableStateOf<Uri?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = cameraUri
        if (ok && uri != null) JobPhoto.dataUrl(context, uri)?.let(onChange) ?: store.toast("toastSaveFailed")
    }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) JobPhoto.dataUrl(context, uri)?.let(onChange) ?: store.toast("toastSaveFailed")
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FieldLabel(store.tr("photoLabel"))
        if (photo != null) {
            JobPhotoImage(photo, 180)
            LinkButton(store.tr("removePhotoBtn"), danger = true) { onChange(null) }
        } else {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryButton(store.tr("docs.takePhoto"), Modifier.weight(1f)) {
                    val dir = File(context.cacheDir, "camera").apply { mkdirs() }
                    val uri = FileProvider.getUriForFile(context, context.packageName + ".files", File(dir, "job-${System.currentTimeMillis()}.jpg"))
                    cameraUri = uri
                    try { camera.launch(uri) } catch (e: Exception) { store.toast("toastSaveFailed") }
                }
                SecondaryButton(store.tr("photoChooseBtn"), Modifier.weight(1f)) {
                    gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }
            }
        }
    }
}

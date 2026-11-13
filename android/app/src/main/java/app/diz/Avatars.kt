package app.diz

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.LruCache
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.TimeUnit

/** Profile photos (diz_provider_avatar.sql): public files in the Storage bucket "avatars", loaded and cached here. */
object AvatarImages {
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
    private val cache = LruCache<String, ImageBitmap>(60)

    fun cached(url: String): ImageBitmap? = cache.get(url)

    suspend fun load(url: String): ImageBitmap? = cache.get(url) ?: withContext(Dispatchers.IO) {
        try {
            http.newCall(Request.Builder().url(url).build()).execute().use { res ->
                if (!res.isSuccessful) return@withContext null
                val bytes = res.body?.bytes() ?: return@withContext null
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()?.also { cache.put(url, it) }
            }
        } catch (e: Exception) { null }
    }

    /** Square JPEG (side × side), cropped from the middle and turned the right way up. */
    fun squareJpeg(bytes: ByteArray, side: Int = 512): ByteArray? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= side) sample *= 2
        var bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val rotation = try {
            when (ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        } catch (e: Exception) { 0f }
        if (rotation != 0f) bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(rotation) }, true)
        val s = minOf(bmp.width, bmp.height)
        val cropped = Bitmap.createBitmap(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s)
        val out = if (s != side) Bitmap.createScaledBitmap(cropped, side, side, true) else cropped
        return ByteArrayOutputStream().use { o -> out.compress(Bitmap.CompressFormat.JPEG, 85, o); o.toByteArray() }
    }
}

/** Round profile photo, or the first letter of the name while there is none (or it is loading). */
@Composable
fun Avatar(url: String?, name: String, size: Dp = 44.dp) {
    var img by remember(url) { mutableStateOf(url?.let { AvatarImages.cached(it) }) }
    LaunchedEffect(url) { if (url != null && img == null) img = AvatarImages.load(url) }
    Box(Modifier.size(size).clip(CircleShape).background(DizLine), contentAlignment = Alignment.Center) {
        val bmp = img
        if (bmp != null) Image(bmp, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(size))
        else Text(name.trim().take(1).uppercase(), fontSize = (size.value * 0.42f).sp, fontWeight = FontWeight.Bold, color = DizMuted)
    }
}

/** Provider profile: required profile photo (front camera or a saved image). Customers see it with offers. */
@Composable
fun AvatarCard(store: Store) {
    val context = LocalContext.current
    var cameraFile by remember { mutableStateOf<File?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val f = cameraFile
        if (ok && f != null) {
            val bytes = try { f.readBytes() } catch (e: Exception) { null }
            f.delete()
            bytes?.let { store.uploadAvatar(it) } ?: store.toast("avatar.badType")
        }
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) readBytes(context, uri)?.let { store.uploadAvatar(it) } ?: store.toast("avatar.badType")
    }
    val u = store.user ?: return
    val has = !u.avatarUrl.isNullOrEmpty()
    Card {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(u.avatarUrl, u.name, 88.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    FieldLabel(store.tr("avatar.title"))
                    if (!has) Text(store.tr("avatar.required"), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.background(DizDanger, RoundedCornerShape(10.dp)).padding(horizontal = 8.dp, vertical = 1.dp))
                }
                Text(store.tr("avatar.hint"), fontSize = 12.5.sp, color = DizMuted)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryButton(store.tr("avatar.takePhoto"), Modifier.weight(1f), enabled = !store.busy) {
                val dir = File(context.cacheDir, "camera").apply { mkdirs() }
                val file = File(dir, "avatar-${System.currentTimeMillis()}.jpg")
                cameraFile = file
                val uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
                try { camera.launch(uri) } catch (e: Exception) { store.toast("toastSaveFailed") }
            }
            PrimaryButton(store.tr(if (has) "avatar.change" else "avatar.choose"), Modifier.weight(1f), enabled = !store.busy) {
                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }
        }
    }
}

/** Banner for providers without a photo: opens the profile tab. */
@Composable
fun PhotoNudge(store: Store) {
    if (!store.providerMissingPhoto) return
    Card {
        Text(store.tr("avatar.nudge"), fontSize = 14.sp, color = DizInk)
        SecondaryButton(store.tr("avatar.nudgeBtn")) { store.tabRequest = "profile" }
    }
}

private fun readBytes(context: Context, uri: Uri): ByteArray? =
    try { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } } catch (e: Exception) { null }

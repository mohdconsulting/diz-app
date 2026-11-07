package app.diz

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import kotlin.coroutines.resume

/**
 * Push notifications via Firebase Cloud Messaging. The server side is diz_push.sql + Edge Function send-push.
 * Firebase is started from assets/google-services.json (no Gradle plugin needed). Without that file the app
 * works as before, just without push.
 */
object Push {
    const val CHANNEL = "diz"
    private const val PREFS = "push"

    /** Starts Firebase if assets/google-services.json is present. Returns true when push is available. */
    fun init(context: Context): Boolean {
        if (FirebaseApp.getApps(context).isNotEmpty()) return true
        val raw = try { context.assets.open("google-services.json").bufferedReader().use { it.readText() } } catch (e: Exception) { return false }
        return try {
            val j = JSONObject(raw)
            val project = j.getJSONObject("project_info")
            val clients = j.getJSONArray("client")
            var client = clients.getJSONObject(0)
            for (i in 0 until clients.length()) {
                val c = clients.getJSONObject(i)
                if (c.getJSONObject("client_info").getJSONObject("android_client_info").optString("package_name") == context.packageName) client = c
            }
            val options = FirebaseOptions.Builder()
                .setProjectId(project.getString("project_id"))
                .setGcmSenderId(project.getString("project_number"))
                .setApplicationId(client.getJSONObject("client_info").getString("mobilesdk_app_id"))
                .setApiKey(client.getJSONArray("api_key").getJSONObject(0).getString("current_key"))
                .build()
            FirebaseApp.initializeApp(context, options)
            true
        } catch (e: Exception) { false }
    }

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Diz", NotificationManager.IMPORTANCE_HIGH).apply { setShowBadge(true) })
    }

    /** Current FCM token, or null when push is not set up. */
    suspend fun token(context: Context): String? {
        if (!init(context)) return null
        return suspendCancellableCoroutine { cont ->
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { cont.resume(it) }
                .addOnFailureListener { cont.resume(null) }
        }
    }

    fun savedToken(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("token", null)
    fun saveToken(context: Context, t: String) { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("token", t).apply() }

    /** Clears the notifications (and with them the number on the app icon). */
    fun clear(context: Context) { NotificationManagerCompat.from(context).cancelAll() }

    /** Shows a notification ourselves (used when the app is in the foreground; otherwise Android shows it). */
    fun show(context: Context, title: String, body: String, badge: Int) {
        val open = PendingIntent.getActivity(context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setNumber(badge)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(open)
            .build()
        try { NotificationManagerCompat.from(context).notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), n) } catch (_: SecurityException) {}
    }
}

/** Starts Firebase (if configured) and the notification channel when the app process starts. */
class DizApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Push.init(this)
        Push.createChannel(this)
    }
}

class DizMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        Push.saveToken(this, token)   // Store registers it with Supabase at the next start/login
    }
    override fun onMessageReceived(message: RemoteMessage) {
        val n = message.notification ?: return
        Push.show(this, n.title ?: "Diz", n.body ?: "", message.data["badge"]?.toIntOrNull() ?: 1)
    }
}

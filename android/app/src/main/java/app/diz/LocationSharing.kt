package app.diz

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import androidx.core.content.ContextCompat

/** Shares the provider's position (foreground only) for accepted jobs until arrival, like src/tracking.ts.
 *  Uses the "while in use" location permission, so sharing pauses when the app is not on screen. */
class LocationSharing(private val context: Context) : LocationListener {
    private val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private var ids: Set<String> = emptySet()
    private var lastSent = 0L
    private var running = false
    private var asked = false

    /** (jobId, lat, lng, accuracy) -> success. Returning false drops the job from sharing. Suspends, called from [scope]. */
    var onFix: (suspend (String, Double, Double, Double?) -> Boolean)? = null
    var launch: ((suspend () -> Unit) -> Unit)? = null
    var onDenied: ((Boolean) -> Unit)? = null
    /** Set by the activity: shows the system permission dialog. */
    var requestPermission: (() -> Unit)? = null

    private fun granted() = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun update(jobIds: Set<String>) {
        ids = jobIds
        if (ids.isEmpty()) { stopUpdates(); return }
        if (granted()) { onDenied?.invoke(false); startUpdates() }
        else if (!asked) { asked = true; requestPermission?.invoke() }
        else onDenied?.invoke(true)
    }

    /** Called by the activity with the result of the permission dialog. */
    fun onPermissionResult(ok: Boolean) {
        onDenied?.invoke(!ok)
        if (ok && ids.isNotEmpty()) startUpdates()
    }

    fun drop(id: String) { ids = ids - id; if (ids.isEmpty()) stopUpdates() }
    fun stop() { ids = emptySet(); stopUpdates() }

    @SuppressLint("MissingPermission")
    private fun startUpdates() {
        if (running || !granted()) return
        running = true
        lastSent = 0L
        for (p in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            try { if (manager.isProviderEnabled(p)) manager.requestLocationUpdates(p, 5000L, 10f, this, Looper.getMainLooper()) } catch (e: Exception) { /* provider unavailable */ }
        }
    }

    private fun stopUpdates() {
        if (!running) return
        running = false
        try { manager.removeUpdates(this) } catch (e: Exception) { /* ignore */ }
    }

    // ---- LocationListener ----
    override fun onLocationChanged(loc: Location) {
        val now = System.currentTimeMillis()
        if (ids.isEmpty() || now - lastSent < Config.LOCATION_SEND_SECONDS * 1000) return
        lastSent = now
        val acc: Double? = if (loc.hasAccuracy()) loc.accuracy.toDouble() else null
        val snapshot = ids
        launch?.invoke {
            for (id in snapshot) {
                val ok = onFix?.invoke(id, loc.latitude, loc.longitude, acc) ?: false
                if (!ok) drop(id)
            }
        }
    }
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}
    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
}

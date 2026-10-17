package app.diz

import android.view.ViewGroup
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import java.io.File

/** Customer's live view of the provider's position (polled every few seconds by the Store). */
@Composable
fun TrackingBlock(store: Store, job: Job) {
    var showMap by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val loc = store.locations[job.id]
    if (loc == null) {
        Text(store.tr("track.notSharing"), fontSize = 13.sp, color = Color.Gray)
        return
    }
    val ageSec = maxOf(0L, System.currentTimeMillis() / 1000 - loc.updatedAt / 1000).toInt()
    Column {
        Text(store.tr("track.onTheWay"), fontSize = 13.sp, fontWeight = FontWeight.Bold)
        Text(store.tr("track.ago", mapOf("t" to if (ageSec < 60) "$ageSec " + store.tr("track.sec") else "${ageSec / 60} " + store.tr("track.min"))), fontSize = 12.sp, color = Color.Gray)
        if (ageSec > 120) Text(store.tr("track.stale"), fontSize = 12.sp, color = DizWarn)
        LinkButton(store.tr(if (showMap) "track.hideMap" else "track.showMap")) { showMap = !showMap }
        if (showMap) {
            AndroidView(
                factory = { ctx ->
                    Configuration.getInstance().apply {
                        userAgentValue = ctx.packageName
                        osmdroidBasePath = File(ctx.cacheDir, "osmdroid")
                        osmdroidTileCache = File(ctx.cacheDir, "osmdroid/tiles")
                    }
                    MapView(ctx).apply {
                        setTileSource(TileSourceFactory.MAPNIK)
                        setMultiTouchControls(true)
                        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                        controller.setZoom(15.0)
                    }
                },
                update = { map ->
                    val p = GeoPoint(loc.lat, loc.lng)
                    map.overlays.clear()
                    map.overlays.add(Marker(map).apply { position = p; setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM) })
                    map.controller.setCenter(p)
                    map.invalidate()
                },
                modifier = Modifier.fillMaxWidth().height(220.dp).clip(RoundedCornerShape(10.dp)),
            )
        }
        LinkButton(store.tr("openInMaps")) { openMapsPoint(context, loc.lat, loc.lng) }
    }
}

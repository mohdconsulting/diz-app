package app.diz

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels

class MainActivity : ComponentActivity() {
    private val store: Store by viewModels()
    private var micCallback: ((Boolean) -> Unit)? = null

    private val locationPermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r ->
        store.sharing.onPermissionResult(r.values.any { it })
    }
    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        micCallback?.invoke(ok); micCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        store.sharing.requestPermission = {
            locationPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        }
        store.calls.micRequester = { cb -> micCallback = cb; micPermission.launch(Manifest.permission.RECORD_AUDIO) }
        store.calls.engine.attachTo(this)
        setContent { App(store) }
    }
}

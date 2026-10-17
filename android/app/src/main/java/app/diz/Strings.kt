package app.diz

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

enum class Lang(val code: String, val title: String, val isRtl: Boolean) {
    AR("ar", "AR", true), SV("sv", "SV", false), EN("en", "EN", false);

    val locale: Locale get() = Locale(code)

    companion object { fun from(code: String?): Lang = values().firstOrNull { it.code == code } ?: AR }
}

data class ServiceInfo(val key: String, val needsToAddr: Boolean, val categories: List<String>, val sizes: List<Int>)

/** Texts come from assets/strings.json, generated from src/i18n.ts by scripts/gen-android-strings.mjs, so the Android app
 *  uses exactly the same wording as the web app. assets/extra.json holds the few texts that exist only in the apps. */
object Strings {
    private var table: Map<String, Map<String, String>> = emptyMap()
    private var extra: Map<String, Map<String, String>> = emptyMap()
    var services: List<ServiceInfo> = emptyList()
        private set

    fun init(context: Context) {
        if (table.isNotEmpty()) return
        fun read(name: String): String = context.assets.open(name).bufferedReader(Charsets.UTF_8).use { it.readText() }
        val root = JSONObject(read("strings.json"))
        table = root.keys().asSequence().associateWith { lang ->
            val o = root.getJSONObject(lang)
            o.keys().asSequence().associateWith { o.getString(it) }
        }
        val ex = JSONObject(read("extra.json"))
        extra = ex.keys().asSequence().associateWith { k ->
            val o = ex.getJSONObject(k)
            o.keys().asSequence().associateWith { o.getString(it) }
        }
        val cat = JSONArray(read("catalog.json"))
        services = (0 until cat.length()).map { i ->
            val o = cat.getJSONObject(i)
            ServiceInfo(
                o.getString("key"), o.optBoolean("needsToAddr"),
                o.getJSONArray("categories").let { a -> (0 until a.length()).map { a.getString(it) } },
                o.getJSONArray("sizes").let { a -> (0 until a.length()).map { a.getInt(it) } },
            )
        }
    }

    /** Looks up a text; `{name}` placeholders are replaced from [vars]. Falls back to Swedish, then to the key. */
    fun text(key: String, lang: Lang, vars: Map<String, String> = emptyMap()): String {
        var s = extra[key]?.get(lang.code) ?: table[lang.code]?.get(key) ?: table["sv"]?.get(key) ?: extra[key]?.get("sv") ?: key
        for ((k, v) in vars) s = s.replace("{$k}", v)
        return s
    }

    fun service(key: String): ServiceInfo? = services.firstOrNull { it.key == key }
}

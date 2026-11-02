# Diz release shrinking/obfuscation rules (R8)

# The WebView call bridge: the JS side calls DzBridge.post(...), so the annotated method names must survive.
-keepattributes JavascriptInterface, *Annotation*, Signature, InnerClasses, EnclosingMethod
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Crash reports stay readable with the mapping file that is uploaded with the AAB.
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile

# OkHttp / Okio: optional platform classes that are not on Android.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# osmdroid looks up some of its tile sources and providers by name.
-keep class org.osmdroid.** { *; }
-dontwarn org.osmdroid.**

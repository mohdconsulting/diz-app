import SwiftUI

@main
struct DizApp: App {
    @StateObject private var store = Store()
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    init() { DizTheme.apply() }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(.light)
                // Text two steps larger than the system default (but still follows a larger accessibility setting).
                .dynamicTypeSize(.xxLarge ... .accessibility5)
                .environment(\.layoutDirection, store.lang.isRTL ? .rightToLeft : .leftToRight)
                .task { await store.restore() }
                .onChange(of: scenePhase) { phase in
                    if phase == .active { Task { await store.appBecameActive() } }
                }
        }
    }
}

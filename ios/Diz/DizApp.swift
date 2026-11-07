import SwiftUI

@main
struct DizApp: App {
    @StateObject private var store = Store()

    init() { DizTheme.apply() }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(.light)
                // Text one step larger than the system default (but still follows a larger accessibility setting).
                .dynamicTypeSize(.xLarge ... .accessibility5)
                .environment(\.layoutDirection, store.lang.isRTL ? .rightToLeft : .leftToRight)
                .task { await store.restore() }
        }
    }
}

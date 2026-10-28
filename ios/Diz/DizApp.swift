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
                .environment(\.layoutDirection, store.lang.isRTL ? .rightToLeft : .leftToRight)
                .task { await store.restore() }
        }
    }
}

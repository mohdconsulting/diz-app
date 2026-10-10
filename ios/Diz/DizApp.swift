import SwiftUI

@main
struct DizApp: App {
    @StateObject private var store = Store()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environment(\.layoutDirection, store.lang.isRTL ? .rightToLeft : .leftToRight)
                .environment(\.locale, store.lang.locale)
                .task { await store.restore() }
        }
    }
}

import SwiftUI

@main
struct DizApp: App {
    @StateObject private var store = Store()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environment(\.layoutDirection, store.lang.isRTL ? .rightToLeft : .leftToRight)
                .task { await store.restore() }
        }
    }
}

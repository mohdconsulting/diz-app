import SwiftUI

struct RootView: View {
    @EnvironmentObject var store: Store

    var body: some View {
        ZStack(alignment: .bottom) {
            if store.restoring {
                ProgressView()
            } else if store.user == nil {
                AuthView()
            } else {
                MainTabs()
            }
            ToastView()
        }
        .animation(.easeInOut(duration: 0.2), value: store.toastText)
    }
}

struct MainTabs: View {
    @EnvironmentObject var store: Store

    var body: some View {
        TabView {
            if store.isDriver {
                NavigationStack { OpenJobsView() }
                    .tabItem { Label(store.tr("tabs.jobs"), systemImage: "briefcase") }
                NavigationStack { MyJobsView() }
                    .tabItem { Label(store.tr("mineTitleDriver"), systemImage: "checkmark.circle") }
                    .badge(store.messages.filter { $0.recipientPhone == store.myPhone && $0.readAt == nil }.count)
            } else {
                NavigationStack { NewRequestView() }
                    .tabItem { Label(store.tr("tabs.new"), systemImage: "plus.circle") }
                NavigationStack { MyJobsView() }
                    .tabItem { Label(store.tr("mineTitleCustomer"), systemImage: "list.bullet") }
                    .badge(store.messages.filter { $0.recipientPhone == store.myPhone && $0.readAt == nil }.count)
            }
            NavigationStack { HistoryView() }
                .tabItem { Label(store.tr("tabs.history"), systemImage: "clock") }
            NavigationStack { ProfileView() }
                .tabItem { Label(store.tr("tabs.mine"), systemImage: "person") }
        }
        .tint(.dizBrand)
    }
}

struct ProfileView: View {
    @EnvironmentObject var store: Store

    var body: some View {
        Form {
            if let u = store.user {
                Section {
                    Text(u.name).font(.headline)
                    Text(u.phone).foregroundColor(.secondary)
                    Text(u.isDriver ? store.tr("roleDriver") : store.tr("roleCustomer")).foregroundColor(.secondary)
                    if u.isDriver && !u.profiles.isEmpty {
                        Text(u.profiles.map { $0 == "driver" ? store.tr("profileDriver") : ($0 == "towing" ? store.tr("profileTowing") : store.tr("services.pro.categories.\($0)")) }.joined(separator: ", "))
                            .font(.footnote).foregroundColor(.secondary)
                    }
                }
            }
            Section {
                Picker("", selection: $store.lang) {
                    ForEach(Lang.allCases) { Text($0.title).tag($0) }
                }.pickerStyle(.segmented)
            }
            if store.isDriver && store.locationDenied {
                Section { Text(store.tr("track.shareDenied")).font(.footnote).foregroundColor(.red) }
            }
            Section {
                Button(role: .destructive) { store.logout() } label: { Text(store.tr("logoutBtn")) }
            }
        }
        .navigationTitle(store.tr("tabs.mine"))
    }
}

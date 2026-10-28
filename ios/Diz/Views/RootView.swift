import SwiftUI

struct RootView: View {
    @EnvironmentObject var store: Store

    var body: some View {
        ZStack(alignment: .bottom) {
            if store.restoring {
                ProgressView()
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
    @State private var tab = "home"

    private var unread: Int { store.messages.filter { $0.recipientPhone == store.myPhone && $0.readAt == nil }.count }

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack { HomeView(onStart: { tab = store.isDriver ? "open" : "new" }) }
                .tabItem { Label(store.tr("tabs.home"), systemImage: "house") }.tag("home")
            if store.user == nil {
                // Guest: browse services and prices freely; an account is only needed to send an order.
                NavigationStack { NewRequestView() }
                    .tabItem { Label(store.tr("tabs.new"), systemImage: "plus") }.tag("new")
            } else if store.isDriver {
                NavigationStack { OpenJobsView() }
                    .tabItem { Label(store.tr("tabs.jobs"), systemImage: "briefcase") }.tag("open")
                NavigationStack { MyJobsView() }
                    .tabItem { Label(store.tr("mineTitleDriver"), systemImage: "checkmark.circle") }.tag("mine")
                    .badge(unread)
            } else {
                NavigationStack { NewRequestView() }
                    .tabItem { Label(store.tr("tabs.new"), systemImage: "plus") }.tag("new")
                NavigationStack { MyJobsView() }
                    .tabItem { Label(store.tr("mineTitleCustomer"), systemImage: "list.bullet") }.tag("mine")
                    .badge(unread)
            }
            if store.user != nil {
                NavigationStack { HistoryView() }
                    .tabItem { Label(store.tr("tabs.history"), systemImage: "clock") }.tag("history")
            }
            NavigationStack { ProfileView() }
                .tabItem { Label(store.tr("tabs.mine"), systemImage: "person") }.tag("profile")
        }
        .tint(.dizBrand)
        .onChange(of: store.user?.id) { _ in tab = "home" }
    }
}

struct ProfileView: View {
    @EnvironmentObject var store: Store
    @State private var confirmDelete = false
    @State private var showAuth = false

    var body: some View {
        Form {
            if store.user == nil {
                Section {
                    Text(store.tr("guest.hint")).font(.footnote).foregroundColor(.secondary)
                    PrimaryButton(title: store.tr("guest.signIn")) { showAuth = true }
                }
            }
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
                Link(store.tr("account.privacy"), destination: Config.privacyURL)
            }
            if store.user != nil {
                Section {
                    PrimaryButton(title: store.tr("logoutBtn"), role: .destructive) { store.logout() }
                    PrimaryButton(title: store.tr("account.deleteBtn"), role: .destructive) { confirmDelete = true }
                }
            }
        }
        .sheet(isPresented: $showAuth) { AuthView(closable: true) }
        .navigationTitle(store.tr("tabs.mine"))
        .dizScreen()
        .alert(store.tr("account.deleteTitle"), isPresented: $confirmDelete) {
            Button(store.tr("account.deleteConfirm"), role: .destructive) { Task { _ = await store.deleteAccount() } }
            Button(store.tr("cancelBtn"), role: .cancel) {}
        } message: {
            Text(store.tr("account.deleteMsg"))
        }
    }
}

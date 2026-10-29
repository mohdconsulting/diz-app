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
            NavigationStack { HomeView(onStart: { tab = store.isDriver ? "open" : "new" }) }.id(store.lang)
                .tabItem { Label(store.tr("tabs.home"), systemImage: "house") }.tag("home")
            if store.user == nil {
                // Guest: browse services and prices freely; an account is only needed to send an order.
                NavigationStack { NewRequestView() }.id(store.lang)
                    .tabItem { Label(store.tr("tabs.new"), systemImage: "plus") }.tag("new")
            } else if store.isDriver {
                NavigationStack { OpenJobsView() }.id(store.lang)
                    .tabItem { Label(store.tr("tabs.jobs"), systemImage: "briefcase") }.tag("open")
                NavigationStack { MyJobsView() }.id(store.lang)
                    .tabItem { Label(store.tr("mineTitleDriver"), systemImage: "checkmark.circle") }.tag("mine")
                    .badge(unread)
            } else {
                NavigationStack { NewRequestView() }.id(store.lang)
                    .tabItem { Label(store.tr("tabs.new"), systemImage: "plus") }.tag("new")
                NavigationStack { MyJobsView() }.id(store.lang)
                    .tabItem { Label(store.tr("mineTitleCustomer"), systemImage: "list.bullet") }.tag("mine")
                    .badge(unread)
            }
            if store.user != nil {
                NavigationStack { HistoryView() }.id(store.lang)
                    .tabItem { Label(store.tr("tabs.history"), systemImage: "clock") }.tag("history")
            }
            NavigationStack { ProfileView() }.id(store.lang)
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
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if store.user == nil {
                    Card {
                        Text(store.tr("guest.hint")).font(.system(size: 13)).foregroundColor(.dizMuted)
                        PrimaryButton(title: store.tr("guest.signIn")) { showAuth = true }
                    }
                }
                if let u = store.user {
                    Card {
                        Text(u.name).font(.system(size: 17, weight: .semibold)).foregroundColor(.dizInk)
                        Text(u.phone).font(.system(size: 14)).foregroundColor(.dizMuted)
                        Text(u.isDriver ? store.tr("roleDriver") : store.tr("roleCustomer"))
                            .font(.system(size: 14)).foregroundColor(.dizMuted)
                        if u.isDriver && !u.profiles.isEmpty {
                            Text(u.profiles.map { $0 == "driver" ? store.tr("profileDriver") : ($0 == "towing" ? store.tr("profileTowing") : store.tr("services.pro.categories.\($0)")) }.joined(separator: ", "))
                                .font(.system(size: 12.5)).foregroundColor(.dizMuted)
                        }
                    }
                }
                HStack { LangPills(light: true); Spacer() }
                if store.isDriver && store.locationDenied {
                    Text(store.tr("track.shareDenied")).font(.system(size: 13)).foregroundColor(.dizDanger)
                }
                Link(store.tr("account.privacy"), destination: Config.privacyURL)
                    .font(.system(size: 14, weight: .semibold)).foregroundColor(.dizTeal2)
                if store.user != nil {
                    PrimaryButton(title: store.tr("logoutBtn"), role: .destructive) { store.logout() }
                    PrimaryButton(title: store.tr("account.deleteBtn"), role: .destructive) { confirmDelete = true }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
        }
        .navigationTitle(store.tr("tabs.mine"))
        .dizScreen()
        .sheet(isPresented: $showAuth) { AuthView(closable: true) }
        .alert(store.tr("account.deleteTitle"), isPresented: $confirmDelete) {
            Button(store.tr("account.deleteConfirm"), role: .destructive) { Task { _ = await store.deleteAccount() } }
            Button(store.tr("cancelBtn"), role: .cancel) {}
        } message: {
            Text(store.tr("account.deleteMsg"))
        }
    }
}

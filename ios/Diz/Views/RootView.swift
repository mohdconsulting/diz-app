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
            updateOverlay
            ToastView()
        }
        .animation(.easeInOut(duration: 0.2), value: store.toastText)
    }

    /// Update notice from the admin: a banner with "Later", or a blocking screen below the minimum version.
    @ViewBuilder private var updateOverlay: some View {
        switch AppUpdate.state(store.appNotice, lang: store.lang) {
        case .required(let msg):
            ZStack {
                Color.black.opacity(0.45).ignoresSafeArea()
                UpdateBanner(message: msg, required: true, onLater: {})
            }
        case .available(let msg):
            if !store.updateDismissed {
                VStack { UpdateBanner(message: msg, required: false) { store.updateDismissed = true }; Spacer() }
            }
        case .none:
            EmptyView()
        }
    }
}

struct MainTabs: View {
    @EnvironmentObject var store: Store
    @State private var tab = "home"

    private var unread: Int { store.messages.filter { $0.recipientPhone == store.myPhone && $0.readAt == nil }.count }

    /// The tabs that exist for the current user; a selection that no longer exists falls back to Home.
    private var validTabs: Set<String> {
        if store.user == nil { return ["home", "new", "profile"] }
        if store.isDriver { return ["home", "open", "mine", "history", "profile"] }
        return ["home", "new", "mine", "history", "profile"]
    }
    private var selection: Binding<String> {
        Binding(get: { validTabs.contains(tab) ? tab : "home" }, set: { tab = $0 })
    }

    var body: some View {
        TabView(selection: selection) {
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
        .onChange(of: store.tabRequest) { req in
            guard let req else { return }
            tab = req
            store.tabRequest = nil
        }
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
                        Text(store.tr("guest.hint")).font(.system(size: 16.5)).foregroundColor(.dizMuted)
                        PrimaryButton(title: store.tr("guest.signIn")) { showAuth = true }
                    }
                }
                if let u = store.user {
                    Card {
                        Text(u.name).font(.system(size: 22, weight: .semibold)).foregroundColor(.dizInk)
                        Text(u.phone).font(.system(size: 18)).foregroundColor(.dizMuted)
                        Text(u.isDriver ? store.tr("roleDriver") : store.tr("roleCustomer"))
                            .font(.system(size: 18)).foregroundColor(.dizMuted)
                        if u.isDriver && !u.profiles.isEmpty {
                            Text(u.profiles.map { $0 == "driver" ? store.tr("profileDriver") : ($0 == "towing" ? store.tr("profileTowing") : store.tr("services.pro.categories.\($0)")) }.joined(separator: ", "))
                                .font(.system(size: 16)).foregroundColor(.dizMuted)
                        }
                    }
                }
                if store.isDriver { AvatarCard() }
                if store.user != nil && store.user?.role != "admin" { AccountDetailsCard() }
                if store.isDriver { DocumentsCard() }
                HStack { LangPills(light: true); Spacer() }
                if store.isDriver && store.locationDenied {
                    Text(store.tr("track.shareDenied")).font(.system(size: 16.5)).foregroundColor(.dizDanger)
                }
                Link(store.tr("account.privacy"), destination: Config.privacyURL)
                    .font(.system(size: 18, weight: .semibold)).foregroundColor(.dizTeal2)
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

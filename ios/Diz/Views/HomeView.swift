import SwiftUI

/// Home tab, like the web app: teal hero with the main call to action, two counters and the latest requests.
struct HomeView: View {
    @EnvironmentObject var store: Store
    var onStart: () -> Void

    private var mine: [Job] {
        store.jobs.filter { j in
            store.isDriver
                ? (j.acceptedByPhone == store.myPhone || j.applicants.contains { $0.phone == store.myPhone })
                : j.ownerPhone == store.myPhone
        }
    }
    private var active: Int { mine.filter { !$0.isFinal }.count }
    private var done: Int { mine.filter { $0.status == "done" }.count }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                hero
                if store.user != nil {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(store.tr("recentTitle")).font(.system(size: 16, weight: .semibold)).foregroundColor(.dizMuted)
                        if mine.isEmpty {
                            EmptyBox(text: store.tr("emptyHome"))
                        } else {
                            ForEach(mine.prefix(3)) { JobCardView(job: $0) }
                        }
                    }.padding(18)
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(store.tr("guest.hint")).font(.system(size: 16.5)).foregroundColor(.dizMuted)
                    }.padding(18)
                }
            }
        }
        .refreshable { await store.refreshAll() }
        .background(Color.dizPaper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Brand row and language selector live inside the hero (a system toolbar would wrap them in its own capsule).
            HStack {
                HStack(spacing: 8) {
                    Circle().fill(Color.dizAmber).frame(width: 7, height: 7)
                    Text(store.tr("brand")).font(.system(size: 18, weight: .semibold)).foregroundColor(.white.opacity(0.9))
                }
                Spacer()
                LangPills()
            }.padding(.bottom, 10)
            Text(store.tr("heroTitle")).font(.system(size: 31, weight: .semibold)).foregroundColor(.white)
            Text(store.tr("heroText")).font(.system(size: 18)).foregroundColor(Color(red: 0.81, green: 0.88, blue: 0.85))
                .padding(.bottom, 8)
            Button(action: onStart) {
                Text(store.tr(store.isDriver ? "tabs.jobs" : "heroBtn")).font(.system(size: 19.5, weight: .semibold))
                    .foregroundColor(.dizInk).frame(maxWidth: .infinity).padding(.vertical, 13).background(Color.dizAmber)
            }.buttonStyle(.plain)
            if store.user != nil {
                HStack(spacing: 18) {
                    stat(active, store.tr("statActiveLabel"))
                    stat(done, store.tr("statDoneLabel"))
                }.padding(.top, 8)
            }
        }
        .padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.dizBrand.ignoresSafeArea(edges: .top))
    }

    private func stat(_ n: Int, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(n)").font(.system(size: 23, weight: .semibold)).foregroundColor(.white)
            Text(label).font(.system(size: 16)).foregroundColor(Color(red: 0.66, green: 0.76, blue: 0.73))
        }
    }
}

/// AR / EN selector in the amber-on-teal style of the web header. High contrast on both the teal bar and the paper.
struct LangPills: View {
    @EnvironmentObject var store: Store
    var light = false
    var body: some View {
        HStack(spacing: 0) {
            ForEach(Lang.selectable) { l in
                let on = store.lang == l
                Button { store.lang = l } label: {
                    Text(l.title).font(.system(size: 16.5, weight: .bold))
                        .foregroundColor(on ? .dizInk : (light ? .dizBrand : .white))
                        .frame(minWidth: 44)
                        .padding(.horizontal, 6).padding(.vertical, 7)
                        .background(on ? Color.dizAmber : (light ? Color.white : Color.white.opacity(0.12)))
                }.buttonStyle(.plain)
            }
        }
        .overlay(Rectangle().stroke(light ? Color.dizBrand : Color.white.opacity(0.8), lineWidth: 1).allowsHitTesting(false))
    }
}

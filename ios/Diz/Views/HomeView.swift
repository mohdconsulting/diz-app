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
                        Text(store.tr("recentTitle")).font(.system(size: 12.5, weight: .semibold)).foregroundColor(.dizMuted)
                        if mine.isEmpty {
                            EmptyBox(text: store.tr("emptyHome"))
                        } else {
                            ForEach(mine.prefix(3)) { JobCardView(job: $0) }
                        }
                    }.padding(18)
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(store.tr("guest.hint")).font(.system(size: 13)).foregroundColor(.dizMuted)
                    }.padding(18)
                }
            }
        }
        .refreshable { await store.refreshAll() }
        .background(Color.dizPaper.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    Circle().fill(Color.dizAmber).frame(width: 7, height: 7)
                    Text(store.tr("brand")).font(.system(size: 14, weight: .semibold)).foregroundColor(.white.opacity(0.9))
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) { LangPills() }
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(store.tr("heroTitle")).font(.system(size: 24, weight: .semibold)).foregroundColor(.white)
            Text(store.tr("heroText")).font(.system(size: 14)).foregroundColor(Color(red: 0.81, green: 0.88, blue: 0.85))
                .padding(.bottom, 8)
            Button(action: onStart) {
                Text(store.tr(store.isDriver ? "tabs.jobs" : "heroBtn")).font(.system(size: 15, weight: .semibold))
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
        .background(Color.dizBrand)
    }

    private func stat(_ n: Int, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(n)").font(.system(size: 18, weight: .semibold)).foregroundColor(.white)
            Text(label).font(.system(size: 12.5)).foregroundColor(Color(red: 0.66, green: 0.76, blue: 0.73))
        }
    }
}

/// AR / EN / SV selector in the amber-on-teal style of the web header.
struct LangPills: View {
    @EnvironmentObject var store: Store
    var body: some View {
        HStack(spacing: 0) {
            ForEach(Lang.allCases) { l in
                Button { store.lang = l } label: {
                    Text(l.title).font(.system(size: 11.5, weight: .semibold))
                        .foregroundColor(store.lang == l ? .dizInk : Color(red: 0.81, green: 0.88, blue: 0.85))
                        .padding(.horizontal, 9).padding(.vertical, 5)
                        .background(store.lang == l ? Color.dizAmber : Color.clear)
                }.buttonStyle(.plain)
            }
        }
        .overlay(Rectangle().stroke(Color.white.opacity(0.35), lineWidth: 1))
    }
}

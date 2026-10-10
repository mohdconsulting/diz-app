import SwiftUI

struct OpenJobsView: View {
    @EnvironmentObject var store: Store
    @State private var showIgnored = false

    private var open: [Job] { store.jobs.filter { $0.status == "open" && store.providerCanTake($0) } }
    private var visible: [Job] { open.filter { !store.dismissed.contains($0.id) } }
    private var ignored: [Job] { open.filter { store.dismissed.contains($0.id) } }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                Text(store.tr("openJobsTitle")).font(.headline).frame(maxWidth: .infinity, alignment: .leading)
                if visible.isEmpty { Text(store.tr("emptyJobs")).foregroundColor(.secondary).padding(.top, 20) }
                ForEach(visible) { JobCardView(job: $0) }
                if !ignored.isEmpty {
                    Button(store.tr(showIgnored ? "dismiss.hideBtn" : "dismiss.showBtn", ["n": String(ignored.count)])) {
                        showIgnored.toggle()
                    }.font(.footnote)
                    if showIgnored { ForEach(ignored) { JobCardView(job: $0, ignoredView: true) } }
                }
            }
            .padding(16)
        }
        .refreshable { await store.refreshAll() }
        .navigationTitle(store.tr("titles.jobs"))
    }
}

struct MyJobsView: View {
    @EnvironmentObject var store: Store

    private var mine: [Job] {
        store.jobs.filter { j in
            guard !j.isFinal || j.status == "cancelled" else { return false }
            return store.isDriver
                ? (j.acceptedByPhone == store.myPhone || j.applicants.contains { $0.phone == store.myPhone })
                : j.ownerPhone == store.myPhone
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                if mine.isEmpty {
                    Text(store.tr(store.isDriver ? "emptyMineDriver" : "emptyMineCustomer"))
                        .foregroundColor(.secondary).padding(.top, 20)
                }
                ForEach(mine) { JobCardView(job: $0) }
            }
            .padding(16)
        }
        .refreshable { await store.refreshAll() }
        .navigationTitle(store.tr(store.isDriver ? "mineTitleDriver" : "mineTitleCustomer"))
    }
}

struct HistoryView: View {
    @EnvironmentObject var store: Store

    private var done: [Job] {
        store.jobs.filter { j in
            j.status == "done" && (store.isDriver ? j.acceptedByPhone == store.myPhone : j.ownerPhone == store.myPhone)
        }.sorted { ($0.completedAt ?? 0) > ($1.completedAt ?? 0) }
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                if store.isDriver { OwnRatingCard() }
                if done.isEmpty {
                    Text(store.tr(store.isDriver ? "emptyHistoryDriver" : "emptyHistoryCustomer"))
                        .foregroundColor(.secondary).padding(.top, 20)
                }
                ForEach(done) { JobCardView(job: $0) }
            }
            .padding(16)
        }
        .refreshable { await store.refreshAll() }
        .navigationTitle(store.tr("titles.history"))
    }
}

struct OwnRatingCard: View {
    @EnvironmentObject var store: Store
    var body: some View {
        Card {
            Text(store.tr("review.yourRating")).font(.subheadline).foregroundColor(.secondary)
            if let r = store.ratings[store.myPhone] {
                HStack { Stars(rating: r.avg); Text(String(format: "%.1f", r.avg) + " (\(r.count))") }
            } else {
                Text(store.tr("review.noReviewsYet")).foregroundColor(.secondary)
            }
            ForEach(Array(store.myComments.enumerated()), id: \.offset) { _, c in
                if let t = c.comment, !t.isEmpty {
                    Divider()
                    Stars(rating: Double(c.rating))
                    Text(t).font(.footnote)
                }
            }
        }
    }
}

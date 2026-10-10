import SwiftUI

struct JobCardView: View {
    @EnvironmentObject var store: Store
    let job: Job
    var ignoredView = false

    @State private var offer = ""
    @State private var showOffer = false
    @State private var confirmDelete = false
    @State private var showProblem = false
    @State private var problemText = ""
    @State private var showRespond = false
    @State private var responseText = ""
    @State private var showChat = false
    @State private var showMap = false

    private var isOwner: Bool { job.ownerPhone == store.myPhone }
    private var isMyAccepted: Bool { job.acceptedByPhone == store.myPhone }
    private var providerPhone: String? { job.acceptedByPhone }
    private var providerName: String { providerPhone.map { store.name(ofPhone: $0, in: job) } ?? "" }

    var body: some View {
        Card {
            header
            details
            if store.isDriver { providerSection } else { customerSection }
            if job.status == "accepted" && (isOwner || isMyAccepted) { chatButton }
        }
        .sheet(isPresented: $showChat) { ChatView(job: job) }
    }

    // MARK: Parts
    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(store.tr("services.\(job.service).label")).font(.headline)
            Spacer()
            Text(store.money(job.price)).font(.subheadline.bold()).foregroundColor(.dizBrand)
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(store.tr("status.\(job.statusKey)")).font(.caption.bold())
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(Color.dizBrand.opacity(0.15)).clipShape(Capsule())
            if let c = job.cat { Text(store.tr("services.\(job.service).categories.\(c)")).font(.subheadline) }
            if let s = job.size { Text(store.tr("services.\(job.service).sizes.\(s)")).font(.subheadline).foregroundColor(.secondary) }
            if !job.desc.isEmpty { Text(job.desc).font(.subheadline) }
            if !job.addr.isEmpty {
                Button { openMaps(query: job.addr) } label: { Label(job.addr, systemImage: "mappin.and.ellipse").font(.footnote) }
            }
            if let t = job.toAddr, !t.isEmpty {
                Button { openMaps(query: t) } label: { Label(t, systemImage: "flag.checkered").font(.footnote) }
            }
        }
    }

    private var chatButton: some View {
        let n = store.unreadCount(jobId: job.id)
        return Button { showChat = true } label: {
            Label(n > 0 ? store.tr("chat.openUnreadBtn", ["n": String(n)]) : store.tr("chat.openBtn"), systemImage: "bubble.left.and.bubble.right")
        }.buttonStyle(.bordered)
    }

    // MARK: Customer
    @ViewBuilder private var customerSection: some View {
        switch job.status {
        case "open":
            Text(store.tr("applicantsTitle")).font(.subheadline.bold())
            if job.applicants.isEmpty {
                Text(store.tr("noApplicantsYet")).font(.footnote).foregroundColor(.secondary)
            }
            ForEach(job.applicants, id: \.phone) { a in
                HStack {
                    VStack(alignment: .leading) { Text(a.name); RatingBadge(phone: a.phone) }
                    Spacer()
                    Button(store.paymentsMode == "off" ? store.tr("assignBtn") : store.tr("pay.assignPayBtn", ["amount": store.money(a.price)])) {
                        Task { await store.assign(job, to: a) }
                    }.buttonStyle(.borderedProminent).tint(.dizBrand)
                }
                if store.paymentsMode == "off" { Text(store.money(a.price)).font(.footnote).foregroundColor(.secondary) }
            }
            if confirmDelete {
                Text(store.tr("confirmDeleteInline")).font(.footnote)
                HStack {
                    PrimaryButton(title: store.tr("confirmDeleteBtn"), role: .destructive) { Task { await store.deleteJob(job.id) } }
                    Button(store.tr("cancelBtn")) { confirmDelete = false }.buttonStyle(.bordered)
                }
            } else {
                Button(store.tr("deleteBtn"), role: .destructive) { confirmDelete = true }.font(.footnote)
            }
        case "accepted":
            acceptedCustomer
        case "done":
            Text(store.tr("paymentReleasedNote")).font(.footnote).foregroundColor(.secondary)
            ReviewSection(job: job)
        default:
            EmptyView()
        }
    }

    @ViewBuilder private var acceptedCustomer: some View {
        if let p = providerPhone {
            HStack { Text(providerName).font(.subheadline.bold()); RatingBadge(phone: p) }
        }
        if let pay = store.payments[job.id] { paymentNote(pay.status) }
        if job.arrived { Text(store.tr("arrivedNoteCustomer")).font(.footnote) }
        if job.markedDoneByProvider { Text(store.tr("providerMarkedDoneNote")).font(.footnote) }
        if !job.arrived && !job.markedDoneByProvider { TrackingBlock(job: job, showMap: $showMap) }
        if job.problemReported {
            Text(store.tr("problemReportedNoteCustomer")).font(.footnote)
            if let r = job.providerResponse, !r.isEmpty {
                Text(store.tr("providerResponseLabel") + ": " + r).font(.footnote)
            }
        } else if job.arrived || job.markedDoneByProvider {
            PrimaryButton(title: store.tr("confirmReleaseBtn")) { Task { await store.complete(job) } }
            if showProblem {
                TextField(store.tr("reportProblemPlaceholder"), text: $problemText, axis: .vertical).textFieldStyle(.roundedBorder)
                PrimaryButton(title: store.tr("sendReportBtn"), role: .destructive) {
                    Task { if await store.reportProblem(job, text: problemText) { showProblem = false; problemText = "" } }
                }
            } else {
                Button(store.tr("reportProblemBtn"), role: .destructive) { showProblem = true }.font(.footnote)
            }
        }
    }

    // MARK: Provider
    @ViewBuilder private var providerSection: some View {
        switch job.status {
        case "open":
            if ignoredView {
                Text(store.tr("dismiss.note")).font(.footnote).foregroundColor(.secondary)
                Button(store.tr("dismiss.restoreBtn")) { Task { await store.restore(job.id) } }.buttonStyle(.bordered)
            } else if let mine = job.applicants.first(where: { $0.phone == store.myPhone }) {
                Text(store.tr("yourApplicationNote", ["price": store.money(mine.price)])).font(.footnote)
                offerRow
            } else {
                PrimaryButton(title: store.tr("takeJobBtn") + " " + store.money(job.price)) { Task { await store.apply(job, price: job.price) } }
                offerRow
                Button(store.tr("dismiss.btn")) { Task { await store.dismiss(job.id) } }.font(.footnote)
            }
        case "accepted":
            if isMyAccepted { acceptedProvider }
            else if let mine = job.applicants.first(where: { $0.phone == store.myPhone }) {
                Text(store.tr("yourApplicationNote", ["price": store.money(mine.price)])).font(.footnote)
            }
        case "done":
            if isMyAccepted {
                Text(store.tr("paymentReleasedNote")).font(.footnote).foregroundColor(.secondary)
                ReviewSection(job: job)
            }
        default:
            EmptyView()
        }
    }

    @ViewBuilder private var offerRow: some View {
        if showOffer {
            HStack {
                TextField(store.tr("customPriceLabel"), text: $offer).keyboardType(.numberPad).textFieldStyle(.roundedBorder)
                Button(store.tr("proposePriceBtn")) {
                    Task { await store.apply(job, price: Int(offer.filter(\.isNumber)) ?? 0); showOffer = false }
                }.buttonStyle(.borderedProminent).tint(.dizBrand)
            }
        } else {
            Button(store.tr("proposePriceBtn")) { showOffer = true }.font(.footnote)
        }
    }

    @ViewBuilder private var acceptedProvider: some View {
        if let pay = store.payments[job.id] { paymentNote(pay.status) }
        if job.problemReported {
            Text(store.tr("problemReportedNoteProvider", ["text": job.problemText ?? ""])).font(.footnote)
            if let r = job.providerResponse, !r.isEmpty {
                Text(store.tr("yourResponseLabel") + ": " + r).font(.footnote)
            } else if showRespond {
                TextField(store.tr("respondPlaceholder"), text: $responseText, axis: .vertical).textFieldStyle(.roundedBorder)
                PrimaryButton(title: store.tr("sendResponseBtn")) {
                    Task { if await store.respond(job, text: responseText) { showRespond = false } }
                }
            } else {
                PrimaryButton(title: store.tr("respondPrompt")) { showRespond = true }
            }
        } else if !job.arrived {
            Text(store.tr("track.autoShareInfo")).font(.footnote).foregroundColor(.secondary)
            if store.locationDenied { Text(store.tr("track.shareDenied")).font(.footnote).foregroundColor(.red) }
            PrimaryButton(title: store.tr("providerArriveBtn")) { Task { await store.arrive(job) } }
        } else if !job.markedDoneByProvider {
            Text(store.tr("arrivedNoteProvider")).font(.footnote)
            PrimaryButton(title: store.tr("providerCompleteBtn")) { Task { await store.markDone(job) } }
        } else {
            Text(store.tr("waitingCustomerConfirmNote")).font(.footnote).foregroundColor(.secondary)
        }
    }

    private func paymentNote(_ status: String) -> some View {
        let key: String
        switch status {
        case "pending": key = "pay.pending"
        case "held": key = store.isDriver ? "pay.heldProvider" : "pay.held"
        case "released": key = "pay.released"
        case "paid_out": key = "pay.paidOut"
        case "refund_due": key = "pay.refundDue"
        case "refunded": key = "pay.refunded"
        default: key = "pay.pending"
        }
        return Text(store.tr(key)).font(.footnote).foregroundColor(.secondary)
    }
}

struct ReviewSection: View {
    @EnvironmentObject var store: Store
    let job: Job
    @State private var rating = 0
    @State private var comment = ""

    var body: some View {
        if store.isDriver {
            if let r = store.reviews[job.id] {
                VStack(alignment: .leading, spacing: 4) {
                    Text(store.tr("review.theirReview")).font(.footnote.bold())
                    Stars(rating: Double(r.rating))
                    if let c = r.comment, !c.isEmpty { Text(c).font(.footnote) }
                }
            } else {
                Text(store.tr("review.noReviewForYou")).font(.footnote).foregroundColor(.secondary)
            }
        } else if let r = store.reviews[job.id] {
            VStack(alignment: .leading, spacing: 4) {
                Text(store.tr("review.yourReview")).font(.footnote.bold())
                Stars(rating: Double(r.rating))
                if let c = r.comment, !c.isEmpty { Text(c).font(.footnote) }
                if r.hidden { Text(store.tr("review.hiddenForYou")).font(.caption).foregroundColor(.secondary) }
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text(store.tr("review.prompt")).font(.footnote.bold())
                StarPicker(value: $rating)
                TextField(store.tr("review.commentPlaceholder"), text: $comment, axis: .vertical)
                    .textFieldStyle(.roundedBorder).lineLimit(2...4)
                PrimaryButton(title: store.tr("review.sendBtn"), disabled: rating == 0) {
                    Task { _ = await store.submitReview(job: job, rating: rating, comment: comment) }
                }
            }
        }
    }
}

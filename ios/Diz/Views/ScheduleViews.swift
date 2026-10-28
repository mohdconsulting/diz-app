import SwiftUI

/// Day chips + one-hour slot grid. Selecting neighbouring hours extends the window (see SlotSelection.tap).
struct TimeSlotPicker: View {
    @EnvironmentObject var store: Store
    @Binding var selection: SlotSelection
    @State private var day: Date = Calendar.current.startOfDay(for: Date())

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Scheduling.days(), id: \.self) { d in dayChip(d) }
                }
            }
            let slots = Scheduling.slots(on: day)
            if slots.isEmpty {
                Text(store.tr("sched.noSlots")).font(.footnote).foregroundColor(.secondary)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                    ForEach(slots, id: \.self) { s in slotCell(s) }
                }
            }
            Text(store.tr("sched.hint")).font(.caption).foregroundColor(.secondary)
            if let s = selection.start, let e = selection.end {
                Text(Scheduling.windowText(start: s, end: e, store.lang) + " (" + store.tr("sched.hours", ["n": String(selection.hours)]) + ")")
                    .font(.subheadline.bold()).foregroundColor(.dizBrand)
            }
        }
        .onAppear {
            if Scheduling.slots(on: day).isEmpty, let next = Scheduling.days().dropFirst().first { day = next }
        }
    }

    private func dayChip(_ d: Date) -> some View {
        let on = Calendar.current.isDate(d, inSameDayAs: day)
        return Text(Scheduling.shortDayText(d, store.lang))
            .font(.footnote.bold())
            .padding(.horizontal, 12).padding(.vertical, 8)
            .foregroundColor(on ? .white : .primary)
            .background(on ? Color.dizBrand : Color.white)
            .overlay(Rectangle().stroke(on ? Color.dizBrand : Color.dizLine, lineWidth: 1))
            .onTapGesture {
                day = d
                if let s = selection.start, !Calendar.current.isDate(s, inSameDayAs: d) { selection.clear() }
            }
    }

    private func slotCell(_ s: Date) -> some View {
        let on = selection.contains(s)
        return Text(Scheduling.slotText(s, store.lang))
            .font(.footnote)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .foregroundColor(on ? .white : .primary)
            .background(on ? Color.dizBrand : Color.white)
            .overlay(Rectangle().stroke(on ? Color.dizBrand : Color.dizLine, lineWidth: 1))
            .onTapGesture { selection.tap(s) }
    }
}

/// "ASAP / pick a time" choice for a new request.
struct ScheduleSection: View {
    @EnvironmentObject var store: Store
    @Binding var choice: ScheduleChoice

    var body: some View {
        Section(store.tr("sched.title")) {
            Picker("", selection: $choice.asap) {
                Text(store.tr("sched.asap")).tag(true)
                Text(store.tr("sched.pick")).tag(false)
            }.pickerStyle(.segmented)
            if choice.asap {
                Text(store.tr("sched.asapLong")).font(.footnote).foregroundColor(.secondary)
            } else {
                TimeSlotPicker(selection: $choice.selection)
            }
        }
    }
}

/// Requested time (open job) or agreed time (assigned job) on a job card.
struct ScheduleLine: View {
    @EnvironmentObject var store: Store
    let job: Job

    var body: some View {
        if job.status == "open" || job.status == "accepted" || job.status == "done" {
            if let w = (job.status == "open" ? job.requestedWindow : job.agreedWindow) {
                Label(store.tr(job.status == "open" ? "sched.requested" : "sched.agreed") + ": "
                      + Scheduling.windowText(start: w.start, end: w.end, store.lang),
                      systemImage: "calendar").font(.footnote)
            } else if job.scheduleType == "asap" {
                Label(store.tr("sched.asapLong"), systemImage: "bolt.fill").font(.footnote)
            }
        }
    }
}

/// Provider: propose another date/time (and price) for an open job. The customer accepts by choosing the provider.
struct ProposalBox: View {
    @EnvironmentObject var store: Store
    let job: Job
    @State private var open = false
    @State private var selection = SlotSelection()
    @State private var price = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if open {
                Text(store.tr("sched.proposeNote")).font(.footnote).foregroundColor(.secondary)
                TimeSlotPicker(selection: $selection)
                DigitField(placeholder: store.tr("sched.priceLabel"), text: $price)
                    .frame(maxWidth: .infinity).frame(height: 40)
                    .background(Color.white).overlay(Rectangle().stroke(Color.dizLine, lineWidth: 1))
                PrimaryButton(title: store.tr("sched.proposeSend"), disabled: selection.isEmpty) {
                    let p = price.intValue > 0 ? price.intValue : job.price
                    Task { await store.apply(job, price: p, proposal: selection); open = false }
                }
                Button(store.tr("sched.proposeClose")) { open = false }.font(.footnote)
            } else {
                Button(store.tr("sched.proposeBtn")) {
                    if price.isEmpty {
                        price = String(job.applicants.first(where: { $0.phone == store.myPhone })?.price ?? job.price)
                    }
                    open = true
                }.font(.footnote)
            }
        }
    }
}

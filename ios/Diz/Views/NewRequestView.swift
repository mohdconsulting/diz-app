import SwiftUI

struct NewRequestView: View {
    @EnvironmentObject var store: Store
    @State private var service = "junk"
    @State private var cat: String?
    @State private var size: Int?
    @State private var desc = ""
    @State private var addr = ""
    @State private var toAddr = ""
    @State private var custom = false
    @State private var customPrice = ""
    @State private var schedule = ScheduleChoice()
    @State private var showAuth = false
    @State private var picked = false

    private var info: ServiceInfo? { Strings.shared.service(service) }
    private var estimate: Int { Pricing.price(service: service, size: size, cat: cat) }
    private var finalPrice: Int { custom ? customPrice.intValue : estimate }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(store.tr("serviceSelectTitle")).font(.system(size: 12.5, weight: .semibold)).foregroundColor(.dizMuted)
                FlowLayout(spacing: 8) {
                    ForEach(Strings.shared.services) { s in
                        Chip(title: store.tr("services.\(s.key).label"), on: picked && s.key == service) {
                            service = s.key; cat = nil; size = nil; picked = true
                        }
                    }
                }
                if picked, let info = info {
                    FieldLabel(text: store.tr("services.\(service).categoryLabel")).padding(.top, 4)
                    FlowLayout(spacing: 8) {
                        ForEach(info.categories, id: \.self) { c in
                            Chip(title: store.tr("services.\(service).categories.\(c)"), on: cat == c) { cat = (cat == c ? nil : c) }
                        }
                    }
                    TextEditor(text: $desc)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 80).padding(4)
                        .overlay(alignment: .topLeading) {
                            if desc.isEmpty {
                                Text(store.tr("services.\(service).descPlaceholder")).font(.system(size: 14))
                                    .foregroundColor(.dizMuted.opacity(0.7)).padding(.horizontal, 9).padding(.vertical, 12)
                                    .allowsHitTesting(false)
                            }
                        }
                        .background(Color.white).overlay(Rectangle().stroke(Color.dizLine, lineWidth: 1).allowsHitTesting(false))
                    FieldLabel(text: store.tr("services.\(service).sizeLabel"))
                    FlowLayout(spacing: 8) {
                        ForEach(info.sizes, id: \.self) { n in
                            Chip(title: store.tr("services.\(service).sizes.\(n)"), on: size == n) { size = (size == n ? nil : n) }
                        }
                    }
                    FieldLabel(text: store.tr("services.\(service).addrLabel"))
                    TextInputField(placeholder: store.tr("services.\(service).addrPlaceholder"), text: $addr, capitalization: .sentences).dizInput()
                    if info.needsToAddr {
                        FieldLabel(text: store.tr("services.\(service).toAddrLabel"))
                        TextInputField(placeholder: store.tr("services.\(service).toAddrPlaceholder"), text: $toAddr, capitalization: .sentences).dizInput()
                    }
                    FieldLabel(text: store.tr("sched.title"))
                    ScheduleSection(choice: $schedule)
                    CashBanner(text: store.tr("cash.formText"), title: store.tr("cash.formTitle")).padding(.top, 4)
                    estimateBox
                    FlowLayout(spacing: 8) {
                        Chip(title: store.tr("customPriceChipLabel"), on: custom) { custom.toggle() }
                    }
                    if custom {
                        FieldLabel(text: store.tr("customPriceLabel"))
                        DigitField(placeholder: store.tr("customPriceLabel"), text: $customPrice).dizInput()
                    }
                    PrimaryButton(title: store.tr(store.user == nil ? "guest.submit" : "submitBtn"), disabled: store.busy) {
                        if store.user == nil { showAuth = true; return }
                        Task {
                            let ok = await store.createJob(service: service, cat: cat, size: size, desc: desc, addr: addr,
                                                           toAddr: toAddr, price: finalPrice, schedule: schedule)
                            if ok { desc = ""; addr = ""; toAddr = ""; cat = nil; size = nil; custom = false; customPrice = ""
                                    schedule = ScheduleChoice(); picked = false }
                        }
                    }.padding(.top, 6)
                }
            }
            .padding(18)
        }
        .navigationTitle(store.tr("titles.new"))
        .dizScreen()
        .sheet(isPresented: $showAuth) { AuthView(closable: true) }
    }

    private var estimateBox: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(store.tr("estimateLabel")).font(.system(size: 14))
                Text(store.tr(custom ? "estimateSubCustom" : "estimateSub")).font(.system(size: 11.5)).foregroundColor(.dizMuted)
            }
            Spacer()
            Text(custom ? (customPrice.isEmpty ? "–" : store.money(finalPrice)) : store.money(estimate))
                .font(.system(size: 20, weight: .bold))
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(Color(red: 0.933, green: 0.953, blue: 0.941))
        .overlay(Rectangle().stroke(Color.dizBrand, lineWidth: 1).allowsHitTesting(false))
        .padding(.top, 4)
    }
}

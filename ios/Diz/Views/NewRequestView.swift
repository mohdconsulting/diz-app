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

    private var info: ServiceInfo? { Strings.shared.service(service) }
    private var estimate: Int { Pricing.price(service: service, size: size, cat: cat) }
    private var finalPrice: Int { custom ? (Int(customPrice.filter(\.isNumber)) ?? 0) : estimate }

    var body: some View {
        Form {
            Section(store.tr("serviceSelectTitle")) {
                ForEach(Strings.shared.services) { s in
                    Button {
                        service = s.key; cat = nil; size = nil
                    } label: {
                        HStack {
                            Text(store.tr("services.\(s.key).label")).foregroundColor(.primary)
                            Spacer()
                            if s.key == service { Image(systemName: "checkmark").foregroundColor(.dizBrand) }
                        }
                    }
                }
            }
            if let info = info {
                Section(store.tr("services.\(service).categoryLabel")) {
                    Picker("", selection: $cat) {
                        Text("—").tag(String?.none)
                        ForEach(info.categories, id: \.self) { c in
                            Text(store.tr("services.\(service).categories.\(c)")).tag(String?.some(c))
                        }
                    }.pickerStyle(.menu)
                }
                Section(store.tr("services.\(service).sizeLabel")) {
                    Picker("", selection: $size) {
                        Text("—").tag(Int?.none)
                        ForEach(info.sizes, id: \.self) { n in
                            Text(store.tr("services.\(service).sizes.\(n)")).tag(Int?.some(n))
                        }
                    }.pickerStyle(.menu)
                }
                Section {
                    TextField(store.tr("services.\(service).descPlaceholder"), text: $desc, axis: .vertical).lineLimit(3...6)
                }
                Section(store.tr("services.\(service).addrLabel")) {
                    TextField(store.tr("services.\(service).addrPlaceholder"), text: $addr)
                }
                if info.needsToAddr {
                    Section(store.tr("services.\(service).toAddrLabel")) {
                        TextField(store.tr("services.\(service).toAddrPlaceholder"), text: $toAddr)
                    }
                }
            }
            Section(store.tr("estimateLabel")) {
                if custom {
                    TextField(store.tr("customPriceLabel"), text: $customPrice).keyboardType(.numberPad)
                    Text(store.tr("estimateSubCustom")).font(.footnote).foregroundColor(.secondary)
                } else {
                    Text(store.money(estimate)).font(.title3.bold())
                    Text(store.tr("estimateSub")).font(.footnote).foregroundColor(.secondary)
                }
                Toggle(store.tr("customPriceChipLabel"), isOn: $custom)
            }
            Section {
                PrimaryButton(title: store.tr("submitBtn"), disabled: store.busy) {
                    Task {
                        let ok = await store.createJob(service: service, cat: cat, size: size, desc: desc, addr: addr,
                                                       toAddr: toAddr, price: finalPrice)
                        if ok { desc = ""; addr = ""; toAddr = ""; cat = nil; size = nil; custom = false; customPrice = "" }
                    }
                }
            }
            .listRowBackground(Color.clear)
        }
        .navigationTitle(store.tr("titles.new"))
    }
}

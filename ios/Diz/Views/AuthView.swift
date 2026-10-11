import SwiftUI

struct AuthView: View {
    @EnvironmentObject var store: Store
    @State private var registering = false
    @State private var name = ""
    @State private var phone = ""
    @State private var password = ""
    @State private var role = "customer"
    @State private var profiles: Set<String> = []

    private let proCats = ["electrician", "plumber", "gardener", "painter", "cleaner"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("دز  Diz").font(.largeTitle.bold()).foregroundColor(.dizBrand)
                    Text(store.tr(registering ? "authSubtitleRegister" : "authSubtitleLogin")).foregroundColor(.secondary)

                    Picker("", selection: $store.lang) {
                        ForEach(Lang.allCases) { Text($0.title).tag($0) }
                    }.pickerStyle(.segmented)

                    Text(store.tr(registering ? "authTitleRegister" : "authTitleLogin")).font(.title2.bold())

                    if registering {
                        field(store.tr("authNameLabel"), text: $name)
                    }
                    field(store.tr("authPhoneLabel"), text: $phone, keyboard: .phonePad)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(store.tr("authPassLabel")).font(.footnote).foregroundColor(.secondary)
                        SecureField(store.tr("authPassLabel"), text: $password)
                            .padding(10).foregroundColor(.primary)
                            .background(Color.dizCard).clipShape(RoundedRectangle(cornerRadius: 10))
                            .environment(\.layoutDirection, .leftToRight)
                    }

                    if registering {
                        Text(store.tr("authRoleLabel")).font(.footnote).foregroundColor(.secondary)
                        Picker("", selection: $role) {
                            Text(store.tr("roleCustomer")).tag("customer")
                            Text(store.tr("roleDriver")).tag("driver")
                        }.pickerStyle(.segmented)
                        if role == "driver" {
                            Text(store.tr("authProfileLabel")).font(.footnote).foregroundColor(.secondary)
                            chip("driver", store.tr("profileDriver"))
                            chip("towing", store.tr("profileTowing"))
                            ForEach(proCats, id: \.self) { chip($0, store.tr("services.pro.categories.\($0)")) }
                            Text(store.tr("authShareNote")).font(.footnote).foregroundColor(.secondary)
                        }
                    }

                    PrimaryButton(title: store.tr(registering ? "authSubmitRegister" : "authSubmitLogin"), disabled: store.busy) {
                        Task {
                            if registering {
                                await store.register(name: name, phone: phone, password: password, role: role,
                                                     profiles: role == "driver" ? Array(profiles).sorted() : [])
                            } else {
                                await store.login(phone: phone, password: password)
                            }
                        }
                    }

                    HStack {
                        Text(store.tr(registering ? "authSwitchTextRegister" : "authSwitchTextLogin")).foregroundColor(.secondary)
                        Button(store.tr(registering ? "authSwitchBtnRegister" : "authSwitchBtnLogin")) { registering.toggle() }
                    }.font(.subheadline)
                }
                .padding(20)
            }
            .overlay(alignment: .bottom) { ToastView() }
        }
    }

    private func field(_ label: String, text: Binding<String>, keyboard: UIKeyboardType = .default) -> some View {
        AuthField(label: label, text: text, keyboard: keyboard)
    }

    private func chip(_ key: String, _ title: String) -> some View {
        Button {
            if profiles.contains(key) { profiles.remove(key) } else { profiles.insert(key) }
        } label: {
            HStack {
                Image(systemName: profiles.contains(key) ? "checkmark.square.fill" : "square")
                Text(title)
                Spacer()
            }
            .padding(10)
            .background(Color.dizCard).clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }
}

/// Plain text field with explicit colors and left-to-right input, so digits and Latin text are always visible
/// (also when the app UI is right-to-left).
struct AuthField: View {
    let label: String
    @Binding var text: String
    var keyboard: UIKeyboardType = .default

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.footnote).foregroundColor(.secondary)
            TextField(label, text: $text)
                .keyboardType(keyboard)
                .textContentType(keyboard == .phonePad ? .telephoneNumber : nil)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .multilineTextAlignment(.leading)
                .environment(\.layoutDirection, .leftToRight)
                .foregroundColor(.primary)
                .padding(10)
                .background(Color.dizCard)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }
}

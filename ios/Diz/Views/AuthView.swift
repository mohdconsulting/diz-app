import SwiftUI

struct AuthView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    var closable = false
    @State private var registering = false
    @State private var name = ""
    @State private var phone = ""
    @State private var password = ""
    @State private var email = ""
    @State private var showForgot = false
    @State private var role = "customer"
    @State private var profiles: Set<String> = []

    private let proCats = AccountDetailsCard.proCats

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 8) {
                        Circle().fill(Color.dizAmber).frame(width: 7, height: 7)
                        Text("دز  Diz").font(.system(size: 28, weight: .bold)).foregroundColor(.dizBrand)
                    }
                    Text(store.tr(registering ? "authSubtitleRegister" : "authSubtitleLogin")).font(.system(size: 17)).foregroundColor(.dizMuted)

                    HStack { LangPills(light: true); Spacer() }

                    Text(store.tr(registering ? "authTitleRegister" : "authTitleLogin")).font(.system(size: 27, weight: .semibold)).foregroundColor(.dizInk)

                    if registering {
                        field(store.tr("authNameLabel"), text: $name)
                    }
                    field(store.tr("authPhoneLabel"), text: $phone, keyboard: .phonePad)
                    if registering {
                        field(store.tr("authEmailLabel"), text: $email, keyboard: .emailAddress)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(store.tr("authPassLabel")).font(.footnote).foregroundColor(.secondary)
                        TextInputField(placeholder: store.tr("authPassLabel"), text: $password, secure: true)
                            .dizInput()
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
                                await store.register(name: name, phone: phone, email: email, password: password, role: role,
                                                     profiles: role == "driver" ? Array(profiles).sorted() : [])
                            } else {
                                await store.login(phone: phone, password: password)
                            }
                        }
                    }

                    HStack {
                        Text(store.tr(registering ? "authSwitchTextRegister" : "authSwitchTextLogin")).foregroundColor(.secondary)
                        Button(store.tr(registering ? "authSwitchBtnRegister" : "authSwitchBtnLogin")) { registering.toggle() }.foregroundColor(.dizTeal2).bold()
                    }.font(.subheadline)
                    if !registering {
                        Button(store.tr("forgotLink")) { showForgot = true }
                            .font(.subheadline).foregroundColor(.dizTeal2)
                    }
                }
                .padding(22)
                .background(Color.white).overlay(Rectangle().stroke(Color.dizLine, lineWidth: 1).allowsHitTesting(false))
                .padding(20)
            }
            .background(Color.dizPaper.ignoresSafeArea())
            .overlay(alignment: .bottom) { ToastView() }
            .toolbar {
                if closable {
                    ToolbarItem(placement: .cancellationAction) { Button(store.tr("guest.close")) { dismiss() } }
                }
            }
            .onChange(of: store.user?.id) { id in if id != nil { dismiss() } }
            .sheet(isPresented: $showForgot) { ForgotPasswordView(phone: phone) }
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
            .background(profiles.contains(key) ? Color.dizBrand : Color.white)
            .foregroundColor(profiles.contains(key) ? .white : .dizInk)
            .overlay(Rectangle().stroke(profiles.contains(key) ? Color.dizBrand : Color.dizLine, lineWidth: 1).allowsHitTesting(false))
        }
        .buttonStyle(.plain)
    }
}

/// Plain text field. Phone numbers use the ordinary keyboard (not .phonePad, which has no return key and
/// misbehaves with some simulator/keyboard setups) and are filtered to digits, "+" and spaces.
struct AuthField: View {
    let label: String
    @Binding var text: String
    var keyboard: UIKeyboardType = .default

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 16)).foregroundColor(.dizMuted)
            if keyboard == .phonePad {
                DigitField(placeholder: label, text: $text, allowPlusAndSpace: true)
                    .dizInput()
            } else if keyboard == .emailAddress {
                TextInputField(placeholder: label, text: $text, keyboard: .emailAddress).dizInput()
                    .environment(\.layoutDirection, .leftToRight)
            } else {
                TextInputField(placeholder: label, text: $text, capitalization: .words).dizInput()
            }
        }
    }
}

/// "Forgot password": a 6-digit code on WhatsApp (code + new password here), or a link mailed to the account's e-mail
/// (the new password is then chosen on the web page the link opens).
struct ForgotPasswordView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @State var phone: String
    @State private var sent = false
    @State private var codeMode = false
    @State private var code = ""
    @State private var newPass = ""
    @State private var repeatPass = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if codeMode { codeForm } else { phoneForm }
                }
                .padding(22)
                .background(Color.white).overlay(Rectangle().stroke(Color.dizLine, lineWidth: 1).allowsHitTesting(false))
                .padding(20)
            }
            .background(Color.dizPaper.ignoresSafeArea())
            .overlay(alignment: .bottom) { ToastView() }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(store.tr("forgotBack")) { if codeMode { codeMode = false } else { dismiss() } }
                }
            }
        }
    }

    @ViewBuilder private var phoneForm: some View {
        Text(store.tr("forgotTitle")).font(.system(size: 27, weight: .semibold)).foregroundColor(.dizInk)
        Text(store.tr("forgotText")).font(.system(size: 17)).foregroundColor(.dizMuted)
        AuthField(label: store.tr("authPhoneLabel"), text: $phone, keyboard: .phonePad)
        WhatsAppButton(title: store.tr("forgotWaSend"), disabled: store.busy) {
            Task {
                if await store.sendResetCode(phone: phone) {
                    code = ""; newPass = ""; repeatPass = ""; codeMode = true
                }
            }
        }
        Button(store.tr("forgotSend")) {
            Task { if await store.requestPasswordReset(phone: phone) { sent = true } }
        }
        .buttonStyle(SecondaryButtonStyle()).frame(maxWidth: .infinity).disabled(store.busy)
        if sent {
            Text(store.tr("forgotSent")).font(.system(size: 16.5)).foregroundColor(.dizBrand)
        }
    }

    @ViewBuilder private var codeForm: some View {
        Text(store.tr("codeTitle")).font(.system(size: 27, weight: .semibold)).foregroundColor(.dizInk)
        Text(store.tr("codeSent")).font(.system(size: 16.5)).foregroundColor(.dizMuted)
        VStack(alignment: .leading, spacing: 4) {
            Text(store.tr("codeLabel")).font(.system(size: 16)).foregroundColor(.dizMuted)
            DigitField(placeholder: "123456", text: $code).dizInput()
                .environment(\.layoutDirection, .leftToRight)
        }
        VStack(alignment: .leading, spacing: 4) {
            Text(store.tr("resetNewLabel")).font(.system(size: 16)).foregroundColor(.dizMuted)
            TextInputField(placeholder: store.tr("resetNewLabel"), text: $newPass, secure: true).dizInput()
        }
        VStack(alignment: .leading, spacing: 4) {
            Text(store.tr("resetRepeatLabel")).font(.system(size: 16)).foregroundColor(.dizMuted)
            TextInputField(placeholder: store.tr("resetRepeatLabel"), text: $repeatPass, secure: true).dizInput()
        }
        PrimaryButton(title: store.tr("codeSave"), disabled: store.busy) {
            Task {
                if await store.resetWithCode(phone: phone, code: code, password: newPass, repeat: repeatPass) { dismiss() }
            }
        }
        Button {
            Task { if await store.sendResetCode(phone: phone) { store.toast("codeSent") } }
        } label: {
            Text(store.tr("codeResend")).font(.system(size: 16.5, weight: .semibold)).foregroundColor(.dizBrand).underline()
        }
        .buttonStyle(.plain).frame(maxWidth: .infinity).disabled(store.busy)
    }
}

/// Full-width WhatsApp-green button.
struct WhatsAppButton: View {
    let title: String
    var disabled = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 19.5, weight: .semibold)).foregroundColor(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 13)
                .background(Color(red: 0x25 / 255, green: 0xD3 / 255, blue: 0x66 / 255))
                .opacity(disabled ? 0.5 : 1)
        }
        .buttonStyle(.plain).disabled(disabled)
    }
}

/// Profile page: e-mail and, for providers, skills (job types they see), saved with one button like on the web.
struct AccountDetailsCard: View {
    @EnvironmentObject var store: Store
    static let proCats = ["electrician", "plumber", "smith", "carpenter", "appliance_repair", "ac_fridge", "camera_satellite", "cleaner", "carpet_cleaning", "painter", "pest_control"]
    @State private var picked: Set<String> = []
    @State private var email = ""

    private func title(_ key: String) -> String {
        key == "driver" ? store.tr("profileDriver") : (key == "towing" ? store.tr("profileTowing") : store.tr("services.pro.categories.\(key)"))
    }

    var body: some View {
        Card {
            Text(store.tr("authEmailLabel")).font(.system(size: 16.5)).foregroundColor(.dizMuted)
            TextInputField(placeholder: store.tr("authEmailLabel"), text: $email, keyboard: .emailAddress).dizInput()
                .environment(\.layoutDirection, .leftToRight)
            if store.isDriver {
                Text(store.tr("profileEditTitle")).font(.system(size: 16, weight: .semibold)).foregroundColor(.dizMuted)
                    .padding(.top, 6)
                ForEach(["driver", "towing"] + AccountDetailsCard.proCats, id: \.self) { key in
                    let on = picked.contains(key)
                    Button {
                        if on { picked.remove(key) } else { picked.insert(key) }
                    } label: {
                        HStack {
                            Image(systemName: on ? "checkmark.square.fill" : "square")
                            Text(title(key))
                            Spacer()
                        }
                        .padding(10)
                        .background(on ? Color.dizBrand : Color.white)
                        .foregroundColor(on ? .white : .dizInk)
                        .overlay(Rectangle().stroke(on ? Color.dizBrand : Color.dizLine, lineWidth: 1).allowsHitTesting(false))
                    }
                    .buttonStyle(.plain)
                }
            }
            PrimaryButton(title: store.tr("accountSaveBtn"), disabled: store.busy) {
                Task { _ = await store.saveDetails(email: email, profiles: store.isDriver ? Array(picked).sorted() : nil) }
            }
        }
        .onAppear {
            picked = Set(store.user?.profiles ?? [])
            email = store.user?.email ?? ""
        }
    }
}

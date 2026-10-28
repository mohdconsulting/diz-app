import SwiftUI
import UIKit

/// Colours taken from the web app (--teal, --amber, --paper, --line, --muted, --danger).
extension Color {
    static let dizInk = Color(red: 0x17/255, green: 0x21/255, blue: 0x1d/255)
    static let dizBrand = Color(red: 0x1c/255, green: 0x3d/255, blue: 0x37/255)     // --teal
    static let dizTeal2 = Color(red: 0x2c/255, green: 0x5a/255, blue: 0x51/255)     // --teal-2
    static let dizAmber = Color(red: 0xe5/255, green: 0xa1/255, blue: 0x3a/255)     // --amber
    static let dizPaper = Color(red: 0xf6/255, green: 0xf4/255, blue: 0xee/255)     // --paper
    static let dizLine = Color(red: 0xd8/255, green: 0xd3/255, blue: 0xc6/255)      // --line
    static let dizMuted = Color(red: 0x6b/255, green: 0x75/255, blue: 0x70/255)     // --muted
    static let dizDanger = Color(red: 0xb3/255, green: 0x46/255, blue: 0x2f/255)    // --danger
    static let dizSoft = Color(red: 0xea/255, green: 0xf3/255, blue: 0xf1/255)      // cash-note background
    static let dizCard = Color.white
}

extension View {
    /// Paper background + inline teal navigation bar, like the web app's frame.
    func dizScreen() -> some View {
        self.scrollContentBackground(.hidden)
            .background(Color.dizPaper.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
    }
}

/// Applies the web look to UIKit bars (teal top bar, white tab bar with a hairline).
enum DizTheme {
    static func apply() {
        let teal = UIColor(Color.dizBrand)
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = teal
        nav.shadowColor = .clear
        nav.titleTextAttributes = [.foregroundColor: UIColor.white, .font: UIFont.systemFont(ofSize: 18, weight: .semibold)]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
        UINavigationBar.appearance().tintColor = .white

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = .white
        tab.shadowColor = UIColor(Color.dizLine)
        let muted = UIColor(Color.dizMuted)
        for item in [tab.stackedLayoutAppearance, tab.inlineLayoutAppearance, tab.compactInlineLayoutAppearance] {
            item.normal.iconColor = muted
            item.normal.titleTextAttributes = [.foregroundColor: muted, .font: UIFont.systemFont(ofSize: 11, weight: .semibold)]
            item.selected.iconColor = teal
            item.selected.titleTextAttributes = [.foregroundColor: teal, .font: UIFont.systemFont(ofSize: 11, weight: .semibold)]
        }
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }
}

struct Card<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16).padding(.vertical, 14)
            .background(Color.dizCard)
            .overlay(Rectangle().stroke(Color.dizLine, lineWidth: 1))
    }
}

struct PrimaryButton: View {
    let title: String
    var role: ButtonRole? = nil
    var disabled = false
    let action: () -> Void
    var body: some View {
        Button(role: role, action: action) {
            Text(title).font(.system(size: 15, weight: .semibold))
                .foregroundColor(role == .destructive ? .dizDanger : .dizInk)
                .frame(maxWidth: .infinity).padding(.vertical, 13)
                .background(role == .destructive ? Color.white : Color.dizAmber)
                .overlay(Rectangle().stroke(Color.dizDanger, lineWidth: role == .destructive ? 1 : 0))
                .opacity(disabled ? 0.5 : 1)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }
}

struct Stars: View {
    let rating: Double
    var body: some View {
        HStack(spacing: 1) {
            ForEach(1...5, id: \.self) { i in
                Image(systemName: Double(i) <= rating.rounded() ? "star.fill" : "star").foregroundColor(Color(red: 0.79, green: 0.54, blue: 0))
            }
        }
    }
}

struct StarPicker: View {
    @Binding var value: Int
    var body: some View {
        HStack {
            ForEach(1...5, id: \.self) { i in
                Image(systemName: i <= value ? "star.fill" : "star")
                    .font(.title2).foregroundColor(.orange)
                    .onTapGesture { value = i }
            }
        }
    }
}

struct RatingBadge: View {
    @EnvironmentObject var store: Store
    let phone: String
    var body: some View {
        if let r = store.ratings[phone] {
            Text("★ " + String(format: "%.1f", r.avg) + " (\(r.count))")
                .font(.caption).foregroundColor(.orange)
        } else {
            Text(store.tr("review.noReviewsYet")).font(.caption).foregroundColor(.secondary)
        }
    }
}

struct ToastView: View {
    @EnvironmentObject var store: Store
    var body: some View {
        if let t = store.toastText {
            Text(t)
                .font(.system(size: 13.5)).foregroundColor(.white).multilineTextAlignment(.center)
                .padding(.horizontal, 18).padding(.vertical, 10)
                .background(Color.dizInk)
                .padding(.bottom, 90)
                .transition(.opacity)
        }
    }
}

func openMaps(query: String) {
    guard let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
          let url = URL(string: "http://maps.apple.com/?q=" + q) else { return }
    UIApplication.shared.open(url)
}

func openMaps(lat: Double, lng: Double) {
    if let url = URL(string: "http://maps.apple.com/?ll=\(lat),\(lng)&q=Diz") { UIApplication.shared.open(url) }
}

/// Highlighted note: payment is cash, directly between customer and provider.
struct CashBanner: View {
    let text: String
    var title: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let t = title { Text("💵 " + t).font(.subheadline.bold()) }
            Text(text).font(.footnote)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Color.dizSoft)
        .overlay(Rectangle().stroke(Color.dizBrand, lineWidth: 1))
    }
}

/// Small bordered status label (web: .status).
struct StatusBadge: View {
    let text: String
    var color: Color = .dizTeal2
    var dashed = false
    var body: some View {
        Text(text).font(.system(size: 11.5)).foregroundColor(color)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .overlay(Rectangle().stroke(color, style: StrokeStyle(lineWidth: 1, dash: dashed ? [3, 2] : [])))
    }
}

/// Outlined teal button (web: button.secondary).
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold)).foregroundColor(.dizBrand)
            .padding(.horizontal, 12).padding(.vertical, 9)
            .overlay(Rectangle().stroke(Color.dizBrand, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

/// Square bordered input box (web: input).
struct DizInputBox: ViewModifier {
    func body(content: Content) -> some View {
        content.frame(maxWidth: .infinity).frame(height: 44)
            .background(Color.white).overlay(Rectangle().stroke(Color.dizLine, lineWidth: 1))
    }
}
extension View { func dizInput() -> some View { modifier(DizInputBox()) } }

/// Dashed empty-state box (web: .empty).
struct EmptyBox: View {
    let text: String
    var body: some View {
        Text(text).font(.system(size: 14)).foregroundColor(.dizMuted).multilineTextAlignment(.center)
            .frame(maxWidth: .infinity).padding(.vertical, 26).padding(.horizontal, 18)
            .overlay(Rectangle().stroke(Color.dizLine, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }
}

/// Amber filled button for inline actions (web: button.primary, compact).
struct AmberButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold)).foregroundColor(.dizInk)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(Color.dizAmber)
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

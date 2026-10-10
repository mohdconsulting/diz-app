import SwiftUI
import UIKit

extension Color {
    static let dizBrand = Color(red: 0.05, green: 0.45, blue: 0.40)
    static let dizCard = Color(UIColor.secondarySystemBackground)
}

struct Card<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Color.dizCard)
            .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

struct PrimaryButton: View {
    let title: String
    var role: ButtonRole? = nil
    var disabled = false
    let action: () -> Void
    var body: some View {
        Button(role: role, action: action) {
            Text(title).fontWeight(.semibold).frame(maxWidth: .infinity).padding(.vertical, 10)
        }
        .buttonStyle(.borderedProminent)
        .tint(role == .destructive ? .red : .dizBrand)
        .disabled(disabled)
    }
}

struct Stars: View {
    let rating: Double
    var body: some View {
        HStack(spacing: 1) {
            ForEach(1...5, id: \.self) { i in
                Image(systemName: Double(i) <= rating.rounded() ? "star.fill" : "star").foregroundColor(.orange)
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
                .font(.subheadline).foregroundColor(.white)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(Color.black.opacity(0.85)).clipShape(Capsule())
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

import SwiftUI

/// Chat between the logged-in user and Diz support (the admin answers on the web; see diz_support.sql).
struct SupportMessage: Decodable, Identifiable, Hashable {
    var id: Int
    var fromAdmin: Bool
    var body: String
    var createdAt: String
    var readAt: String?
    enum CodingKeys: String, CodingKey {
        case id, body, fromAdmin = "from_admin", createdAt = "created_at", readAt = "read_at"
    }

    var date: Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: createdAt) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: createdAt)
    }
}

struct SupportView: View {
    @EnvironmentObject var store: Store
    @State private var text = ""

    var body: some View {
        VStack(spacing: 0) {
            Text(store.tr("support.intro")).font(.system(size: 15)).foregroundColor(.dizMuted).padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        if store.supportMessages.isEmpty {
                            Text(store.tr("support.empty")).foregroundColor(.dizMuted).padding(.top, 20)
                        }
                        ForEach(store.supportMessages) { m in bubble(m).id(m.id) }
                    }.padding(12)
                }
                .onChange(of: store.supportMessages.count) { _ in
                    if let last = store.supportMessages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            HStack {
                // Same field as the job chat (ChatView): a plain SwiftUI TextField, which handles the Arabic keyboard.
                TextField(store.tr("support.placeholder"), text: $text, axis: .vertical)
                    .textFieldStyle(.roundedBorder).lineLimit(1...4).foregroundColor(.dizInk)
                Button(store.tr("chat.sendBtn")) {
                    let t = text
                    Task { if await store.sendSupport(t) { text = "" } }
                }
                .buttonStyle(AmberButtonStyle())
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }.padding(12)
        }
        .navigationTitle(store.tr("tabs.support"))
        .dizScreen()
        .task {
            // Refresh while this tab is open, and mark the admin's replies as read.
            while !Task.isCancelled {
                await store.loadSupport(markRead: true)
                try? await Task.sleep(nanoseconds: 6_000_000_000)
            }
        }
    }

    private func bubble(_ m: SupportMessage) -> some View {
        let mine = !m.fromAdmin
        return HStack {
            if mine { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 2) {
                Text((mine ? store.tr("chat.you") : store.tr("support.staff")) + (m.date.map { " · " + $0.formatted(date: .abbreviated, time: .shortened) } ?? ""))
                    .font(.caption2).foregroundColor(mine ? .white.opacity(0.8) : .secondary)
                Text(m.body).foregroundColor(mine ? .white : .dizInk)
            }
            .padding(10)
            .background(mine ? Color.dizBrand : Color.dizPaper)
            .overlay(Rectangle().stroke(mine ? Color.dizBrand : Color.dizLine, lineWidth: 1).allowsHitTesting(false))
            if !mine { Spacer(minLength: 40) }
        }
    }
}

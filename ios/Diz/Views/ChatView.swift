import SwiftUI

struct ChatView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let job: Job
    @State private var text = ""

    private var msgs: [ChatMessage] { store.chat(jobId: job.id) }
    private var closed: Bool { job.isFinal }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Text(store.tr("chat.privacy")).font(.caption).foregroundColor(.secondary).padding(8)
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 8) {
                            if msgs.isEmpty { Text(store.tr("chat.empty")).foregroundColor(.secondary).padding(.top, 20) }
                            ForEach(msgs) { m in bubble(m).id(m.id) }
                        }.padding(12)
                    }
                    .onChange(of: msgs.count) { _ in
                        if let last = msgs.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                    }
                }
                if closed {
                    Text(store.tr("chat.closed")).font(.footnote).foregroundColor(.secondary).padding()
                } else {
                    HStack {
                        TextField(store.tr("chat.placeholder"), text: $text, axis: .vertical)
                            .textFieldStyle(.roundedBorder).lineLimit(1...4)
                        Button(store.tr("chat.sendBtn")) {
                            let t = text
                            Task { if await store.send(jobId: job.id, body: t) { text = "" } }
                        }
                        .buttonStyle(.borderedProminent).tint(.dizBrand)
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }.padding(12)
                }
            }
            .navigationTitle(store.tr("services.\(job.service).label"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(store.tr("chat.closeBtn")) { dismiss() } } }
            .task { await store.markRead(jobId: job.id) }
            .onChange(of: msgs.count) { _ in Task { await store.markRead(jobId: job.id) } }
        }
    }

    private func bubble(_ m: ChatMessage) -> some View {
        let mine = m.senderPhone == store.myPhone
        return HStack {
            if mine { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 2) {
                Text(mine ? store.tr("chat.you") : store.tr(store.isDriver ? "chat.customer" : "chat.provider"))
                    .font(.caption2).foregroundColor(mine ? .white.opacity(0.8) : .secondary)
                Text(m.body).foregroundColor(mine ? .white : .primary)
            }
            .padding(10)
            .background(mine ? Color.dizBrand : Color.dizCard)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            if !mine { Spacer(minLength: 40) }
        }
    }
}

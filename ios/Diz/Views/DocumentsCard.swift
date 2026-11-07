import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// Provider profile: documents for verification (ID, licence, certificate …). Images are sent as JPEG, PDFs as they are.
/// Files go to the private Storage bucket provider-docs; only the provider and admin can read them.
struct DocumentsCard: View {
    @EnvironmentObject var store: Store
    @State private var kind = "id"
    @State private var photoItem: PhotosPickerItem?
    @State private var showPdf = false

    private func kindLabel(_ k: String) -> String {
        store.tr(["id": "docs.kId", "license": "docs.kLicense", "certificate": "docs.kCertificate"][k] ?? "docs.kOther")
    }

    var body: some View {
        Card {
            Text(store.tr("docs.title")).font(.system(size: 12.5, weight: .semibold)).foregroundColor(.dizMuted)
            Text(store.tr("docs.hint")).font(.system(size: 12.5)).foregroundColor(.dizMuted)
            if store.myDocs.isEmpty {
                Text(store.tr("docs.empty")).font(.footnote).foregroundColor(.dizMuted)
            }
            ForEach(store.myDocs) { doc in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(kindLabel(doc.kind)).font(.system(size: 12, weight: .semibold)).foregroundColor(.dizBrand)
                        Text(doc.fileName).font(.system(size: 13)).foregroundColor(.dizInk).lineLimit(1)
                    }
                    Spacer()
                    Button(store.tr("docs.remove")) { Task { await store.deleteDoc(doc) } }
                        .font(.footnote).foregroundColor(.red).disabled(store.busy)
                }
                .padding(8)
                .overlay(Rectangle().stroke(Color.dizLine, lineWidth: 1).allowsHitTesting(false))
            }
            Text(store.tr("docs.kindLabel")).font(.system(size: 12.5)).foregroundColor(.dizMuted).padding(.top, 4)
            Picker(store.tr("docs.kindLabel"), selection: $kind) {
                ForEach(Store.docKinds, id: \.self) { Text(kindLabel($0)).tag($0) }
            }
            .pickerStyle(.menu)
            HStack(spacing: 10) {
                PhotosPicker(selection: $photoItem, matching: .images) { Text(store.tr("docs.pickImage")) }
                    .buttonStyle(.bordered)
                Button(store.tr("docs.pickPdf")) { showPdf = true }
                    .buttonStyle(.bordered)
            }
            .disabled(store.busy)
            if store.busy { Text(store.tr("docs.uploading")).font(.footnote).foregroundColor(.dizMuted) }
        }
        .onChange(of: photoItem) { item in
            guard let item = item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self),
                   let image = UIImage(data: data),
                   let jpeg = image.jpegData(compressionQuality: 0.85) {
                    await store.uploadDoc(kind: kind, data: jpeg, fileName: "photo.jpg", mime: "image/jpeg")
                } else {
                    store.toast("docs.badType")
                }
                photoItem = nil
            }
        }
        .fileImporter(isPresented: $showPdf, allowedContentTypes: [.pdf]) { result in
            guard case .success(let url) = result else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            let data = try? Data(contentsOf: url)
            if scoped { url.stopAccessingSecurityScopedResource() }
            guard let data = data else { store.toast("toastSaveFailed"); return }
            Task { await store.uploadDoc(kind: kind, data: data, fileName: url.lastPathComponent, mime: "application/pdf") }
        }
        .task { await store.loadMyDocs() }
    }
}

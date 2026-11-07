import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// Provider profile: ID document for verification. The provider can take a photo, pick one or more images,
/// or pick one or more files (images or PDF). Images are sent as JPEG. Uploads start right away.
/// Files go to the private Storage bucket provider-docs; only the provider and admin can read them.
struct DocumentsCard: View {
    @EnvironmentObject var store: Store
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showCamera = false
    @State private var showFiles = false
    @State private var progress: String?

    var body: some View {
        Card {
            Text(store.tr("docs.title")).font(.system(size: 12.5, weight: .semibold)).foregroundColor(.dizMuted)
            Text(store.tr("docs.hint")).font(.system(size: 12.5)).foregroundColor(.dizMuted)
            if store.myDocs.isEmpty {
                Text(store.tr("docs.empty")).font(.footnote).foregroundColor(.dizMuted)
            }
            ForEach(store.myDocs) { doc in
                HStack {
                    Text("📄 " + doc.fileName).font(.system(size: 13)).foregroundColor(.dizInk).lineLimit(1)
                    Spacer()
                    Button(store.tr("docs.remove")) { Task { await store.deleteDoc(doc) } }
                        .font(.footnote).foregroundColor(.red).disabled(store.busy)
                }
                .padding(8)
                .overlay(Rectangle().stroke(Color.dizLine, lineWidth: 1).allowsHitTesting(false))
            }
            VStack(alignment: .leading, spacing: 8) {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button(store.tr("docs.takePhoto")) { showCamera = true }.buttonStyle(.bordered)
                }
                HStack(spacing: 10) {
                    PhotosPicker(selection: $photoItems, maxSelectionCount: 10, matching: .images) { Text(store.tr("docs.pickImage")) }
                        .buttonStyle(.bordered)
                    Button(store.tr("docs.chooseFiles")) { showFiles = true }.buttonStyle(.bordered)
                }
            }
            .disabled(store.busy || progress != nil)
            if let p = progress { Text(p).font(.footnote).foregroundColor(.dizMuted) }
        }
        .sheet(isPresented: $showCamera) {
            CameraPicker { image in
                guard let jpeg = image.jpegData(compressionQuality: 0.85) else { return }
                Task { await upload([(jpeg, "photo.jpg", "image/jpeg")]) }
            }
            .ignoresSafeArea()
        }
        .onChange(of: photoItems) { items in
            guard !items.isEmpty else { return }
            Task {
                var files: [(Data, String, String)] = []
                for item in items {
                    if let data = try? await item.loadTransferable(type: Data.self),
                       let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.85) {
                        files.append((jpeg, "photo.jpg", "image/jpeg"))
                    }
                }
                photoItems = []
                await upload(files)
            }
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.pdf, .image], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            var files: [(Data, String, String)] = []
            for url in urls {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                guard let data = try? Data(contentsOf: url) else { continue }
                let isPdf = UTType(filenameExtension: url.pathExtension)?.conforms(to: .pdf) ?? false
                if isPdf {
                    files.append((data, url.lastPathComponent, "application/pdf"))
                } else if let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.85) {
                    files.append((jpeg, url.deletingPathExtension().lastPathComponent + ".jpg", "image/jpeg"))
                }
            }
            Task { await upload(files) }
        }
        .task { await store.loadMyDocs() }
    }

    /// Uploads the chosen files one after another, with "Uploading n of total…".
    private func upload(_ files: [(Data, String, String)]) async {
        guard !files.isEmpty else { store.toast("docs.badType"); return }
        for (i, f) in files.enumerated() {
            progress = store.tr("docs.uploadingN", ["n": String(i + 1), "total": String(files.count)])
            await store.uploadDoc(kind: "id", data: f.0, fileName: f.1, mime: f.2)
        }
        progress = nil
    }
}

/// Minimal camera wrapper (SwiftUI has no camera view of its own).
struct CameraPicker: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

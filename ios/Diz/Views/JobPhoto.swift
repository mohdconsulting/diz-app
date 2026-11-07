import SwiftUI
import PhotosUI

/// Job photos are stored like on the web: a JPEG data URL (max 800 px wide, quality 0.6) in jobs.photo.
enum JobPhoto {
    static func dataURL(_ image: UIImage, maxWidth: CGFloat = 800) -> String? {
        let scale = min(1, maxWidth / max(image.size.width, 1))
        let size = CGSize(width: max(1, (image.size.width * scale).rounded()), height: max(1, (image.size.height * scale).rounded()))
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let jpeg = resized.jpegData(compressionQuality: 0.6) else { return nil }
        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
    }

    static func image(_ dataURL: String?) -> UIImage? {
        guard let s = dataURL, let comma = s.firstIndex(of: ","), s.hasPrefix("data:image") else { return nil }
        guard let data = Data(base64Encoded: String(s[s.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }
}

/// "Photo (optional)" on the request form: take a photo or choose one; shows a preview with "Remove photo".
struct JobPhotoField: View {
    @EnvironmentObject var store: Store
    @Binding var photo: String?
    @State private var showChoice = false
    @State private var showCamera = false
    @State private var showLibrary = false
    @State private var item: PhotosPickerItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            FieldLabel(text: store.tr("photoLabel"))
            if let img = JobPhoto.image(photo) {
                Image(uiImage: img).resizable().scaledToFill()
                    .frame(maxWidth: .infinity).frame(height: 180).clipped()
                    .overlay(Rectangle().stroke(Color.dizLine, lineWidth: 1).allowsHitTesting(false))
                Button(store.tr("removePhotoBtn")) { photo = nil }.font(.subheadline).foregroundColor(.red)
            } else {
                Button { showChoice = true } label: {
                    Text(store.tr("photoTriggerBtn")).font(.system(size: 17, weight: .semibold)).frame(maxWidth: .infinity).padding(.vertical, 12)
                }
                .foregroundColor(.dizBrand)
                .overlay(Rectangle().stroke(Color.dizBrand, lineWidth: 1).allowsHitTesting(false))
            }
        }
        .confirmationDialog(store.tr("photoTriggerBtn"), isPresented: $showChoice) {
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button(store.tr("docs.takePhoto")) { showCamera = true }
            }
            Button(store.tr("photoChooseBtn")) { showLibrary = true }
        }
        .photosPicker(isPresented: $showLibrary, selection: $item, matching: .images)
        .sheet(isPresented: $showCamera) {
            CameraPicker { image in photo = JobPhoto.dataURL(image) }.ignoresSafeArea()
        }
        .onChange(of: item) { newItem in
            guard let newItem = newItem else { return }
            Task {
                if let data = try? await newItem.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                    photo = JobPhoto.dataURL(img)
                }
                item = nil
            }
        }
    }
}

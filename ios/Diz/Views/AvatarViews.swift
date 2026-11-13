import SwiftUI
import PhotosUI

/// Round profile photo, or the first letter of the name while there is none (or it is loading).
struct AvatarView: View {
    let url: URL?
    let name: String
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            Circle().fill(Color.dizLine)
            Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                .font(.system(size: size * 0.42, weight: .bold)).foregroundColor(.dizMuted)
            if let url {
                AsyncImage(url: url) { phase in
                    if let img = phase.image { img.resizable().scaledToFill() } else { Color.clear }
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

/// Provider profile: required profile photo (front camera or photo library). Customers see it with offers.
struct AvatarCard: View {
    @EnvironmentObject var store: Store
    @State private var item: PhotosPickerItem?
    @State private var showCamera = false

    private var has: Bool { !(store.user?.avatarUrl ?? "").isEmpty }

    var body: some View {
        Card {
            HStack(spacing: 14) {
                AvatarView(url: store.photoURL(store.user?.phone), name: store.user?.name ?? "", size: 96)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(store.tr("avatar.title")).font(.system(size: 16, weight: .semibold)).foregroundColor(.dizMuted)
                        if !has {
                            Text(store.tr("avatar.required")).font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                                .padding(.horizontal, 8).padding(.vertical, 1).background(Capsule().fill(Color.red))
                        }
                    }
                    Text(store.tr("avatar.hint")).font(.system(size: 16)).foregroundColor(.dizMuted)
                }
            }
            HStack(spacing: 10) {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button(store.tr("avatar.takePhoto")) { showCamera = true }.buttonStyle(.bordered)
                }
                PhotosPicker(selection: $item, matching: .images) { Text(store.tr(has ? "avatar.change" : "avatar.choose")) }
                    .buttonStyle(.bordered)
            }
            .disabled(store.busy)
        }
        .sheet(isPresented: $showCamera) {
            CameraPicker(front: true) { image in Task { await store.uploadAvatar(image) } }.ignoresSafeArea()
        }
        .onChange(of: item) { picked in
            guard let picked else { return }
            Task {
                if let data = try? await picked.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                    await store.uploadAvatar(img)
                } else {
                    store.toast("avatar.badType")
                }
                item = nil
            }
        }
    }
}

/// Banner for providers without a photo: opens the profile tab.
struct PhotoNudge: View {
    @EnvironmentObject var store: Store
    var body: some View {
        if store.providerMissingPhoto {
            VStack(alignment: .leading, spacing: 8) {
                Text(store.tr("avatar.nudge")).font(.system(size: 17)).foregroundColor(.dizInk)
                Button(store.tr("avatar.nudgeBtn")) { store.openProfileTab() }.buttonStyle(.bordered)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.dizSoft).overlay(Rectangle().stroke(Color.dizLine, lineWidth: 1).allowsHitTesting(false))
        }
    }
}

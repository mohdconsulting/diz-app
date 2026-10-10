import SwiftUI
import MapKit

private struct Pin: Identifiable { let id = "p"; let coordinate: CLLocationCoordinate2D }

/// Customer's live view of the provider's position (polled every few seconds by the Store).
struct TrackingBlock: View {
    @EnvironmentObject var store: Store
    let job: Job
    @Binding var showMap: Bool

    var body: some View {
        if let loc = store.locations[job.id] {
            let ageSec = max(0, Int(Date().timeIntervalSince1970) - Int(loc.updatedAt / 1000))
            let stale = ageSec > 120
            VStack(alignment: .leading, spacing: 6) {
                Text(store.tr("track.onTheWay")).font(.footnote.bold())
                Text(store.tr("track.ago", ["t": ageText(ageSec)])).font(.caption).foregroundColor(.secondary)
                if stale { Text(store.tr("track.stale")).font(.caption).foregroundColor(.orange) }
                Button(showMap ? store.tr("track.hideMap") : store.tr("track.showMap")) { showMap.toggle() }.font(.footnote)
                if showMap {
                    let c = CLLocationCoordinate2D(latitude: loc.lat, longitude: loc.lng)
                    Map(coordinateRegion: .constant(MKCoordinateRegion(center: c, span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02))),
                        annotationItems: [Pin(coordinate: c)]) { p in
                        MapMarker(coordinate: p.coordinate, tint: .red)
                    }
                    .frame(height: 220).clipShape(RoundedRectangle(cornerRadius: 10))
                }
                Button(store.tr("openInMaps")) { openMaps(lat: loc.lat, lng: loc.lng) }.font(.footnote)
            }
        } else {
            Text(store.tr("track.notSharing")).font(.footnote).foregroundColor(.secondary)
        }
    }

    private func ageText(_ s: Int) -> String {
        s < 60 ? "\(s) " + store.tr("track.sec") : "\(s / 60) " + store.tr("track.min")
    }
}

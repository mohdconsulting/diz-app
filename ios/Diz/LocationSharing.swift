import Foundation
import CoreLocation

/// Shares the provider's position (foreground only) for accepted jobs until arrival, like src/tracking.ts.
/// Uses "when in use" permission, so sharing pauses when the app is not on screen.
@MainActor
final class LocationSharing: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var ids: Set<String> = []
    private var lastSent: Date = .distantPast
    private var running = false

    /// (jobId, lat, lng, accuracy) -> success. Returning false drops the job from sharing.
    var onFix: (@MainActor (String, Double, Double, Double?) async -> Bool)?
    var onDenied: (@MainActor (Bool) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 10
    }

    func update(jobIds: Set<String>) {
        ids = jobIds
        if ids.isEmpty { stopUpdates(); return }
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            onDenied?(true)
        default:
            onDenied?(false)
            startUpdates()
        }
    }

    func drop(_ id: String) {
        ids.remove(id)
        if ids.isEmpty { stopUpdates() }
    }

    func stop() { ids = []; stopUpdates() }

    private func startUpdates() {
        guard !running else { return }
        running = true
        lastSent = .distantPast
        manager.startUpdatingLocation()
    }

    private func stopUpdates() {
        guard running else { return }
        running = false
        manager.stopUpdatingLocation()
    }

    // MARK: CLLocationManagerDelegate
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            let s = manager.authorizationStatus
            if s == .denied || s == .restricted { self.onDenied?(true); self.stopUpdates() }
            else if s == .authorizedWhenInUse || s == .authorizedAlways {
                self.onDenied?(false)
                if !self.ids.isEmpty { self.startUpdates() }
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        Task { @MainActor in await self.send(loc) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    private func send(_ loc: CLLocation) async {
        let now = Date()
        guard !ids.isEmpty, now.timeIntervalSince(lastSent) >= Config.locationSendSeconds else { return }
        lastSent = now
        let acc: Double? = loc.horizontalAccuracy >= 0 ? loc.horizontalAccuracy : nil
        for id in ids {
            let ok = await onFix?(id, loc.coordinate.latitude, loc.coordinate.longitude, acc) ?? false
            if !ok { drop(id) }
        }
    }
}

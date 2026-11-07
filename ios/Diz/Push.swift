import UIKit
import UserNotifications

/// Push notifications (APNs). The server side is diz_push.sql + Edge Function send-push.
/// Notifications show in the notification centre even when the app is closed, and the number on the
/// app icon is set by the server ("badge"); it is cleared whenever the app is opened.
final class PushManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushManager()

    /// Called with the device token (hex) when iOS hands it over.
    var onToken: ((String) -> Void)?
    private(set) var token: String? = UserDefaults.standard.string(forKey: "apnsToken")

    /// Xcode/debug builds talk to Apple's sandbox, App Store/TestFlight builds to production.
    static var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    /// Asks for permission (once; later calls are silent) and registers with APNs.
    func requestAndRegister() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    func didRegister(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        token = hex
        UserDefaults.standard.set(hex, forKey: "apnsToken")
        onToken?(hex)
    }

    /// Clears the number on the app icon and the delivered notifications.
    func clearBadge() {
        let center = UNUserNotificationCenter.current()
        center.setBadgeCount(0)
        center.removeAllDeliveredNotifications()
    }

    // Show banners also while the app is open.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        completionHandler()
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = PushManager.shared
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushManager.shared.didRegister(deviceToken: deviceToken)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("push registration failed:", error.localizedDescription)
    }
}

import Foundation
import UserNotifications

@MainActor
final class NativeNotificationActions {
    static let shared = NativeNotificationActions()

    private init() {}

    func schedule(title: String, body: String, after seconds: TimeInterval) async throws -> String {
        _ = try await NativePermissionGate.shared.run(requiring: .notifications) {
            return true
        }

        let content = UNMutableNotificationContent()
        content.title = title.isEmpty ? "ZYRON" : title
        content.body = body
        content.sound = .default

        let delay = max(1, seconds)
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
        let identifier = "zyron-\(UUID().uuidString)"
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
        try await UNUserNotificationCenter.current().add(request)
        return identifier
    }
}

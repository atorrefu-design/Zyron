import Foundation
import UserNotifications

@MainActor
final class QuietResponseNotifier {
    static let shared = QuietResponseNotifier()

    private init() {}

    func requestAuthorizationIfNeeded() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()

        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .notDetermined:
            return (try? await center.requestAuthorization(options: [.alert, .badge])) == true
        case .denied:
            return false
        @unknown default:
            return false
        }
    }

    @discardableResult
    func deliver(text rawText: String) async -> Bool {
        let text = rawText
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !text.isEmpty, await requestAuthorizationIfNeeded() else { return false }

        let content = UNMutableNotificationContent()
        content.title = "ZYRON"
        content.body = text
        content.sound = nil
        content.threadIdentifier = "zyron-quiet-response"
        content.categoryIdentifier = "ZYRON_QUIET_RESPONSE"
        if #available(iOS 15.0, *) {
            content.interruptionLevel = .passive
        }

        let request = UNNotificationRequest(
            identifier: "zyron-quiet-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )

        do {
            try await UNUserNotificationCenter.current().add(request)
            return true
        } catch {
            return false
        }
    }
}

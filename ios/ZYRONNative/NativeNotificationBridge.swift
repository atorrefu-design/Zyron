import Foundation
import UIKit
import UserNotifications

@MainActor
final class NativeNotificationBridge: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NativeNotificationBridge()

    static let categoryIdentifier = "ZYRON_ASSISTANT"
    static let talkActionIdentifier = "ZYRON_TALK"
    static let webActionIdentifier = "ZYRON_OPEN_WEB"

    private override init() {
        super.init()
    }

    func configure() {
        let talk = UNNotificationAction(
            identifier: Self.talkActionIdentifier,
            title: "Hablar con ZYRON",
            options: [.foreground]
        )
        let openWeb = UNNotificationAction(
            identifier: Self.webActionIdentifier,
            title: "Abrir ZYRON",
            options: [.foreground]
        )
        let category = UNNotificationCategory(
            identifier: Self.categoryIdentifier,
            actions: [talk, openWeb],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )

        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories([category])
    }

    func requestAuthorization() async -> Bool {
        do {
            return try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            return false
        }
    }

    func sendLocal(
        title: String,
        body: String,
        route: String? = nil,
        after seconds: TimeInterval = 0.5
    ) async throws {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.categoryIdentifier = Self.categoryIdentifier
        if let route, !route.isEmpty {
            content.userInfo["zyronRoute"] = route
        }

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(0.5, seconds), repeats: false)
        let request = UNNotificationRequest(
            identifier: "zyron-\(UUID().uuidString)",
            content: content,
            trigger: trigger
        )
        try await UNUserNotificationCenter.current().add(request)
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let action = response.actionIdentifier
        let route = response.notification.request.content.userInfo["zyronRoute"] as? String

        await MainActor.run {
            switch action {
            case Self.talkActionIdentifier:
                NotificationCenter.default.post(name: .zyronStartVoiceRequested, object: nil)
            case Self.webActionIdentifier:
                Self.openWeb(route: route)
            case UNNotificationDefaultActionIdentifier:
                if let route {
                    Self.openWeb(route: route)
                }
            default:
                break
            }
        }
    }

    private static func openWeb(route: String?) {
        let base = "https://zyron-five.vercel.app"
        let normalized: String
        if let route, !route.isEmpty {
            normalized = route.hasPrefix("/") ? route : "/\(route)"
        } else {
            normalized = "/"
        }
        guard let url = URL(string: base + normalized) else { return }
        UIApplication.shared.open(url)
    }
}

extension Notification.Name {
    static let zyronStartVoiceRequested = Notification.Name("zyron.startVoiceRequested")
}

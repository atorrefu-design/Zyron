import SwiftUI
import UIKit

@main
struct ZYRONApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var controller = ZyronAppController()

    init() {
        NativeNotificationBridge.shared.configure()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(controller)
                .task {
                    await controller.restore()
                    await handlePendingIntent()
                }
                .onReceive(NotificationCenter.default.publisher(for: .zyronStartVoiceRequested)) { _ in
                    Task { await controller.startManualConversation() }
                }
                .onChange(of: scenePhase) { phase in
                    guard phase == .active else { return }
                    Task { await handlePendingIntent() }
                }
        }
    }

    @MainActor
    private func handlePendingIntent() async {
        let key = "zyron.intent.pending-action"
        guard let raw = UserDefaults.standard.string(forKey: key) else { return }
        UserDefaults.standard.removeObject(forKey: key)

        switch raw {
        case "voice":
            await controller.startManualConversation()
        case "briefing":
            openWeb("/briefing")
        case "mobility":
            openWeb("/maps")
        case "diagnostics":
            openWeb("/diagnostics")
        case "web":
            openWeb("/")
        default:
            break
        }
    }

    @MainActor
    private func openWeb(_ route: String) {
        guard let url = URL(string: "https://zyron-five.vercel.app\(route)") else { return }
        UIApplication.shared.open(url)
    }
}

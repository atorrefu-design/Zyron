import SwiftUI
import UIKit

@main
struct ZYRONApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var controller = ZyronAppController()

    init() {
        NativeNotificationBridge.shared.configure()
        VoiceDiagnosticsLog.record("app_init")
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(controller)
                .task {
                    VoiceDiagnosticsLog.record("app_task_started")
                    await controller.restore()
                    await handlePendingIntent()
                }
                .onReceive(NotificationCenter.default.publisher(for: .zyronStartVoiceRequested)) { _ in
                    VoiceDiagnosticsLog.record("notification_requested_voice")
                    Task { await controller.startManualConversation() }
                }
                .onChange(of: scenePhase) { phase in
                    switch phase {
                    case .active:
                        VoiceDiagnosticsLog.record("scene_active")
                        Task {
                            await controller.companionBecameActive()
                            await handlePendingIntent()
                        }
                    case .inactive:
                        VoiceDiagnosticsLog.record("scene_inactive")
                    case .background:
                        VoiceDiagnosticsLog.record("scene_background")
                    @unknown default:
                        VoiceDiagnosticsLog.record("scene_unknown")
                    }
                }
        }
    }

    @MainActor
    private func handlePendingIntent() async {
        let key = "zyron.intent.pending-action"
        guard let raw = UserDefaults.standard.string(forKey: key) else { return }
        UserDefaults.standard.removeObject(forKey: key)
        VoiceDiagnosticsLog.record("pending_intent_\(raw)")

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

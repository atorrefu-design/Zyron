import SwiftUI

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
        let key = "zyron.intent.start-voice"
        guard UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(false, forKey: key)
        await controller.startManualConversation()
    }
}

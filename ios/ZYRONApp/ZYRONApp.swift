import AppIntents
import SwiftUI

@main
struct ZYRONApp: App {
    @StateObject private var controller = ZyronAppController()

    init() {
        ZyronAppShortcuts.updateAppShortcutParameters()
        print("ZYRON_APP_INIT_OK")
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(controller)
        }
    }
}

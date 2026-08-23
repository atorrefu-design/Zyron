import SwiftUI

@main
struct ZYRONApp: App {
    @StateObject private var controller = ZyronAppController()

    init() {
        print("ZYRON_APP_INIT_OK")
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(controller)
        }
    }
}

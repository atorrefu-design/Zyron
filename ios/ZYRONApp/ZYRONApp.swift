import SwiftUI

@main
struct ZYRONApp: App {
    @StateObject private var controller = ZyronAppController()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(controller)
                .task {
                    await controller.restore()
                }
        }
    }
}

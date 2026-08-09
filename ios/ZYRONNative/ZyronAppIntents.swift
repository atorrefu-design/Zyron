import AppIntents
import Foundation

private enum ZyronIntentKeys {
    static let startVoice = "zyron.intent.start-voice"
}

struct StartZyronIntent: AppIntent {
    static var title: LocalizedStringResource = "Hablar con ZYRON"
    static var description = IntentDescription("Abre ZYRON y prepara una conversación de voz.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set(true, forKey: ZyronIntentKeys.startVoice)
        return .result()
    }
}

struct EnableZyronNotificationsIntent: AppIntent {
    static var title: LocalizedStringResource = "Activar avisos de ZYRON"
    static var description = IntentDescription("Solicita permiso para que ZYRON pueda mostrar avisos y acciones rápidas en el iPhone.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        NativeNotificationBridge.shared.configure()
        let granted = await NativeNotificationBridge.shared.requestAuthorization()
        return .result(dialog: IntentDialog(stringLiteral: granted
            ? "Avisos de ZYRON activados."
            : "No se han activado los avisos. Puedes permitirlos más adelante desde Ajustes."))
    }
}

struct TestZyronNotificationIntent: AppIntent {
    static var title: LocalizedStringResource = "Probar aviso de ZYRON"
    static var description = IntentDescription("Envía un aviso local de prueba con accesos rápidos para hablar con ZYRON o abrir su web.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        NativeNotificationBridge.shared.configure()
        let granted = await NativeNotificationBridge.shared.requestAuthorization()
        guard granted else {
            return .result(dialog: "Necesito permiso de notificaciones para hacer la prueba.")
        }

        try await NativeNotificationBridge.shared.sendLocal(
            title: "ZYRON",
            body: "Companion activo. Puedes hablar conmigo o abrir el núcleo web.",
            route: "/"
        )
        return .result(dialog: "Aviso de prueba enviado.")
    }
}

struct ZyronAppShortcuts: AppShortcutsProvider {
    @AppShortcutsBuilder
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartZyronIntent(),
            phrases: [
                "Hablar con \(.applicationName)",
                "Activa \(.applicationName)",
                "Abre \(.applicationName)",
            ],
            shortTitle: "Hablar con ZYRON",
            systemImageName: "waveform.circle.fill"
        )

        AppShortcut(
            intent: EnableZyronNotificationsIntent(),
            phrases: [
                "Activa los avisos de \(.applicationName)",
            ],
            shortTitle: "Activar avisos",
            systemImageName: "bell.badge.fill"
        )

        AppShortcut(
            intent: TestZyronNotificationIntent(),
            phrases: [
                "Prueba un aviso de \(.applicationName)",
            ],
            shortTitle: "Probar aviso",
            systemImageName: "bell.and.waves.left.and.right.fill"
        )
    }
}

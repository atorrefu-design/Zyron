import AppIntents
import Foundation

struct OpenZyronIntent: AppIntent {
    static var title: LocalizedStringResource = "Abrir ZYRON"
    static var description = IntentDescription("Abre ZYRON para continuar desde el iPhone.")
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        .result()
    }
}

struct TalkToZyronIntent: AppIntent {
    static var title: LocalizedStringResource = "Hablar con ZYRON"
    static var description = IntentDescription(
        "Activa ZYRON sin abrir la app."
    )

    static var openAppWhenRun = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    func perform() async throws -> some IntentResult & ProvidesDialog {
        UserDefaults.standard.set(
            true,
            forKey: "zyron.intent.start-voice"
        )

        return .result(dialog: "ZYRON activado")
    }
}

struct OpenZyronWebIntent: AppIntent {
    static var openAppWhenRun: Bool = true
    static var title: LocalizedStringResource = "Abrir ZYRON Web"
    static var description = IntentDescription("Abre la interfaz web de ZYRON.")

    func perform() async throws -> some IntentResult & OpensIntent {
        .result()
    }
}

struct ZyronAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: TalkToZyronIntent(),
            phrases: [
                "Hablar con \(.applicationName)",
                "Abre \(.applicationName)",
                "Quiero hablar con \(.applicationName)"
            ],
            shortTitle: "Hablar con ZYRON",
            systemImageName: "waveform.circle.fill"
        )

        AppShortcut(
            intent: OpenZyronWebIntent(),
            phrases: [
                "Abrir \(.applicationName) web",
                "Abrir la web de \(.applicationName)"
            ],
            shortTitle: "ZYRON Web",
            systemImageName: "globe"
        )
    }
}

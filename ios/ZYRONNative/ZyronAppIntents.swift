import AppIntents
import Foundation

private enum ZyronIntentKeys {
    static let pendingAction = "zyron.intent.pending-action"

    enum Action: String {
        case voice
        case web
        case briefing
        case mobility
        case diagnostics
    }

    static func set(_ action: Action) {
        UserDefaults.standard.set(action.rawValue, forKey: pendingAction)
    }
}

struct AskZyronIntent: AppIntent {
    static var title: LocalizedStringResource = "Preguntar a ZYRON"
    static var description = IntentDescription("Envía una pregunta directamente al núcleo privado de ZYRON y devuelve la respuesta sin abrir la interfaz.")

    @Parameter(
        title: "Pregunta",
        requestValueDialog: IntentDialog("¿Qué quieres preguntarle a ZYRON?")
    )
    var query: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let clean = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else {
            return .result(dialog: "Dime qué necesitas y se lo paso a ZYRON.")
        }

        guard NativeAPIClient.shared.hasOwnerSession else {
            return .result(dialog: "Primero abre la app companion de ZYRON e inicia sesión una vez en este iPhone.")
        }

        do {
            let reply = try await NativeAPIClient.shared.queryCore(clean)
            return .result(dialog: IntentDialog(stringLiteral: reply))
        } catch {
            return .result(dialog: IntentDialog(stringLiteral: "No he podido consultar el núcleo de ZYRON: \(error.localizedDescription)"))
        }
    }
}

struct StartZyronIntent: AppIntent {
    static var title: LocalizedStringResource = "Hablar con ZYRON"
    static var description = IntentDescription("Abre ZYRON y prepara una conversación de voz.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        ZyronIntentKeys.set(.voice)
        return .result()
    }
}

struct OpenZyronWebIntent: AppIntent {
    static var title: LocalizedStringResource = "Abrir ZYRON Web"
    static var description = IntentDescription("Abre el núcleo web de ZYRON.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        ZyronIntentKeys.set(.web)
        return .result()
    }
}

struct OpenZyronBriefingIntent: AppIntent {
    static var title: LocalizedStringResource = "Briefing de ZYRON"
    static var description = IntentDescription("Abre el resumen del día de ZYRON.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        ZyronIntentKeys.set(.briefing)
        return .result()
    }
}

struct OpenZyronMobilityIntent: AppIntent {
    static var title: LocalizedStringResource = "Movilidad de ZYRON"
    static var description = IntentDescription("Abre la vista de movilidad y tráfico de ZYRON.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        ZyronIntentKeys.set(.mobility)
        return .result()
    }
}

struct OpenZyronDiagnosticsIntent: AppIntent {
    static var title: LocalizedStringResource = "Diagnóstico de ZYRON"
    static var description = IntentDescription("Comprueba el estado del núcleo cloud y del iPhone.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        ZyronIntentKeys.set(.diagnostics)
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
    static var description = IntentDescription("Envía un aviso local de prueba con accesos rápidos de ZYRON.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        NativeNotificationBridge.shared.configure()
        let granted = await NativeNotificationBridge.shared.requestAuthorization()
        guard granted else {
            return .result(dialog: "Necesito permiso de notificaciones para hacer la prueba.")
        }

        try await NativeNotificationBridge.shared.sendLocal(
            title: "ZYRON",
            body: "Companion activo. Puedes hablar conmigo, abrir el briefing o revisar movilidad.",
            route: "/"
        )
        return .result(dialog: "Aviso de prueba enviado.")
    }
}

struct ZyronAppShortcuts: AppShortcutsProvider {
    @AppShortcutsBuilder
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AskZyronIntent(),
            phrases: [
                "Pregunta a \(.applicationName) \(\.$query)",
                "Dile a \(.applicationName) \(\.$query)",
                "Consulta a \(.applicationName) \(\.$query)",
            ],
            shortTitle: "Preguntar a ZYRON",
            systemImageName: "sparkles"
        )

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
            intent: OpenZyronBriefingIntent(),
            phrases: [
                "Ponme al día con \(.applicationName)",
                "Briefing de \(.applicationName)",
            ],
            shortTitle: "Briefing",
            systemImageName: "sun.horizon.fill"
        )

        AppShortcut(
            intent: OpenZyronMobilityIntent(),
            phrases: [
                "Movilidad con \(.applicationName)",
                "Tráfico con \(.applicationName)",
            ],
            shortTitle: "Movilidad",
            systemImageName: "car.fill"
        )

        AppShortcut(
            intent: OpenZyronWebIntent(),
            phrases: ["Abrir web de \(.applicationName)"],
            shortTitle: "ZYRON Web",
            systemImageName: "globe"
        )

        AppShortcut(
            intent: OpenZyronDiagnosticsIntent(),
            phrases: ["Diagnóstico de \(.applicationName)"],
            shortTitle: "Diagnóstico",
            systemImageName: "stethoscope"
        )

        AppShortcut(
            intent: EnableZyronNotificationsIntent(),
            phrases: ["Activa los avisos de \(.applicationName)"],
            shortTitle: "Activar avisos",
            systemImageName: "bell.badge.fill"
        )

        AppShortcut(
            intent: TestZyronNotificationIntent(),
            phrases: ["Prueba un aviso de \(.applicationName)"],
            shortTitle: "Probar aviso",
            systemImageName: "bell.and.waves.left.and.right.fill"
        )
    }
}

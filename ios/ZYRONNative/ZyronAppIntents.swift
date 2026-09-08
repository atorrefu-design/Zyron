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

private func requireZyronSession() -> IntentDialog? {
    NativeAPIClient.shared.hasOwnerSession
        ? nil
        : IntentDialog("Primero abre la app companion de ZYRON e inicia sesión una vez en este iPhone.")
}

enum ZyronBluetoothContext: String, AppEnum {
    case vehicle
    case headphones
    case work
    case home
    case other

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Contexto Bluetooth")
    static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .vehicle: "Coche",
        .headphones: "Auriculares",
        .work: "Trabajo",
        .home: "Casa",
        .other: "Otro",
    ]
}

enum ZyronBluetoothAction: String, AppEnum {
    case briefing
    case dailyPlan = "daily_plan"
    case diagnostics
    case recordOnly = "record_only"

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Acción de ZYRON")
    static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .briefing: "Preparar briefing",
        .dailyPlan: "Preparar plan del día",
        .diagnostics: "Comprobar sistemas",
        .recordOnly: "Solo activar contexto",
    ]
}

struct BluetoothContextZyronIntent: AppIntent {
    static var title: LocalizedStringResource = "Contexto Bluetooth ZYRON"
    static var description = IntentDescription(
        "Informa a ZYRON de una conexión Bluetooth y ejecuta una función segura sin usar IA."
    )
    static var openAppWhenRun = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Contexto", default: .vehicle)
    var context: ZyronBluetoothContext

    @Parameter(title: "Función", default: .briefing)
    var action: ZyronBluetoothAction

    @Parameter(title: "Nombre del dispositivo")
    var deviceName: String?

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        if let dialog = requireZyronSession() { return .result(dialog: dialog) }
        do {
            let reply = try await NativeAPIClient.shared.handleBluetoothConnection(
                context: context.rawValue,
                action: action.rawValue,
                deviceName: deviceName
            )
            return .result(dialog: IntentDialog(stringLiteral: reply))
        } catch {
            return .result(dialog: IntentDialog(stringLiteral: "No he podido activar el contexto Bluetooth: \(error.localizedDescription)"))
        }
    }
}

// These AppIntents remain available as iOS integration primitives, but they are deliberately
// not advertised as conversational Siri phrases. The primary voice interface is the local
// wake word «ZYRON» handled by Porcupine inside the companion app.
struct AskZyronIntent: AppIntent {
    static var title: LocalizedStringResource = "Consultar ZYRON"
    static var description = IntentDescription("Envía texto directamente al núcleo privado de ZYRON desde una automatización de iOS.")

    @Parameter(title: "Consulta")
    var query: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let clean = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return .result(dialog: "Falta la consulta.") }
        if let dialog = requireZyronSession() { return .result(dialog: dialog) }

        do {
            let reply = try await NativeAPIClient.shared.queryCore(clean)
            return .result(dialog: IntentDialog(stringLiteral: reply))
        } catch {
            return .result(dialog: IntentDialog(stringLiteral: "No he podido consultar el núcleo de ZYRON: \(error.localizedDescription)"))
        }
    }
}

struct CreateZyronTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Crear tarea en ZYRON"
    static var description = IntentDescription("Crea una tarea en el sistema privado de ZYRON desde una automatización.")

    @Parameter(title: "Tarea")
    var title: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return .result(dialog: "Falta el texto de la tarea.") }
        if let dialog = requireZyronSession() { return .result(dialog: dialog) }

        do {
            let reply = try await NativeAPIClient.shared.createTask(title: clean)
            return .result(dialog: IntentDialog(stringLiteral: reply))
        } catch {
            return .result(dialog: IntentDialog(stringLiteral: "No he podido crear la tarea: \(error.localizedDescription)"))
        }
    }
}

struct CalendarZyronIntent: AppIntent {
    static var title: LocalizedStringResource = "Acción de calendario ZYRON"
    static var description = IntentDescription("Ejecuta una orden de calendario desde una automatización. Las operaciones destructivas mantienen sus confirmaciones.")

    @Parameter(title: "Orden")
    var command: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let clean = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return .result(dialog: "Falta la orden de calendario.") }
        if let dialog = requireZyronSession() { return .result(dialog: dialog) }

        do {
            let reply = try await NativeAPIClient.shared.runCalendarCommand(clean)
            return .result(dialog: IntentDialog(stringLiteral: reply))
        } catch {
            return .result(dialog: IntentDialog(stringLiteral: "No he podido ejecutar la orden de calendario: \(error.localizedDescription)"))
        }
    }
}

struct StartZyronIntent: AppIntent {
    static var title: LocalizedStringResource = "Recuperar voz de ZYRON"
    static var description = IntentDescription("Fallback técnico para reabrir el companion si iOS ha detenido la escucha local.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        ZyronIntentKeys.set(.voice)
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
            body: "Companion activo.",
            route: "/"
        )
        return .result(dialog: "Aviso de prueba enviado.")
    }
}

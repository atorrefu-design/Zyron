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
        "Abre el companion e inicia una conversación de voz con el núcleo privado de ZYRON."
    )

    // WebRTC and the microphone belong to the companion process. Opening the app is
    // required for a reliable session; claiming background activation would be false.
    static var openAppWhenRun = true
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    func perform() async throws -> some IntentResult & ProvidesDialog {
        UserDefaults.standard.set(
            true,
            forKey: "zyron.intent.start-voice"
        )

        return .result(dialog: "ZYRON activado")
    }
}

struct VehicleModeZyronIntent: AppIntent {
    static var title: LocalizedStringResource = "Modo coche ZYRON"
    static var isDiscoverable: Bool = true
    static var description = IntentDescription(
        "Al conectarse al Bluetooth del coche, ZYRON saluda, pregunta el destino e inicia la ruta en Google Maps."
    )
    static var openAppWhenRun = true
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Nombre del coche")
    var deviceName: String?

    @MainActor
    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set(true, forKey: "zyron.intent.start-voice")
        UserDefaults.standard.set(true, forKey: "zyron.intent.vehicle-mode")
        NotificationCenter.default.post(name: Notification.Name("zyron.intent.vehicle-requested"), object: nil)

        if NativeAPIClient.shared.hasOwnerSession {
            _ = try? await NativeAPIClient.shared.handleBluetoothConnection(
                context: "vehicle",
                action: "record_only",
                deviceName: deviceName
            )
        }
        return .result()
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
                "Quiero hablar con \(.applicationName)",
                "Activa \(.applicationName)"
            ],
            shortTitle: "Hablar con ZYRON",
            systemImageName: "waveform.circle.fill"
        )

        AppShortcut(
            intent: VehicleModeZyronIntent(),
            phrases: [
                "Activa el modo coche de \(.applicationName)",
                "Inicia el modo coche con \(.applicationName)"
            ],
            shortTitle: "Modo coche ZYRON",
            systemImageName: "car.fill"
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

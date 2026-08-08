import AppIntents

struct StartZyronIntent: AppIntent {
    static var title: LocalizedStringResource = "Activar ZYRON"
    static var description = IntentDescription("Abre ZYRON para recuperar la escucha de voz si iOS la ha detenido.")
    static var supportedModes: IntentModes = [.foreground(.immediate)]

    @MainActor
    func perform() async throws -> some IntentResult {
        return .result()
    }
}

struct ZyronAppShortcuts: AppShortcutsProvider {
    @AppShortcutsBuilder
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartZyronIntent(),
            phrases: [
                "Activa \(.applicationName)",
                "Hablar con \(.applicationName)",
                "Abre \(.applicationName)",
            ],
            shortTitle: "Activar ZYRON",
            systemImageName: "waveform.circle.fill"
        )
    }
}

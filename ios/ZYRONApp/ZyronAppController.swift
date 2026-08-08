import Combine
import Foundation

@MainActor
final class ZyronAppController: ObservableObject {
    @Published private(set) var isAuthenticated: Bool
    @Published private(set) var isBusy = false
    @Published private(set) var isAlwaysOnEnabled = false
    @Published private(set) var hasStoredPicovoiceKey: Bool
    @Published private(set) var runtimeState: ZyronVoiceRuntime.State = .stopped
    @Published private(set) var responseMode: ZyronResponseMode = VoiceCommunicationPolicy.current().responseMode
    @Published private(set) var latestText = ""
    @Published private(set) var statusMessage: String

    private static let alwaysOnPreferenceKey = "zyron.always-on-enabled"

    private let apiClient: NativeAPIClient
    private let locationProvider: NativeLocationProvider
    private var runtime: ZyronVoiceRuntime
    private var cancellables = Set<AnyCancellable>()
    private var didRestore = false

    init(apiClient: NativeAPIClient = .shared) {
        self.apiClient = apiClient
        self.locationProvider = NativeLocationProvider()
        self.runtime = NativeVoiceBootstrap.makeManualRuntime(apiClient: apiClient)
        self.isAuthenticated = apiClient.hasOwnerSession
        self.hasStoredPicovoiceKey = KeychainStore.picovoiceAccessKey() != nil
        self.statusMessage = apiClient.hasOwnerSession
            ? "Listo para la prueba de voz nativa."
            : "Inicia sesión para conectar este iPhone con ZYRON."

        bindRuntime()
        RealtimeToolRouter.shared.deviceLocationProvider = { [weak self] in
            guard let self else { return nil }
            return await self.locationProvider.currentLocation()
        }
    }

    var isConversationRunning: Bool {
        switch runtimeState {
        case .connecting, .active, .interrupted:
            return true
        default:
            return false
        }
    }

    var isListeningForWakeWord: Bool {
        isAlwaysOnEnabled && runtimeState == .passive
    }

    func restore() async {
        guard !didRestore else { return }
        didRestore = true

        isAuthenticated = apiClient.hasOwnerSession
        hasStoredPicovoiceKey = KeychainStore.picovoiceAccessKey() != nil

        guard isAuthenticated else {
            statusMessage = "Inicia sesión para conectar este iPhone con ZYRON."
            return
        }

        guard UserDefaults.standard.bool(forKey: Self.alwaysOnPreferenceKey) else {
            statusMessage = "Listo para la prueba de voz nativa."
            return
        }

        guard NativeVoiceBootstrap.hasAlwaysOnPermissions,
              let accessKey = KeychainStore.picovoiceAccessKey(),
              let resources = WakeWordModelProvisioner.cachedResources(accessKey: accessKey) else {
            statusMessage = "La escucha por nombre necesita terminar su preparación una vez."
            return
        }

        do {
            try installAlwaysOnRuntime(resources: resources)
            statusMessage = "Escuchando «ZYRON» de forma local."
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func login(ownerKey rawOwnerKey: String) async {
        let ownerKey = rawOwnerKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !ownerKey.isEmpty else {
            statusMessage = "Introduce la clave privada del propietario."
            return
        }

        isBusy = true
        statusMessage = "Conectando este iPhone con el núcleo privado…"
        defer { isBusy = false }

        do {
            try await apiClient.login(ownerKey: ownerKey)
            isAuthenticated = true
            statusMessage = "iPhone autenticado. Ya puedes probar la conversación nativa."
        } catch {
            isAuthenticated = false
            statusMessage = error.localizedDescription
        }
    }

    func startManualConversation() async {
        guard isAuthenticated else {
            statusMessage = "Primero inicia sesión en este iPhone."
            return
        }
        guard !isConversationRunning else { return }

        isBusy = true
        statusMessage = "Preparando el micrófono…"
        let microphoneGranted = await NativeVoiceBootstrap.requestConversationPermission()
        isBusy = false

        guard microphoneGranted else {
            statusMessage = "Activa el permiso de micrófono en Ajustes para hablar con ZYRON."
            return
        }

        statusMessage = "Conectando conversación Realtime…"
        runtime.startManualConversation()
    }

    func stopConversation() {
        runtime.stopConversation()
        statusMessage = isAlwaysOnEnabled
            ? "Conversación cerrada. Vuelvo a escuchar «ZYRON»."
            : "Conversación cerrada."
    }

    func enableAlwaysOn(accessKey rawAccessKey: String) async {
        guard isAuthenticated else {
            statusMessage = "Primero inicia sesión en este iPhone."
            return
        }

        let typedKey = rawAccessKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let accessKey = typedKey.isEmpty ? KeychainStore.picovoiceAccessKey() ?? "" : typedKey
        guard !accessKey.isEmpty else {
            statusMessage = "Introduce una AccessKey de Picovoice para preparar «ZYRON»."
            return
        }

        isBusy = true
        statusMessage = "Concediendo permisos y preparando la escucha local…"
        defer { isBusy = false }

        let permissions = await NativeVoiceBootstrap.requestPermissions()
        guard permissions.readyForAlwaysOn else {
            statusMessage = "Activa Micrófono y Reconocimiento de voz en Ajustes para usar «ZYRON»."
            return
        }

        do {
            let resources = try await WakeWordModelProvisioner.prepare(accessKey: accessKey)
            try installAlwaysOnRuntime(resources: resources)
            try KeychainStore.savePicovoiceAccessKey(accessKey)
            hasStoredPicovoiceKey = true
            UserDefaults.standard.set(true, forKey: Self.alwaysOnPreferenceKey)
            statusMessage = "Escuchando «ZYRON» de forma local. Ya puedes bloquear el iPhone."
            _ = await QuietResponseNotifier.shared.requestAuthorizationIfNeeded()
        } catch {
            isAlwaysOnEnabled = false
            UserDefaults.standard.set(false, forKey: Self.alwaysOnPreferenceKey)
            replaceRuntime(with: NativeVoiceBootstrap.makeManualRuntime(apiClient: apiClient))
            statusMessage = error.localizedDescription
        }
    }

    func disableAlwaysOn() {
        runtime.stopAlwaysOn()
        isAlwaysOnEnabled = false
        UserDefaults.standard.set(false, forKey: Self.alwaysOnPreferenceKey)
        replaceRuntime(with: NativeVoiceBootstrap.makeManualRuntime(apiClient: apiClient))
        statusMessage = "Escucha por nombre desactivada. La conversación manual sigue disponible."
    }

    func logout() {
        runtime.stopAlwaysOn()
        apiClient.logout()
        KeychainStore.clearPicovoiceAccessKey()
        UserDefaults.standard.set(false, forKey: Self.alwaysOnPreferenceKey)
        replaceRuntime(with: NativeVoiceBootstrap.makeManualRuntime(apiClient: apiClient))

        isAuthenticated = false
        isAlwaysOnEnabled = false
        hasStoredPicovoiceKey = false
        latestText = ""
        statusMessage = "Sesión y claves locales eliminadas de este iPhone."
    }

    private func installAlwaysOnRuntime(resources: NativeVoiceBootstrap.Resources) throws {
        let prepared = try NativeVoiceBootstrap.makeRuntime(
            resources: resources,
            apiClient: apiClient
        )
        replaceRuntime(with: prepared)
        try runtime.startAlwaysOn()
        isAlwaysOnEnabled = true
        UserDefaults.standard.set(true, forKey: Self.alwaysOnPreferenceKey)
    }

    private func replaceRuntime(with replacement: ZyronVoiceRuntime) {
        runtime.stopAlwaysOn()
        cancellables.removeAll()
        runtime = replacement
        bindRuntime()
    }

    private func bindRuntime() {
        runtimeState = runtime.state
        responseMode = runtime.responseMode
        latestText = runtime.latestText

        runtime.$state
            .sink { [weak self] state in
                guard let self else { return }
                self.runtimeState = state
                self.updateStatus(for: state)
            }
            .store(in: &cancellables)

        runtime.$responseMode
            .sink { [weak self] mode in
                self?.responseMode = mode
            }
            .store(in: &cancellables)

        runtime.$latestText
            .sink { [weak self] text in
                guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                self?.latestText = text
            }
            .store(in: &cancellables)
    }

    private func updateStatus(for state: ZyronVoiceRuntime.State) {
        switch state {
        case .stopped:
            if !isBusy && isAuthenticated && !isAlwaysOnEnabled {
                statusMessage = "Listo para la prueba de voz nativa."
            }
        case .passive:
            statusMessage = "Escuchando «ZYRON» de forma local."
        case .candidate:
            statusMessage = "He oído «ZYRON». Validando la llamada en el iPhone…"
        case .connecting:
            statusMessage = "Conectando conversación Realtime…"
        case .active:
            statusMessage = responseMode == .audio
                ? "Conversación activa. Habla con naturalidad."
                : "Conversación activa en modo silencioso."
        case .interrupted:
            statusMessage = "Conversación interrumpida por iOS; intentaré recuperarla."
        case let .failed(message):
            statusMessage = message
        }
    }
}

import Foundation

@MainActor
final class NativeActionRouter {
    static let shared = NativeActionRouter()

    private init() {}

    struct Result: Equatable {
        let handled: Bool
        let reply: String?
    }

    func executeSpokenCommand(_ rawCommand: String) async -> Result {
        let command = normalize(rawCommand)

        if isPermissionSetupCommand(command) {
            return await dispatch(action: "permissions.bootstrap", input: rawCommand)
        }

        if isStopRecordingCommand(command) {
            return await dispatch(action: "recording.stop", input: rawCommand)
        }

        if isStartRecordingCommand(command) {
            return await dispatch(action: "recording.start", input: rawCommand)
        }

        return Result(handled: false, reply: nil)
    }

    /// Executes a native directive emitted by the cloud action router.
    /// This is the generic bridge used by the web view / companion integration.
    func executeNativeDirective(
        action: String,
        input: String? = nil,
        capabilityId: String? = nil,
        payload: [String: String]? = nil
    ) async -> Result {
        let envelope = NativeActionEnvelope(
            action: action,
            input: input,
            capabilityId: capabilityId,
            payload: payload
        )
        let result = await NativeActionDispatcher.shared.execute(envelope)
        return Result(handled: result.handled, reply: result.reply)
    }

    private func dispatch(action: String, input: String) async -> Result {
        await executeNativeDirective(action: action, input: input)
    }

    private func isPermissionSetupCommand(_ command: String) -> Bool {
        [
            "configura los permisos",
            "configura todos los permisos",
            "activa los permisos",
            "prepara los permisos",
            "dame acceso a todo",
            "configura zyron",
        ].contains(where: command.contains)
    }

    private func isStartRecordingCommand(_ command: String) -> Bool {
        let stopWords = ["deja de grabar", "para de grabar", "deten la grabacion", "detener la grabacion", "termina de grabar"]
        guard !stopWords.contains(where: command.contains) else { return false }
        return [
            "graba la siguiente conversacion",
            "graba esta conversacion",
            "empieza a grabar",
            "inicia la grabacion",
            "ponte a grabar",
            "graba",
        ].contains(where: command.contains)
    }

    private func isStopRecordingCommand(_ command: String) -> Bool {
        [
            "deja de grabar",
            "para de grabar",
            "deten la grabacion",
            "detener la grabacion",
            "termina de grabar",
            "finaliza la grabacion",
        ].contains(where: command.contains)
    }

    private func normalize(_ value: String) -> String {
        value
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "es_ES"))
            .lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

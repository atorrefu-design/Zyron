import Foundation

/// Generic command envelope shared with the cloud `/api/act` response.
/// New native capabilities should register here instead of teaching the UI a
/// special-case protocol for every feature.
struct NativeActionEnvelope: Codable, Equatable {
    let action: String
    let input: String?
    let capabilityId: String?
    let payload: [String: String]?
}

@MainActor
final class NativeActionDispatcher {
    static let shared = NativeActionDispatcher()

    struct Result: Equatable {
        let handled: Bool
        let succeeded: Bool
        let reply: String?
        let value: String?
    }

    typealias Handler = (NativeActionEnvelope) async -> Result

    private var handlers: [String: Handler] = [:]

    private init() {
        registerBuiltIns()
    }

    func register(_ action: String, handler: @escaping Handler) {
        handlers[action] = handler
    }

    func execute(_ envelope: NativeActionEnvelope) async -> Result {
        guard let handler = handlers[envelope.action] else {
            WakeWordDiagnostics.shared.record("native_action_unhandled", detail: envelope.action)
            return Result(
                handled: false,
                succeeded: false,
                reply: nil,
                value: nil
            )
        }

        let result = await handler(envelope)
        WakeWordDiagnostics.shared.record(
            result.succeeded ? "native_action_succeeded" : "native_action_failed",
            detail: "\(envelope.action); capability=\(envelope.capabilityId ?? "unknown")"
        )
        return result
    }

    private func registerBuiltIns() {
        register("recording.start") { _ in
            do {
                let url = try await NativePermissionGate.shared.run(requiring: .microphone) {
                    try await NativeRecordingController.shared.start()
                }
                return Result(handled: true, succeeded: true, reply: "Grabando.", value: url.path)
            } catch {
                return Result(handled: true, succeeded: false, reply: error.localizedDescription, value: nil)
            }
        }

        register("recording.stop") { _ in
            do {
                let url = try NativeRecordingController.shared.stop()
                return Result(
                    handled: true,
                    succeeded: true,
                    reply: url == nil ? "No estaba grabando." : "Grabación guardada.",
                    value: url?.path
                )
            } catch {
                return Result(handled: true, succeeded: false, reply: error.localizedDescription, value: nil)
            }
        }

        register("permissions.bootstrap") { _ in
            let snapshot = await PermissionBootstrapper.shared.requestInitialPermissions()
            if snapshot.denied.isEmpty && snapshot.notDetermined.isEmpty {
                return Result(handled: true, succeeded: true, reply: "Permisos configurados.", value: nil)
            }
            if !snapshot.denied.isEmpty {
                return Result(
                    handled: true,
                    succeeded: false,
                    reply: "He configurado los permisos disponibles. Algunos siguen bloqueados en Ajustes.",
                    value: nil
                )
            }
            return Result(handled: true, succeeded: true, reply: "He iniciado la configuración de permisos.", value: nil)
        }
    }
}

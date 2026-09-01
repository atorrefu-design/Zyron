import Foundation

struct RealtimeToolCall {
    let callID: String
    let name: String
    let arguments: String
}

struct RealtimeToolOutput {
    let callID: String
    let output: String
}

final class RealtimeToolRouter {
    static let shared = RealtimeToolRouter()

    var deviceLocationProvider: (() async -> NativeDeviceLocation?)?

    private init() {}

    func execute(_ call: RealtimeToolCall) async -> RealtimeToolOutput {
        let query = decodeQuery(call.arguments)
        guard !query.isEmpty else {
            return RealtimeToolOutput(
                callID: call.callID,
                output: "No se recibió una consulta válida."
            )
        }

        let location = await deviceLocationProvider?()

        do {
            switch call.name {
            case "consultar_nucleo_zyron":
                let reply = try await NativeAPIClient.shared.queryCore(
                    query,
                    deviceLocation: location
                )
                return RealtimeToolOutput(callID: call.callID, output: reply)

            case "buscar_lugares_reales":
                let reply = try await NativeAPIClient.shared.searchPlaces(
                    query,
                    deviceLocation: location
                )
                return RealtimeToolOutput(callID: call.callID, output: reply)

            case "ejecutar_accion_iphone":
                let directive = try await NativeAPIClient.shared.resolveNativeAction(
                    query,
                    deviceLocation: location
                )
                guard directive.mode == "native_execute", let action = directive.action else {
                    let detail = directive.message ?? directive.reply ?? directive.error ?? "Esta acción todavía no está disponible en el iPhone."
                    return RealtimeToolOutput(callID: call.callID, output: detail)
                }
                let envelope = NativeActionEnvelope(
                    action: action,
                    input: directive.input ?? query,
                    capabilityId: directive.capabilityId,
                    payload: directive.payload
                )
                let result = await NativeActionDispatcher.shared.execute(envelope)
                guard result.handled else {
                    return RealtimeToolOutput(callID: call.callID, output: "El companion todavía no reconoce esta acción.")
                }
                return RealtimeToolOutput(
                    callID: call.callID,
                    output: result.reply ?? (result.succeeded ? "Hecho." : "El iPhone no ha podido preparar la acción.")
                )

            default:
                return RealtimeToolOutput(
                    callID: call.callID,
                    output: "Herramienta no disponible: \(call.name)."
                )
            }
        } catch {
            let detail = error.localizedDescription
            let prefix: String
            if call.name == "buscar_lugares_reales" { prefix = "No he podido buscar lugares reales" }
            else if call.name == "ejecutar_accion_iphone" { prefix = "No he podido preparar la acción en el iPhone" }
            else { prefix = "No he podido consultar el núcleo privado" }
            return RealtimeToolOutput(
                callID: call.callID,
                output: "\(prefix): \(detail)."
            )
        }
    }

    private func decodeQuery(_ rawArguments: String) -> String {
        guard let data = rawArguments.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let query = object["query"] as? String else {
            return ""
        }
        return query.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

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

        if isStopRecordingCommand(command) {
            do {
                let url = try NativeRecordingController.shared.stop()
                return Result(
                    handled: true,
                    reply: url == nil ? "No estaba grabando." : "Grabación guardada."
                )
            } catch {
                return Result(handled: true, reply: error.localizedDescription)
            }
        }

        if isStartRecordingCommand(command) {
            do {
                _ = try await NativeRecordingController.shared.start()
                return Result(handled: true, reply: "Grabando.")
            } catch {
                return Result(handled: true, reply: error.localizedDescription)
            }
        }

        return Result(handled: false, reply: nil)
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

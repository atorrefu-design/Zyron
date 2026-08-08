import Foundation
import CryptoKit

#if canImport(Porcupine)
import Porcupine
#endif

enum WakeWordModelProvisioner {
    private static let porcupineRevision = "c23ab023ae410766cb835446765537b25013b166"
    private static let spanishModelSHA256 = "114851cabd54342aa15b086740f5d6a85980d5a76bd5a8cbb7b0cc08c05702ba"
    private static let spanishModelURL = URL(
        string: "https://raw.githubusercontent.com/Picovoice/porcupine/\(porcupineRevision)/lib/common/porcupine_params_es.pv"
    )!

    static func prepare(accessKey rawAccessKey: String) async throws -> NativeVoiceBootstrap.Resources {
        let accessKey = rawAccessKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !accessKey.isEmpty else {
            throw WakeWordProvisioningError.missingAccessKey
        }

        let directory = try supportDirectory()
        let spanishURL = directory.appending(path: "porcupine_params_es.pv")
        let keywordURL = directory.appending(path: "ZYRON.ppn")

        try await ensureSpanishModel(at: spanishURL)
        try await ensureWakeWordModel(at: keywordURL, accessKey: accessKey)

        return NativeVoiceBootstrap.Resources(
            porcupineAccessKey: accessKey,
            wakeWordModelURL: keywordURL,
            spanishModelURL: spanishURL
        )
    }

    static func cachedResources(accessKey rawAccessKey: String) -> NativeVoiceBootstrap.Resources? {
        let accessKey = rawAccessKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !accessKey.isEmpty,
              let directory = try? supportDirectory() else {
            return nil
        }

        let spanishURL = directory.appending(path: "porcupine_params_es.pv")
        let keywordURL = directory.appending(path: "ZYRON.ppn")
        guard isValidSpanishModel(at: spanishURL),
              FileManager.default.fileExists(atPath: keywordURL.path) else {
            return nil
        }

        return NativeVoiceBootstrap.Resources(
            porcupineAccessKey: accessKey,
            wakeWordModelURL: keywordURL,
            spanishModelURL: spanishURL
        )
    }

    private static func supportDirectory() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = base.appending(path: "ZYRONVoice", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        return directory
    }

    private static func ensureSpanishModel(at destination: URL) async throws {
        guard !isValidSpanishModel(at: destination) else { return }

        let (data, response) = try await URLSession.shared.data(from: spanishModelURL)
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode),
              !data.isEmpty else {
            throw WakeWordProvisioningError.spanishModelDownloadFailed
        }
        guard digest(data) == spanishModelSHA256 else {
            throw WakeWordProvisioningError.spanishModelIntegrityFailed
        }

        try data.write(to: destination, options: .atomic)
        try protect(destination)
    }

    private static func ensureWakeWordModel(at destination: URL, accessKey: String) async throws {
        if FileManager.default.fileExists(atPath: destination.path) { return }

#if canImport(Porcupine)
        do {
            try await Task.detached(priority: .userInitiated) {
                try Porcupine.trainWakeWordFromPhrase(
                    accessKey: accessKey,
                    outputPath: destination.path,
                    language: "es",
                    phrase: "ZYRON"
                )
            }.value
            try protect(destination)
        } catch {
            try? FileManager.default.removeItem(at: destination)
            throw WakeWordProvisioningError.trainingFailed
        }
#else
        throw WakeWordProvisioningError.porcupineUnavailable
#endif
    }

    private static func isValidSpanishModel(at url: URL) -> Bool {
        guard let data = try? Data(contentsOf: url) else { return false }
        return digest(data) == spanishModelSHA256
    }

    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func protect(_ url: URL) throws {
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
    }
}

enum WakeWordProvisioningError: LocalizedError {
    case missingAccessKey
    case spanishModelDownloadFailed
    case spanishModelIntegrityFailed
    case trainingFailed
    case porcupineUnavailable

    var errorDescription: String? {
        switch self {
        case .missingAccessKey:
            return "Falta la AccessKey de Picovoice."
        case .spanishModelDownloadFailed:
            return "No se ha podido descargar el modelo español de escucha local."
        case .spanishModelIntegrityFailed:
            return "El modelo español descargado no ha superado la comprobación de integridad."
        case .trainingFailed:
            return "Picovoice no ha podido preparar la palabra de activación ZYRON. Revisa la AccessKey."
        case .porcupineUnavailable:
            return "La dependencia Porcupine no está disponible en la app."
        }
    }
}

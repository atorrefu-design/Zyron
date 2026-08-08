import Foundation

#if canImport(Porcupine)
import Porcupine
#endif

protocol WakeWordDetecting: AnyObject {
    var onDetection: (() -> Void)? { get set }
    func start() throws
    func stop()
    func delete()
}

enum WakeWordDetectorError: LocalizedError {
    case porcupineUnavailable
    case keywordMissing

    var errorDescription: String? {
        switch self {
        case .porcupineUnavailable:
            return "Falta añadir Porcupine al proyecto de Xcode."
        case .keywordMissing:
            return "No se encuentra el modelo local ZYRON.ppn."
        }
    }
}

#if canImport(Porcupine)
final class PorcupineWakeWordDetector: WakeWordDetecting {
    var onDetection: (() -> Void)?

    private var manager: PorcupineManager?

    init(accessKey: String, keywordURL: URL, spanishModelURL: URL? = nil) throws {
        guard FileManager.default.fileExists(atPath: keywordURL.path) else {
            throw WakeWordDetectorError.keywordMissing
        }

        let callback: (Int32) -> Void = { [weak self] keywordIndex in
            guard keywordIndex == 0 else { return }
            DispatchQueue.main.async {
                self?.onDetection?()
            }
        }

        if let spanishModelURL {
            manager = try PorcupineManager(
                accessKey: accessKey,
                keywordPath: keywordURL.path,
                modelPath: spanishModelURL.path,
                onDetection: callback
            )
        } else {
            manager = try PorcupineManager(
                accessKey: accessKey,
                keywordPath: keywordURL.path,
                onDetection: callback
            )
        }
    }

    func start() throws {
        try manager?.start()
    }

    func stop() {
        manager?.stop()
    }

    func delete() {
        manager?.delete()
        manager = nil
    }

    deinit {
        delete()
    }
}
#else
final class PorcupineWakeWordDetector: WakeWordDetecting {
    var onDetection: (() -> Void)?

    init(accessKey: String, keywordURL: URL, spanishModelURL: URL? = nil) throws {
        throw WakeWordDetectorError.porcupineUnavailable
    }

    func start() throws {
        throw WakeWordDetectorError.porcupineUnavailable
    }

    func stop() {}
    func delete() {}
}
#endif

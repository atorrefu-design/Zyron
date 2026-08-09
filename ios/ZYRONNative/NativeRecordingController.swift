import AVFoundation
import Foundation

@MainActor
final class NativeRecordingController: NSObject {
    static let shared = NativeRecordingController()

    enum RecordingState: Equatable {
        case idle
        case recording(URL)
        case failed(String)
    }

    private(set) var state: RecordingState = .idle
    private var recorder: AVAudioRecorder?

    var isRecording: Bool {
        if case .recording = state { return true }
        return false
    }

    func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    func start() async throws -> URL {
        if case let .recording(url) = state { return url }

        let granted = AVAudioSession.sharedInstance().recordPermission == .granted
            ? true
            : await requestPermission()
        guard granted else {
            let message = "El permiso de micrófono no está concedido."
            state = .failed(message)
            throw NativeRecordingError.microphonePermissionDenied
        }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)

        let url = try Self.makeRecordingURL()
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]

        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.delegate = self
        recorder.prepareToRecord()
        guard recorder.record() else {
            throw NativeRecordingError.couldNotStart
        }

        self.recorder = recorder
        state = .recording(url)
        WakeWordDiagnostics.shared.record("native_recording_started", detail: url.lastPathComponent)
        return url
    }

    @discardableResult
    func stop() throws -> URL? {
        guard let recorder else { return nil }
        let url = recorder.url
        recorder.stop()
        self.recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        state = .idle
        WakeWordDiagnostics.shared.record("native_recording_stopped", detail: url.lastPathComponent)
        return url
    }

    private static func makeRecordingURL() throws -> URL {
        let fm = FileManager.default
        let base = try fm.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = base.appending(path: "ZYRON Recordings", directoryHint: .isDirectory)
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd_HH-mm-ss"
        return directory.appending(path: "ZYRON_\(formatter.string(from: Date())).m4a")
    }
}

extension NativeRecordingController: AVAudioRecorderDelegate {
    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        Task { @MainActor in
            let message = error?.localizedDescription ?? "Error desconocido durante la grabación."
            self.state = .failed(message)
            self.recorder = nil
            WakeWordDiagnostics.shared.record("native_recording_failed", detail: message)
        }
    }
}

enum NativeRecordingError: LocalizedError {
    case microphonePermissionDenied
    case couldNotStart

    var errorDescription: String? {
        switch self {
        case .microphonePermissionDenied:
            return "ZYRON necesita permiso de micrófono para grabar."
        case .couldNotStart:
            return "El iPhone no ha podido iniciar la grabación."
        }
    }
}

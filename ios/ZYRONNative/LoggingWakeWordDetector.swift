import Foundation

@MainActor
final class LoggingWakeWordDetector: ContextAwareWakeWordDetecting {
    var onDetection: (() -> Void)?
    var onInvocationAudio: ((WakeWordAudioContext) -> Void)?

    private let wrapped: ContextAwareWakeWordDetecting

    init(wrapping wrapped: ContextAwareWakeWordDetecting) {
        self.wrapped = wrapped
        self.wrapped.onDetection = { [weak self] in
            VoiceDiagnosticsLog.record("wake_word_detected")
            self?.onDetection?()
        }
        self.wrapped.onInvocationAudio = { [weak self] context in
            VoiceDiagnosticsLog.record("wake_context_captured_\(context.postWakeDurationMs)ms")
            self?.onInvocationAudio?(context)
        }
    }

    func start() throws {
        VoiceDiagnosticsLog.record("wake_listener_start_requested")
        do {
            try wrapped.start()
            VoiceDiagnosticsLog.record("wake_listener_started")
        } catch {
            VoiceDiagnosticsLog.record("wake_listener_start_failed_\(error.localizedDescription)")
            throw error
        }
    }

    func stop() {
        VoiceDiagnosticsLog.record("wake_listener_stopped")
        wrapped.stop()
    }

    func delete() {
        VoiceDiagnosticsLog.record("wake_listener_deleted")
        wrapped.delete()
    }
}

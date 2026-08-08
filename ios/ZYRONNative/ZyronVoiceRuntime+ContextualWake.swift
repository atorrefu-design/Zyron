import Foundation

extension ZyronVoiceRuntime {
    func installContextAware(
        wakeDetector: ContextAwareWakeWordDetecting,
        transport: NativeRealtimeTransport,
        transcriber: OnDeviceInvocationTranscriber = OnDeviceInvocationTranscriber()
    ) {
        install(wakeDetector: wakeDetector, transport: transport)

        wakeDetector.onInvocationAudio = { [weak self, transcriber] context in
            Task { @MainActor [weak self, transcriber] in
                guard let self else { return }

                do {
                    let transcript = try await transcriber.transcribe(context)
                    self.handleLocalInvocationTranscript(
                        transcript,
                        silenceAfterWakeMs: context.postWakeDurationMs
                    )
                } catch {
                    // Privacy-first failure mode: if the local classifier cannot decide,
                    // do not open Realtime. The candidate state expires back to passive.
                }
            }
        }
    }
}

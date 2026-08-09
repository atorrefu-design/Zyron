import Foundation
import AVFoundation

@MainActor
struct NativeVoiceBootstrap {
    struct Resources {
        let porcupineAccessKey: String
        let wakeWordModelURL: URL
        let spanishModelURL: URL?

        init(
            porcupineAccessKey: String,
            wakeWordModelURL: URL,
            spanishModelURL: URL? = nil
        ) {
            self.porcupineAccessKey = porcupineAccessKey
            self.wakeWordModelURL = wakeWordModelURL
            self.spanishModelURL = spanishModelURL
        }

        static func bundled(
            porcupineAccessKey: String,
            bundle: Bundle = .main,
            wakeWordResource: String = "ZYRON",
            wakeWordExtension: String = "ppn",
            spanishModelResource: String? = nil,
            spanishModelExtension: String = "pv"
        ) throws -> Resources {
            guard !porcupineAccessKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw NativeVoiceBootstrapError.missingPorcupineAccessKey
            }
            guard let wakeURL = bundle.url(
                forResource: wakeWordResource,
                withExtension: wakeWordExtension
            ) else {
                throw NativeVoiceBootstrapError.missingWakeWordModel
            }

            let spanishURL = spanishModelResource.flatMap {
                bundle.url(forResource: $0, withExtension: spanishModelExtension)
            }

            return Resources(
                porcupineAccessKey: porcupineAccessKey,
                wakeWordModelURL: wakeURL,
                spanishModelURL: spanishURL
            )
        }
    }

    struct Permissions {
        let microphone: Bool
        let speechRecognition: Bool

        var readyForAlwaysOn: Bool {
            microphone && speechRecognition
        }
    }

    static func requestPermissions() async -> Permissions {
        let microphone = await requestMicrophonePermission()
        let speech = await OnDeviceInvocationTranscriber.requestAuthorization()
        return Permissions(
            microphone: microphone,
            speechRecognition: speech
        )
    }

    static func requestConversationPermission() async -> Bool {
        await requestMicrophonePermission()
    }

    static var hasAlwaysOnPermissions: Bool {
        AVAudioSession.sharedInstance().recordPermission == .granted
            && OnDeviceInvocationTranscriber.isAuthorized
    }

    static func makeManualRuntime(
        apiClient: NativeAPIClient = .shared
    ) -> ZyronVoiceRuntime {
        let runtime = ZyronVoiceRuntime()
        runtime.install(transport: WebRTCNativeTransport(apiClient: apiClient))
        return runtime
    }

    static func makeRuntime(
        resources: Resources,
        apiClient: NativeAPIClient = .shared
    ) throws -> ZyronVoiceRuntime {
        let wakeDetector = try ContextualPorcupineWakeWordDetector(
            accessKey: resources.porcupineAccessKey,
            keywordURL: resources.wakeWordModelURL,
            spanishModelURL: resources.spanishModelURL,
            contextWindowMs: VoiceEngagementRules.localContextWindowMs,
            postWakeDurationMs: VoiceEngagementRules.wakeConfirmationWindowMs
        )
        let transport = WebRTCNativeTransport(apiClient: apiClient)
        let runtime = ZyronVoiceRuntime()
        runtime.installContextAware(
            wakeDetector: wakeDetector,
            transport: transport,
            transcriber: OnDeviceInvocationTranscriber()
        )
        return runtime
    }

    private static func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }
}

enum NativeVoiceBootstrapError: LocalizedError {
    case missingPorcupineAccessKey
    case missingWakeWordModel

    var errorDescription: String? {
        switch self {
        case .missingPorcupineAccessKey:
            return "Falta la AccessKey local de Porcupine. No la guardes en GitHub."
        case .missingWakeWordModel:
            return "No se encuentra ZYRON.ppn dentro del bundle de la app."
        }
    }
}

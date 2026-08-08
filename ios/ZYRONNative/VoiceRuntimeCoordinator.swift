import Foundation
import Combine

@MainActor
final class VoiceRuntimeCoordinator: ObservableObject {
    enum State: Equatable {
        case passive
        case candidate
        case connecting
        case active
        case ending
        case error(String)
    }

    @Published private(set) var state: State = .passive
    @Published private(set) var responseMode: ZyronResponseMode = .audio

    private let wakeDetector: ContextAwareWakeWordDetecting
    private let engagementClassifier: NativeVoiceEngagementClassifier
    private let conversation: NativeRealtimeConversation
    private var idleTask: Task<Void, Never>?

    init(
        wakeDetector: ContextAwareWakeWordDetecting,
        engagementClassifier: NativeVoiceEngagementClassifier,
        conversation: NativeRealtimeConversation
    ) {
        self.wakeDetector = wakeDetector
        self.engagementClassifier = engagementClassifier
        self.conversation = conversation

        self.wakeDetector.onDetection = { [weak self] in
            Task { @MainActor in
                guard let self, self.state == .passive else { return }
                self.state = .candidate
            }
        }

        self.wakeDetector.onInvocationAudio = { [weak self] context in
            Task { @MainActor in
                await self?.evaluateInvocation(context)
            }
        }

        self.conversation.onUserTranscript = { [weak self] transcript in
            Task { @MainActor in
                self?.handleActiveTranscript(transcript)
            }
        }

        self.conversation.onEnded = { [weak self] in
            Task { @MainActor in
                await self?.returnToPassive()
            }
        }

        self.conversation.onError = { [weak self] message in
            Task { @MainActor in
                self?.state = .error(message)
            }
        }
    }

    func startAlwaysOn() async {
        responseMode = VoiceCommunicationPolicy.current().responseMode
        do {
            try wakeDetector.start()
            state = .passive
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    func stopAlwaysOn() async {
        idleTask?.cancel()
        idleTask = nil
        wakeDetector.stop()
        await conversation.disconnect()
        AudioSessionManager.shared.deactivate()
        state = .passive
    }

    private func evaluateInvocation(_ context: WakeWordAudioContext) async {
        guard state == .candidate || state == .passive else { return }
        state = .candidate

        let decision = await engagementClassifier.classify(context: context)
        guard decision.shouldActivate else {
            state = .passive
            return
        }

        responseMode = VoiceCommunicationPolicy.current().responseMode
        wakeDetector.stop()
        state = .connecting

        do {
            try AudioSessionManager.shared.activateForConversation()
            try await conversation.connect(responseMode: responseMode)
            state = .active
            resetIdleTimer()

            if let command = decision.command?.trimmingCharacters(in: .whitespacesAndNewlines), !command.isEmpty {
                await conversation.submitInitialCommand(command)
            }
        } catch {
            state = .error(error.localizedDescription)
            await returnToPassive()
        }
    }

    private func handleActiveTranscript(_ transcript: String) {
        guard state == .active else { return }
        resetIdleTimer()

        let localDecision = VoiceEngagementRules.classifyActiveTranscript(transcript)
        if localDecision == .end {
            Task { @MainActor in
                await endConversation()
            }
        }
    }

    private func resetIdleTimer() {
        idleTask?.cancel()
        idleTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(VoiceEngagementRules.idleConversationTimeoutMs) * 1_000_000)
            guard !Task.isCancelled else { return }
            await self?.endConversation()
        }
    }

    private func endConversation() async {
        guard state == .active || state == .connecting else { return }
        state = .ending
        idleTask?.cancel()
        idleTask = nil
        await conversation.disconnect()
        await returnToPassive()
    }

    private func returnToPassive() async {
        idleTask?.cancel()
        idleTask = nil
        responseMode = VoiceCommunicationPolicy.current().responseMode

        do {
            try wakeDetector.start()
            state = .passive
        } catch {
            state = .error(error.localizedDescription)
        }
    }
}

struct NativeInvocationDecision {
    let shouldActivate: Bool
    let command: String?
}

protocol NativeVoiceEngagementClassifier {
    func classify(context: WakeWordAudioContext) async -> NativeInvocationDecision
}

protocol NativeRealtimeConversation: AnyObject {
    var onUserTranscript: ((String) -> Void)? { get set }
    var onEnded: (() -> Void)? { get set }
    var onError: ((String) -> Void)? { get set }

    func connect(responseMode: ZyronResponseMode) async throws
    func submitInitialCommand(_ command: String) async
    func disconnect() async
}

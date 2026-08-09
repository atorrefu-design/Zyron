import Foundation
import Combine

@MainActor
final class VoiceSessionCoordinator: ObservableObject {
    enum State: Equatable {
        case passive
        case candidate
        case active
        case ending
        case failed(String)
    }

    @Published private(set) var state: State = .passive

    var onActivation: ((String?) -> Void)?
    var onEnd: (() -> Void)?

    private var candidateTask: Task<Void, Never>?
    private var idleTask: Task<Void, Never>?
    private var softEndTask: Task<Void, Never>?

    deinit {
        candidateTask?.cancel()
        idleTask?.cancel()
        softEndTask?.cancel()
    }

    func wakeWordDetected() {
        guard state == .passive else { return }
        state = .candidate
        candidateTask?.cancel()
        candidateTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(VoiceEngagementRules.wakeConfirmationWindowMs))
            guard !Task.isCancelled, let self, self.state == .candidate else { return }
            self.state = .passive
        }
    }

    func handleLocalTranscript(_ transcript: String, silenceAfterWakeMs: Int? = nil) {
        let result = VoiceEngagementClassifier.classify(
            transcript: transcript,
            activeConversation: state == .active,
            silenceAfterWakeMs: silenceAfterWakeMs
        )

        switch result.decision {
        case .activate:
            beginActiveSession(command: result.command)
        case .continue:
            registerConversationActivity()
        case .end:
            if result.reason == "soft_end" {
                scheduleSoftEnd()
            } else {
                endConversation()
            }
        case .ignore:
            if state == .candidate {
                candidateTask?.cancel()
                state = .passive
            }
        case .wait:
            break
        }
    }

    func activateManually(command: String? = nil) {
        switch state {
        case .passive:
            break
        case .failed:
            reset()
        default:
            return
        }

        beginActiveSession(command: command)
    }

    func registerConversationActivity() {
        guard state == .active else { return }
        softEndTask?.cancel()
        softEndTask = nil
        scheduleIdleTimeout()
    }

    func registerAssistantActivity() {
        guard state == .active else { return }
        scheduleIdleTimeout()
    }

    func conversationInterrupted() {
        guard state == .active else { return }
        idleTask?.cancel()
        softEndTask?.cancel()
    }

    func conversationResumed() {
        guard state == .active else { return }
        scheduleIdleTimeout()
    }

    func fail(_ message: String) {
        candidateTask?.cancel()
        idleTask?.cancel()
        softEndTask?.cancel()
        state = .failed(message)
    }

    func reset() {
        candidateTask?.cancel()
        idleTask?.cancel()
        softEndTask?.cancel()
        state = .passive
    }

    private func beginActiveSession(command: String?) {
        candidateTask?.cancel()
        softEndTask?.cancel()
        state = .active
        scheduleIdleTimeout()
        onActivation?(command)
    }

    private func scheduleIdleTimeout() {
        idleTask?.cancel()
        idleTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(VoiceEngagementRules.idleConversationTimeoutMs))
            guard !Task.isCancelled, let self, self.state == .active else { return }
            self.endConversation()
        }
    }

    private func scheduleSoftEnd() {
        guard state == .active else { return }
        idleTask?.cancel()
        softEndTask?.cancel()
        softEndTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(VoiceEngagementRules.softGoodbyeTimeoutMs))
            guard !Task.isCancelled, let self, self.state == .active else { return }
            self.endConversation()
        }
    }

    private func endConversation() {
        guard state == .active || state == .ending else { return }
        idleTask?.cancel()
        softEndTask?.cancel()
        state = .ending
        onEnd?()
        state = .passive
    }
}

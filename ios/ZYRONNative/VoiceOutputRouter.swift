import Foundation

@MainActor
final class VoiceOutputRouter {
    static let shared = VoiceOutputRouter()

    var onTextAvailable: ((String) -> Void)?

    private(set) var responseMode: ZyronResponseMode = VoiceCommunicationPolicy.current().responseMode
    private let notifier: QuietResponseNotifier

    init(notifier: QuietResponseNotifier? = nil) {
        self.notifier = notifier ?? .shared
    }

    func refreshPolicy(now: Date = Date()) {
        responseMode = VoiceCommunicationPolicy.current(now: now).responseMode
    }

    func setConfirmedResponseMode(_ mode: ZyronResponseMode) {
        responseMode = mode
    }

    func handleAssistantText(_ text: String) {
        let clean = text
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }

        onTextAvailable?(clean)
        guard responseMode == .text else { return }

        Task {
            _ = await notifier.deliver(text: clean)
        }
    }
}

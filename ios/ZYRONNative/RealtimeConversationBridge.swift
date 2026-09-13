import Foundation

@MainActor
protocol RealtimeEventSending: AnyObject {
    func sendRealtimeEvent(_ json: String)
}

@MainActor
final class RealtimeConversationBridge {
    weak var sender: RealtimeEventSending?

    var onUserTranscript: ((String) -> Void)?
    var onAssistantTranscript: ((String) -> Void)?
    var onAssistantText: ((String) -> Void)?
    var onError: ((String) -> Void)?
    var onSpeakingChanged: ((Bool) -> Void)?

    private let toolRouter: RealtimeToolRouter
    private let sessionCoordinator: VoiceSessionCoordinator
    private let outputRouter: VoiceOutputRouter
    private var handledToolCalls = Set<String>()

    init(
        toolRouter: RealtimeToolRouter = .shared,
        sessionCoordinator: VoiceSessionCoordinator,
        outputRouter: VoiceOutputRouter? = nil
    ) {
        self.toolRouter = toolRouter
        self.sessionCoordinator = sessionCoordinator
        self.outputRouter = outputRouter ?? .shared
    }

    func reset() {
        handledToolCalls.removeAll()
    }

    func setConfirmedResponseMode(_ mode: ZyronResponseMode) {
        outputRouter.setConfirmedResponseMode(mode)
    }

    func handle(_ rawEvent: String) {
        guard let event = RealtimeServerEvent.decode(rawEvent), let type = event.type else { return }

        switch type {
        case "input_audio_buffer.speech_started":
            sessionCoordinator.registerConversationActivity()
            onSpeakingChanged?(false)

        case "output_audio_buffer.started", "response.output_audio.delta", "response.audio.delta":
            sessionCoordinator.registerAssistantActivity()
            onSpeakingChanged?(true)

        case "output_audio_buffer.stopped", "output_audio_buffer.cleared":
            sessionCoordinator.registerAssistantActivity()
            onSpeakingChanged?(false)

        case "conversation.item.input_audio_transcription.completed":
            let text = event.transcript?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !text.isEmpty else { return }
            sessionCoordinator.handleLocalTranscript(text)
            ConversationJournal.shared.record(role: "user", text: text, itemID: event.itemID)
            onUserTranscript?(text)

        case "response.output_audio_transcript.done", "response.audio_transcript.done":
            let text = event.transcript?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !text.isEmpty else { return }
            sessionCoordinator.registerAssistantActivity()
            ConversationJournal.shared.record(role: "assistant", text: text, itemID: event.itemID)
            onAssistantTranscript?(text)

        case "response.output_text.done":
            let text = event.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !text.isEmpty else { return }
            sessionCoordinator.registerAssistantActivity()
            ConversationJournal.shared.record(role: "assistant", text: text, itemID: event.itemID)
            outputRouter.handleAssistantText(text)
            onAssistantText?(text)

        case "response.function_call_arguments.done":
            guard let callID = event.callID,
                  let name = event.name,
                  !callID.isEmpty,
                  !name.isEmpty,
                  !handledToolCalls.contains(callID) else {
                return
            }
            handledToolCalls.insert(callID)
            let call = RealtimeToolCall(
                callID: callID,
                name: name,
                arguments: event.arguments ?? "{}"
            )
            Task { [weak self] in
                guard let self else { return }
                let result = await self.toolRouter.execute(call)
                await MainActor.run {
                    self.sendToolOutput(result)
                }
            }

        case "error":
            let message = event.error?.message?.trimmingCharacters(in: .whitespacesAndNewlines)
            onError?(message?.isEmpty == false ? message! : "La sesión Realtime ha devuelto un error.")

        default:
            break
        }
    }

    private func sendToolOutput(_ result: RealtimeToolOutput) {
        guard let sender else { return }
        if let output = RealtimeClientEventCodec.functionOutput(
            callID: result.callID,
            output: result.output
        ) {
            sender.sendRealtimeEvent(output)
        }
        if let response = RealtimeClientEventCodec.responseCreate() {
            sender.sendRealtimeEvent(response)
        }
        sessionCoordinator.registerAssistantActivity()
    }
}

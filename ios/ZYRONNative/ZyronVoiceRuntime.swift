import Foundation
import Combine

@MainActor
final class ZyronVoiceRuntime: ObservableObject {
    enum State: Equatable {
        case stopped
        case passive
        case candidate
        case connecting
        case active
        case interrupted
        case failed(String)
    }

    @Published private(set) var state: State = .stopped
    @Published private(set) var latestText: String = ""
    @Published private(set) var responseMode: ZyronResponseMode = VoiceCommunicationPolicy.current().responseMode

    let sessionCoordinator: VoiceSessionCoordinator

    private let audioSession: AudioSessionManager
    private let outputRouter: VoiceOutputRouter
    private let bridge: RealtimeConversationBridge

    private var wakeDetector: WakeWordDetecting?
    private var transport: NativeRealtimeTransport?
    private var desiredAlwaysOn = false

    init(
        sessionCoordinator: VoiceSessionCoordinator = VoiceSessionCoordinator(),
        audioSession: AudioSessionManager = .shared,
        outputRouter: VoiceOutputRouter = .shared
    ) {
        self.sessionCoordinator = sessionCoordinator
        self.audioSession = audioSession
        self.outputRouter = outputRouter
        self.bridge = RealtimeConversationBridge(
            sessionCoordinator: sessionCoordinator,
            outputRouter: outputRouter
        )

        configureCallbacks()
    }

    func install(
        wakeDetector: WakeWordDetecting,
        transport: NativeRealtimeTransport
    ) {
        self.wakeDetector?.stop()
        self.transport?.disconnect()

        self.wakeDetector = wakeDetector
        self.transport = transport
        bridge.sender = transport

        wakeDetector.onDetection = { [weak self] in
            Task { @MainActor in
                self?.wakeWordDetected()
            }
        }

        transport.onEvent = { [weak self] event in
            Task { @MainActor in
                self?.bridge.handle(event)
            }
        }

        transport.onDisconnected = { [weak self] reason in
            Task { @MainActor in
                self?.handleTransportDisconnected(reason)
            }
        }
    }

    func startAlwaysOn() throws {
        guard let wakeDetector else {
            throw WakeWordDetectorError.porcupineUnavailable
        }

        desiredAlwaysOn = true
        sessionCoordinator.reset()
        try wakeDetector.start()
        state = .passive
    }

    func stopAlwaysOn() {
        desiredAlwaysOn = false
        wakeDetector?.stop()
        transport?.disconnect()
        audioSession.deactivate()
        sessionCoordinator.reset()
        state = .stopped
    }

    func wakeWordDetected() {
        guard desiredAlwaysOn, state == .passive else { return }
        sessionCoordinator.wakeWordDetected()
        state = .candidate
    }

    func handleLocalInvocationTranscript(
        _ transcript: String,
        silenceAfterWakeMs: Int? = nil
    ) {
        guard desiredAlwaysOn else { return }
        sessionCoordinator.handleLocalTranscript(
            transcript,
            silenceAfterWakeMs: silenceAfterWakeMs
        )

        switch sessionCoordinator.state {
        case .passive:
            state = .passive
        case .candidate:
            state = .candidate
        case .active:
            break
        case .ending:
            break
        case let .failed(message):
            state = .failed(message)
        }
    }

    private func configureCallbacks() {
        sessionCoordinator.onActivation = { [weak self] command in
            Task { @MainActor in
                await self?.activateRealtime(command: command)
            }
        }

        sessionCoordinator.onEnd = { [weak self] in
            Task { @MainActor in
                self?.finishConversation()
            }
        }

        bridge.onAssistantText = { [weak self] text in
            self?.latestText = text
        }

        bridge.onAssistantTranscript = { [weak self] text in
            self?.latestText = text
        }

        bridge.onError = { [weak self] message in
            self?.fail(message)
        }

        audioSession.onInterruptionBegan = { [weak self] in
            Task { @MainActor in
                guard let self, self.state == .active else { return }
                self.sessionCoordinator.conversationInterrupted()
                self.state = .interrupted
            }
        }

        audioSession.onInterruptionEnded = { [weak self] in
            Task { @MainActor in
                guard let self, self.desiredAlwaysOn else { return }
                if self.transport?.isConnected == true {
                    self.sessionCoordinator.conversationResumed()
                    self.state = .active
                } else {
                    self.returnToPassive()
                }
            }
        }

        audioSession.onMediaServicesReset = { [weak self] in
            Task { @MainActor in
                guard let self, self.desiredAlwaysOn else { return }
                if self.transport?.isConnected == true {
                    do {
                        try self.audioSession.activateForConversation()
                        self.sessionCoordinator.conversationResumed()
                        self.state = .active
                    } catch {
                        self.fail(error.localizedDescription)
                    }
                } else {
                    self.returnToPassive()
                }
            }
        }
    }

    private func activateRealtime(command: String?) async {
        guard desiredAlwaysOn, let transport else { return }

        state = .connecting
        wakeDetector?.stop()
        outputRouter.refreshPolicy()
        responseMode = VoiceCommunicationPolicy.current().responseMode

        do {
            try audioSession.activateForConversation()
            let confirmedMode = try await transport.connect(responseMode: responseMode)
            responseMode = confirmedMode
            outputRouter.setConfirmedResponseMode(confirmedMode)
            bridge.setConfirmedResponseMode(confirmedMode)
            bridge.reset()
            state = .active

            let cleanCommand = command?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !cleanCommand.isEmpty {
                if let input = RealtimeClientEventCodec.inputText(cleanCommand) {
                    transport.sendRealtimeEvent(input)
                }
                if let response = RealtimeClientEventCodec.responseCreate() {
                    transport.sendRealtimeEvent(response)
                }
            }
        } catch {
            transport.disconnect()
            audioSession.deactivate()
            sessionCoordinator.reset()
            fail(error.localizedDescription)
        }
    }

    private func finishConversation() {
        transport?.disconnect()
        audioSession.deactivate()
        returnToPassive()
    }

    private func handleTransportDisconnected(_ reason: String?) {
        audioSession.deactivate()
        guard desiredAlwaysOn else {
            state = .stopped
            return
        }

        if let reason, !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           state == .connecting {
            fail(reason)
            return
        }

        sessionCoordinator.reset()
        returnToPassive()
    }

    private func returnToPassive() {
        guard desiredAlwaysOn else {
            state = .stopped
            return
        }

        sessionCoordinator.reset()
        do {
            try wakeDetector?.start()
            state = .passive
        } catch {
            fail(error.localizedDescription)
        }
    }

    private func fail(_ message: String) {
        let clean = message.trimmingCharacters(in: .whitespacesAndNewlines)
        state = .failed(clean.isEmpty ? "ZYRON ha encontrado un error de voz." : clean)
    }
}

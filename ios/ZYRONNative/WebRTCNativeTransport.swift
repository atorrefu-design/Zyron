import Foundation

#if canImport(WebRTC)
import WebRTC

@MainActor
final class WebRTCNativeTransport: NSObject, NativeRealtimeTransport {
    var onEvent: ((String) -> Void)?
    var onDisconnected: ((String?) -> Void)?

    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        return RTCPeerConnectionFactory(
            encoderFactory: RTCDefaultVideoEncoderFactory(),
            decoderFactory: RTCDefaultVideoDecoderFactory()
        )
    }()

    private let apiClient: NativeAPIClient
    private var peerConnection: RTCPeerConnection?
    private var dataChannel: RTCDataChannel?
    private var audioSource: RTCAudioSource?
    private var audioTrack: RTCAudioTrack?
    private var pendingEvents: [String] = []
    private var deliberateClose = false

    init(apiClient: NativeAPIClient = .shared) {
        self.apiClient = apiClient
        super.init()
    }

    var isConnected: Bool {
        guard let peerConnection, let dataChannel else { return false }
        return peerConnection.connectionState == .connected && dataChannel.readyState == .open
    }

    func connect(responseMode: ZyronResponseMode) async throws -> ZyronResponseMode {
        disconnectInternal(notify: false)
        deliberateClose = false

        let connection = try makePeerConnection()
        peerConnection = connection
        try attachLocalAudio(to: connection)
        createDataChannel(on: connection)

        let offer = try await createOffer(on: connection)
        try await setLocalDescription(offer, on: connection)

        let call = try await apiClient.createRealtimeCall(
            sdpOffer: offer.sdp,
            responseMode: responseMode
        )
        let answer = RTCSessionDescription(type: .answer, sdp: call.answerSDP)
        let remoteStart = Date()
        print("ZYRON_REMOTE_SDP_MS:", Int(Date().timeIntervalSince(remoteStart) * 1000))
        try await setRemoteDescription(answer, on: connection)
        return call.outputMode
    }

    func sendRealtimeEvent(_ json: String) {
        guard !json.isEmpty else { return }
        guard let channel = dataChannel, channel.readyState == .open else {
            pendingEvents.append(json)
            if pendingEvents.count > 64 {
                pendingEvents.removeFirst(pendingEvents.count - 64)
            }
            return
        }
        send(json, through: channel)
    }

    func disconnect() {
        deliberateClose = true
        disconnectInternal(notify: false)
    }

    private func makePeerConnection() throws -> RTCPeerConnection {
        let configuration = RTCConfiguration()
        configuration.sdpSemantics = .unifiedPlan
        configuration.continualGatheringPolicy = .gatherContinually

        let constraints = RTCMediaConstraints(
            mandatoryConstraints: nil,
            optionalConstraints: ["DtlsSrtpKeyAgreement": "true"]
        )

        guard let connection = Self.factory.peerConnection(
            with: configuration,
            constraints: constraints,
            delegate: self
        ) else {
            throw WebRTCNativeTransportError.peerConnectionUnavailable
        }
        return connection
    }

    private func attachLocalAudio(to connection: RTCPeerConnection) throws {
        let constraints = RTCMediaConstraints(
            mandatoryConstraints: nil,
            optionalConstraints: [
                "googEchoCancellation": "true",
                "googAutoGainControl": "true",
                "googNoiseSuppression": "true"
            ]
        )
        let source = Self.factory.audioSource(with: constraints)
        let track = Self.factory.audioTrack(with: source, trackId: "ZYRON_AUDIO")
        guard connection.add(track, streamIds: ["ZYRON_STREAM"]) != nil else {
            throw WebRTCNativeTransportError.audioTrackUnavailable
        }
        audioSource = source
        audioTrack = track
    }

    private func createDataChannel(on connection: RTCPeerConnection) {
        let configuration = RTCDataChannelConfiguration()
        configuration.isOrdered = true
        guard let channel = connection.dataChannel(
            forLabel: "oai-events",
            configuration: configuration
        ) else {
            return
        }
        channel.delegate = self
        dataChannel = channel
    }

    private func createOffer(on connection: RTCPeerConnection) async throws -> RTCSessionDescription {
        let constraints = RTCMediaConstraints(
            mandatoryConstraints: [
                "OfferToReceiveAudio": "true",
                "OfferToReceiveVideo": "false"
            ],
            optionalConstraints: nil
        )

        return try await withCheckedThrowingContinuation { continuation in
            connection.offer(for: constraints) { sdp, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let sdp else {
                    continuation.resume(throwing: WebRTCNativeTransportError.offerUnavailable)
                    return
                }
                continuation.resume(returning: sdp)
            }
        }
    }

    private func setLocalDescription(
        _ description: RTCSessionDescription,
        on connection: RTCPeerConnection
    ) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.setLocalDescription(description) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }

    private func setRemoteDescription(
        _ description: RTCSessionDescription,
        on connection: RTCPeerConnection
    ) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.setRemoteDescription(description) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }

    private func send(_ json: String, through channel: RTCDataChannel) {
        let buffer = RTCDataBuffer(data: Data(json.utf8), isBinary: false)
        _ = channel.sendData(buffer)
    }

    private func flushPendingEvents() {
        guard let channel = dataChannel, channel.readyState == .open else { return }
        let events = pendingEvents
        pendingEvents.removeAll(keepingCapacity: true)
        for event in events {
            send(event, through: channel)
        }
    }

    private func disconnectInternal(notify: Bool, reason: String? = nil) {
        dataChannel?.delegate = nil
        dataChannel?.close()
        dataChannel = nil
        peerConnection?.delegate = nil
        peerConnection?.close()
        peerConnection = nil
        audioTrack = nil
        audioSource = nil
        pendingEvents.removeAll(keepingCapacity: true)

        if notify && !deliberateClose {
            onDisconnected?(reason)
        }
    }

    private func connectionFailed(_ reason: String) {
        disconnectInternal(notify: true, reason: reason)
    }
}

extension WebRTCNativeTransport: RTCDataChannelDelegate {
    nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            switch dataChannel.readyState {
            case .open:
                self.flushPendingEvents()
            case .closed:
                if self.peerConnection != nil {
                    self.connectionFailed("Se ha cerrado el canal de eventos Realtime.")
                }
            default:
                break
            }
        }
    }

    nonisolated func dataChannel(
        _ dataChannel: RTCDataChannel,
        didReceiveMessageWith buffer: RTCDataBuffer
    ) {
        guard !buffer.isBinary, let text = String(data: buffer.data, encoding: .utf8) else { return }
        Task { @MainActor [weak self] in
            self?.onEvent?(text)
        }
    }
}

extension WebRTCNativeTransport: RTCPeerConnectionDelegate {
    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didChange stateChanged: RTCSignalingState
    ) {}

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didAdd stream: RTCMediaStream
    ) {}

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didRemove stream: RTCMediaStream
    ) {}

    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didChange newState: RTCIceConnectionState
    ) {
        if newState == .failed {
            Task { @MainActor [weak self] in
                self?.connectionFailed("La conexión ICE de ZYRON ha fallado.")
            }
        }
    }

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didChange newState: RTCIceGatheringState
    ) {}

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didGenerate candidate: RTCIceCandidate
    ) {}

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didRemove candidates: [RTCIceCandidate]
    ) {}

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didOpen dataChannel: RTCDataChannel
    ) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.dataChannel?.delegate = nil
            self.dataChannel = dataChannel
            dataChannel.delegate = self
            self.flushPendingEvents()
        }
    }

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didChange newState: RTCPeerConnectionState
    ) {
        switch newState {
        case .failed:
            Task { @MainActor [weak self] in
                self?.connectionFailed("La conexión WebRTC de ZYRON ha fallado.")
            }
        case .closed:
            Task { @MainActor [weak self] in
                guard let self, !self.deliberateClose else { return }
                self.connectionFailed("La conversación Realtime se ha cerrado.")
            }
        default:
            break
        }
    }
}

enum WebRTCNativeTransportError: LocalizedError {
    case audioTrackUnavailable
    case offerUnavailable
    case peerConnectionUnavailable

    var errorDescription: String? {
        switch self {
        case .audioTrackUnavailable:
            return "No se ha podido conectar el micrófono a WebRTC."
        case .offerUnavailable:
            return "No se ha podido generar la oferta WebRTC para OpenAI Realtime."
        case .peerConnectionUnavailable:
            return "No se ha podido crear la conexión WebRTC de ZYRON."
        }
    }
}

#else
@MainActor
final class WebRTCNativeTransport: NativeRealtimeTransport {
    var onEvent: ((String) -> Void)?
    var onDisconnected: ((String?) -> Void)?
    var isConnected: Bool { false }

    func connect(responseMode: ZyronResponseMode) async throws -> ZyronResponseMode {
        throw WebRTCNativeTransportError.webRTCUnavailable
    }

    func sendRealtimeEvent(_ json: String) {}
    func disconnect() {}
}

enum WebRTCNativeTransportError: LocalizedError {
    case webRTCUnavailable

    var errorDescription: String? {
        "Falta añadir el paquete WebRTC al proyecto de Xcode."
    }
}
#endif

import Foundation
import AVFoundation
import Speech

final class OnDeviceInvocationTranscriber {
    private let recognizer: SFSpeechRecognizer?
    private var recognitionTask: SFSpeechRecognitionTask?

    init(locale: Locale = Locale(identifier: "es_ES")) {
        recognizer = SFSpeechRecognizer(locale: locale)
    }

    static func requestAuthorization() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }

    func transcribe(_ context: WakeWordAudioContext) async throws -> String {
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            throw OnDeviceInvocationError.speechNotAuthorized
        }
        guard let recognizer, recognizer.isAvailable else {
            throw OnDeviceInvocationError.speechUnavailable
        }
        guard recognizer.supportsOnDeviceRecognition else {
            throw OnDeviceInvocationError.onDeviceRecognitionUnavailable
        }
        guard !context.pcm.isEmpty,
              context.sampleRate > 0,
              context.wakeSampleOffset >= 0,
              context.wakeSampleOffset <= context.pcm.count else {
            throw OnDeviceInvocationError.invalidAudio
        }

        recognitionTask?.cancel()
        recognitionTask = nil

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false
        request.contextualStrings = ["ZYRON", "Zyron"]

        let buffer = try makeBuffer(context)
        return try await withCheckedThrowingContinuation { continuation in
            var finished = false

            recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard !finished else { return }

                if let error {
                    finished = true
                    self?.recognitionTask = nil
                    continuation.resume(throwing: error)
                    return
                }

                guard let result, result.isFinal else { return }
                finished = true
                self?.recognitionTask = nil

                let focused = Self.focusedInvocation(
                    transcription: result.bestTranscription,
                    context: context
                )
                guard !focused.isEmpty else {
                    continuation.resume(throwing: OnDeviceInvocationError.noTranscript)
                    return
                }
                continuation.resume(returning: focused)
            }

            request.append(buffer)
            request.endAudio()
        }
    }

    func cancel() {
        recognitionTask?.cancel()
        recognitionTask = nil
    }

    private func makeBuffer(_ context: WakeWordAudioContext) throws -> AVAudioPCMBuffer {
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: context.sampleRate,
            channels: 1,
            interleaved: false
        ),
        let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(context.pcm.count)
        ),
        let destination = buffer.int16ChannelData?[0] else {
            throw OnDeviceInvocationError.invalidAudio
        }

        buffer.frameLength = AVAudioFrameCount(context.pcm.count)
        context.pcm.withUnsafeBufferPointer { source in
            if let base = source.baseAddress {
                destination.update(from: base, count: source.count)
            }
        }
        return buffer
    }

    private static func focusedInvocation(
        transcription: SFTranscription,
        context: WakeWordAudioContext
    ) -> String {
        let segments = transcription.segments
        guard !segments.isEmpty else {
            return transcription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        let wakeTime = Double(context.wakeSampleOffset) / context.sampleRate
        let wakeIndex = segments.indices.min { lhs, rhs in
            distance(from: wakeTime, to: segments[lhs]) < distance(from: wakeTime, to: segments[rhs])
        } ?? segments.startIndex

        var start = wakeIndex
        while start > segments.startIndex {
            let previousIndex = segments.index(before: start)
            let previous = segments[previousIndex]
            let current = segments[start]
            let previousEnd = previous.timestamp + previous.duration
            let gap = current.timestamp - previousEnd
            let lookback = wakeTime - previous.timestamp

            if gap > 0.48 || lookback > 2.6 {
                break
            }
            start = previousIndex
        }

        var words: [String] = []
        for index in start..<segments.endIndex {
            let value = index == wakeIndex ? "ZYRON" : segments[index].substring
            let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !clean.isEmpty {
                words.append(clean)
            }
        }

        return words.joined(separator: " ")
            .replacingOccurrences(of: "  ", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func distance(from time: TimeInterval, to segment: SFTranscriptionSegment) -> TimeInterval {
        let start = segment.timestamp
        let end = segment.timestamp + segment.duration
        if time >= start && time <= end {
            return 0
        }
        if time < start {
            return start - time
        }
        return time - end
    }
}

enum OnDeviceInvocationError: LocalizedError {
    case speechNotAuthorized
    case speechUnavailable
    case onDeviceRecognitionUnavailable
    case invalidAudio
    case noTranscript

    var errorDescription: String? {
        switch self {
        case .speechNotAuthorized:
            return "Falta permiso de reconocimiento de voz para validar la llamada a ZYRON."
        case .speechUnavailable:
            return "El reconocimiento de voz local no está disponible ahora mismo."
        case .onDeviceRecognitionUnavailable:
            return "Este iPhone no ofrece reconocimiento de voz local para la configuración actual."
        case .invalidAudio:
            return "El contexto de audio local de ZYRON no es válido."
        case .noTranscript:
            return "No he podido distinguir si ZYRON era una llamada directa o una mención."
        }
    }
}

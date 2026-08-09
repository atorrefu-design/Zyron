import Foundation
import AVFoundation

#if canImport(Porcupine)
import Porcupine
#endif

struct WakeWordAudioContext {
    let pcm: [Int16]
    let sampleRate: Double
    let wakeSampleOffset: Int
    let postWakeDurationMs: Int
}

protocol ContextAwareWakeWordDetecting: WakeWordDetecting {
    var onInvocationAudio: ((WakeWordAudioContext) -> Void)? { get set }
}

#if canImport(Porcupine)
final class ContextualPorcupineWakeWordDetector: ContextAwareWakeWordDetecting {
    var onDetection: (() -> Void)?
    var onInvocationAudio: ((WakeWordAudioContext) -> Void)?

    private let audioSession: AudioSessionManager
    private let engine = AVAudioEngine()
    private let porcupine: Porcupine
    private let targetFormat: AVAudioFormat
    private let postWakeDurationMs: Int
    private let rollingCapacity: Int

    private var converter: AVAudioConverter?
    private var running = false
    private var rolling: Int16RingBuffer
    private var porcupinePending: [Int16] = []
    private var porcupineOffset = 0
    private var porcupineBufferStartAbsolute: Int64 = 0
    private var totalSamplesIngested: Int64 = 0
    private var capture: InvocationCapture?

    init(
        accessKey: String,
        keywordURL: URL,
        spanishModelURL: URL? = nil,
        contextWindowMs: Int = VoiceEngagementRules.localContextWindowMs,
        postWakeDurationMs: Int = VoiceEngagementRules.wakeConfirmationWindowMs,
        sensitivity: Float32 = 0.55,
        audioSession: AudioSessionManager = .shared
    ) throws {
        guard FileManager.default.fileExists(atPath: keywordURL.path) else {
            throw WakeWordDetectorError.keywordMissing
        }

        self.audioSession = audioSession
        self.postWakeDurationMs = max(250, postWakeDurationMs)
        self.rollingCapacity = max(
            Int(Porcupine.frameLength) * 2,
            Int((Double(Porcupine.sampleRate) * Double(max(500, contextWindowMs))) / 1000.0)
        )
        self.rolling = Int16RingBuffer(capacity: rollingCapacity)

        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: Double(Porcupine.sampleRate),
            channels: 1,
            interleaved: false
        ) else {
            throw ContextualWakeWordError.audioFormatUnavailable
        }
        self.targetFormat = format

        self.porcupine = try Porcupine(
            accessKey: accessKey,
            keywordPath: keywordURL.path,
            modelPath: spanishModelURL?.path,
            sensitivity: sensitivity
        )
    }

    func start() throws {
        guard !running else { return }

        try audioSession.activateForConversation()
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0,
              let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
            throw ContextualWakeWordError.audioFormatUnavailable
        }

        self.converter = converter
        rolling.removeAll()
        porcupinePending.removeAll(keepingCapacity: true)
        porcupineOffset = 0
        porcupineBufferStartAbsolute = 0
        totalSamplesIngested = 0
        capture = nil

        input.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [weak self] buffer, _ in
            self?.consume(buffer)
        }

        engine.prepare()
        do {
            try engine.start()
            running = true
        } catch {
            input.removeTap(onBus: 0)
            self.converter = nil
            throw error
        }
    }

    func stop() {
        guard running else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        converter = nil
        running = false
        capture = nil
        porcupinePending.removeAll(keepingCapacity: true)
        porcupineOffset = 0
        porcupineBufferStartAbsolute = 0
        totalSamplesIngested = 0
    }

    func delete() {
        stop()
        porcupine.delete()
    }

    deinit {
        delete()
    }

    private func consume(_ inputBuffer: AVAudioPCMBuffer) {
        guard running, let samples = convert(inputBuffer), !samples.isEmpty else { return }

        let absoluteStart = totalSamplesIngested
        rolling.append(contentsOf: samples)
        totalSamplesIngested += Int64(samples.count)

        appendPostWakeAudio(samples)
        detectWakeWord(in: samples, absoluteStart: absoluteStart)
    }

    private func convert(_ input: AVAudioPCMBuffer) -> [Int16]? {
        guard let converter else { return nil }

        let ratio = targetFormat.sampleRate / max(1, input.format.sampleRate)
        let estimated = max(1, Int(ceil(Double(input.frameLength) * ratio)) + 32)
        guard let output = AVAudioPCMBuffer(
            pcmFormat: targetFormat,
            frameCapacity: AVAudioFrameCount(estimated)
        ) else {
            return nil
        }

        var suppliedInput = false
        var conversionError: NSError?
        let status = converter.convert(to: output, error: &conversionError) { _, outStatus in
            if suppliedInput {
                outStatus.pointee = .endOfStream
                return nil
            }
            suppliedInput = true
            outStatus.pointee = .haveData
            return input
        }

        guard status != .error,
              conversionError == nil,
              output.frameLength > 0,
              let channel = output.int16ChannelData?[0] else {
            return nil
        }

        return Array(UnsafeBufferPointer(start: channel, count: Int(output.frameLength)))
    }

    private func detectWakeWord(in samples: [Int16], absoluteStart: Int64) {
        if porcupinePending.isEmpty {
            porcupineBufferStartAbsolute = absoluteStart
        }
        porcupinePending.append(contentsOf: samples)
        let frameLength = Int(Porcupine.frameLength)

        while porcupinePending.count - porcupineOffset >= frameLength {
            let start = porcupineOffset
            let end = start + frameLength
            let frame = Array(porcupinePending[start..<end])
            let frameAbsoluteEnd = porcupineBufferStartAbsolute + Int64(end)
            porcupineOffset = end

            guard capture == nil else { continue }
            do {
                if try porcupine.process(pcm: frame) >= 0 {
                    beginInvocationCapture(wakeAbsoluteSample: frameAbsoluteEnd)
                }
            } catch {
                // A single failed frame must not kill the passive listener.
            }
        }

        if porcupineOffset > frameLength * 8 {
            porcupinePending.removeFirst(porcupineOffset)
            porcupineBufferStartAbsolute += Int64(porcupineOffset)
            porcupineOffset = 0
        }
    }

    private func beginInvocationCapture(wakeAbsoluteSample: Int64) {
        let preWake = rolling.snapshot()
        let rollingStartAbsolute = totalSamplesIngested - Int64(preWake.count)
        let rawWakeOffset = wakeAbsoluteSample - rollingStartAbsolute
        let wakeOffset = max(0, min(preWake.count, Int(rawWakeOffset)))
        let remaining = Int(
            (Double(Porcupine.sampleRate) * Double(postWakeDurationMs)) / 1000.0
        )

        capture = InvocationCapture(
            samples: preWake,
            wakeSampleOffset: wakeOffset,
            remainingPostWakeSamples: max(1, remaining)
        )

        DispatchQueue.main.async { [weak self] in
            self?.onDetection?()
        }
    }

    private func appendPostWakeAudio(_ samples: [Int16]) {
        guard var current = capture else { return }

        let count = min(current.remainingPostWakeSamples, samples.count)
        if count > 0 {
            current.samples.append(contentsOf: samples.prefix(count))
            current.remainingPostWakeSamples -= count
        }

        if current.remainingPostWakeSamples > 0 {
            capture = current
            return
        }

        capture = nil
        let context = WakeWordAudioContext(
            pcm: current.samples,
            sampleRate: Double(Porcupine.sampleRate),
            wakeSampleOffset: current.wakeSampleOffset,
            postWakeDurationMs: postWakeDurationMs
        )
        DispatchQueue.main.async { [weak self] in
            self?.onInvocationAudio?(context)
        }
    }
}

private struct InvocationCapture {
    var samples: [Int16]
    let wakeSampleOffset: Int
    var remainingPostWakeSamples: Int
}

private struct Int16RingBuffer {
    private var storage: [Int16]
    private var writeIndex = 0
    private var sampleCount = 0

    init(capacity: Int) {
        storage = Array(repeating: 0, count: max(1, capacity))
    }

    mutating func append(contentsOf samples: [Int16]) {
        for sample in samples {
            storage[writeIndex] = sample
            writeIndex = (writeIndex + 1) % storage.count
            sampleCount = min(storage.count, sampleCount + 1)
        }
    }

    func snapshot() -> [Int16] {
        guard sampleCount > 0 else { return [] }
        let start = (writeIndex - sampleCount + storage.count) % storage.count
        if start + sampleCount <= storage.count {
            return Array(storage[start..<(start + sampleCount)])
        }
        let first = storage[start..<storage.count]
        let secondCount = sampleCount - first.count
        return Array(first) + Array(storage[0..<secondCount])
    }

    mutating func removeAll() {
        writeIndex = 0
        sampleCount = 0
    }
}
#else
final class ContextualPorcupineWakeWordDetector: ContextAwareWakeWordDetecting {
    var onDetection: (() -> Void)?
    var onInvocationAudio: ((WakeWordAudioContext) -> Void)?

    init(
        accessKey: String,
        keywordURL: URL,
        spanishModelURL: URL? = nil,
        contextWindowMs: Int = VoiceEngagementRules.localContextWindowMs,
        postWakeDurationMs: Int = VoiceEngagementRules.wakeConfirmationWindowMs,
        sensitivity: Float32 = 0.55,
        audioSession: AudioSessionManager = .shared
    ) throws {
        throw WakeWordDetectorError.porcupineUnavailable
    }

    func start() throws { throw WakeWordDetectorError.porcupineUnavailable }
    func stop() {}
    func delete() {}
}
#endif

enum ContextualWakeWordError: LocalizedError {
    case audioFormatUnavailable

    var errorDescription: String? {
        switch self {
        case .audioFormatUnavailable:
            return "El iPhone no ha podido preparar el audio local para detectar ZYRON."
        }
    }
}

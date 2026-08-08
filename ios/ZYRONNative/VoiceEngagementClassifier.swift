import Foundation

enum VoiceEngagementDecision: String {
    case activate
    case ignore
    case wait
    case `continue`
    case end
}

struct VoiceEngagementResult {
    let decision: VoiceEngagementDecision
    let confidence: Double
    let reason: String
    let command: String?
}

enum VoiceEngagementRules {
    static let wakeWord = "zyron"
    static let wakeConfirmationWindowMs = 1_800
    static let wakePauseActivationMs = 250
    static let idleConversationTimeoutMs = 45_000
    static let softGoodbyeTimeoutMs = 5_000
    static let localContextWindowMs = 4_000
}

enum VoiceEngagementClassifier {
    static func classify(
        transcript rawTranscript: String,
        activeConversation: Bool,
        silenceAfterWakeMs: Int? = nil
    ) -> VoiceEngagementResult {
        let transcript = normalize(rawTranscript)

        if activeConversation {
            if matches(transcript, pattern: #"^(?:zyron )?(?:termina|para|cierra la conversacion|hasta luego|puedes descansar)(?: zyron)?$"#) {
                return VoiceEngagementResult(decision: .end, confidence: 0.99, reason: "explicit_end", command: nil)
            }
            if matches(transcript, pattern: #"^(?:gracias|gracias zyron|vale gracias|perfecto gracias|ya esta|eso es todo)$"#) {
                return VoiceEngagementResult(decision: .end, confidence: 0.82, reason: "soft_end", command: nil)
            }
            return VoiceEngagementResult(decision: .continue, confidence: 0.99, reason: "already_active", command: nil)
        }

        guard !transcript.isEmpty else {
            return VoiceEngagementResult(decision: .wait, confidence: 0.99, reason: "no_context", command: nil)
        }

        guard let wakeRange = transcript.range(of: VoiceEngagementRules.wakeWord, options: .backwards) else {
            return VoiceEngagementResult(decision: .ignore, confidence: 0.99, reason: "wake_absent", command: nil)
        }

        let before = String(transcript[..<wakeRange.lowerBound]).trimmingCharacters(in: .whitespaces)
        let after = String(transcript[wakeRange.upperBound...]).trimmingCharacters(in: .whitespaces)
        let directAtStart = matches(transcript, pattern: #"^(?:oye |eh |hola |vamos |por favor )?zyron\b"#)
        let mentionBefore = matches(before, pattern: #"(?:hablando de|hablar de|sobre|acerca de|se llama|llamado|el nombre|la palabra|el proyecto|la app|la aplicacion|el asistente|dije|he dicho|decir|dices)\s+(?:a\s+)?$"#)
        let mentionAfter = matches(after, pattern: #"^(?:es\b|se llama\b|significa\b|como nombre\b|como app\b|como asistente\b|fue\b|era\b)"#)

        if (mentionBefore || mentionAfter) && !directAtStart {
            return VoiceEngagementResult(decision: .ignore, confidence: 0.94, reason: "name_mentioned", command: nil)
        }

        if directAtStart && !after.isEmpty {
            return VoiceEngagementResult(decision: .activate, confidence: 0.99, reason: "direct_call_with_request", command: after)
        }

        if matches(transcript, pattern: #"^(?:oye |eh |hola )?zyron$"#) {
            let pause = silenceAfterWakeMs ?? 0
            if pause >= VoiceEngagementRules.wakePauseActivationMs {
                return VoiceEngagementResult(decision: .activate, confidence: 0.97, reason: "direct_call_with_pause", command: "")
            }
            return VoiceEngagementResult(decision: .wait, confidence: 0.90, reason: "waiting_for_followup", command: nil)
        }

        if before.isEmpty && !after.isEmpty {
            return VoiceEngagementResult(decision: .activate, confidence: 0.96, reason: "wake_leads_utterance", command: after)
        }

        return VoiceEngagementResult(decision: .ignore, confidence: 0.78, reason: "embedded_name", command: nil)
    }

    private static func normalize(_ value: String) -> String {
        let folded = value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "es_ES"))
        let punctuation = CharacterSet(charactersIn: "¿?¡!.,;:")
        let cleaned = folded.components(separatedBy: punctuation).joined(separator: " ")
        return cleaned
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
            .lowercased()
    }

    private static func matches(_ value: String, pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) != nil
    }
}

import Foundation

enum NativeActiveTranscriptDecision {
    case `continue`
    case end
}

extension VoiceEngagementRules {
    static func classifyActiveTranscript(_ value: String) -> NativeActiveTranscriptDecision {
        let transcript = normalize(value)

        let explicitEnd = [
            "termina",
            "para",
            "cierra la conversacion",
            "hasta luego",
            "puedes descansar",
            "zyron termina",
            "termina zyron",
            "hasta luego zyron"
        ]

        let softEnd = [
            "gracias",
            "gracias zyron",
            "vale gracias",
            "perfecto gracias",
            "ya esta",
            "eso es todo"
        ]

        if explicitEnd.contains(transcript) || softEnd.contains(transcript) {
            return .end
        }
        return .continue
    }

    private static func normalize(_ value: String) -> String {
        value
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "es_ES"))
            .lowercased()
            .components(separatedBy: CharacterSet.punctuationCharacters)
            .joined(separator: " ")
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
    }
}

import Foundation

enum ZyronResponseMode: String, Codable {
    case audio
    case text
}

struct VoiceCommunicationPolicy: Codable {
    let responseMode: ZyronResponseMode
    let wakeWord: String
    let quietStartHour: Int
    let quietEndHour: Int

    static func current(now: Date = Date()) -> VoiceCommunicationPolicy {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Madrid") ?? .current
        let hour = calendar.component(.hour, from: now)
        let quiet = hour >= 1 && hour < 7

        return VoiceCommunicationPolicy(
            responseMode: quiet ? .text : .audio,
            wakeWord: "ZYRON",
            quietStartHour: 1,
            quietEndHour: 7
        )
    }
}

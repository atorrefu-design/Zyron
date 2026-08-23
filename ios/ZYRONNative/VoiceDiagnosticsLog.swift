import Foundation

@MainActor
enum VoiceDiagnosticsLog {
    private static let key = "zyron.voice-diagnostics-events"
    private static let maxEvents = 80

    static func record(_ event: String, detail: Any? = nil) {
        let stamp = ISO8601DateFormatter().string(from: Date())
        var events = UserDefaults.standard.stringArray(forKey: key) ?? []
        let detailText = detail.map { " · \($0)" } ?? ""
        events.append("\(stamp) · \(event)\(detailText)")
        if events.count > maxEvents {
            events.removeFirst(events.count - maxEvents)
        }
        UserDefaults.standard.set(events, forKey: key)
    }

    static func recent(limit: Int = 30) -> [String] {
        let events = UserDefaults.standard.stringArray(forKey: key) ?? []
        return Array(events.suffix(max(1, limit))).reversed()
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}

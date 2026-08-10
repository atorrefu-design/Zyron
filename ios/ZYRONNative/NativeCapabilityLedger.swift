import Foundation

/// Learns which native actions actually work on this iPhone from real executions.
/// This is intentionally outcome-based: ZYRON never assumes a capability exists
/// until iOS or the target app has successfully completed it at least once.
@MainActor
final class NativeCapabilityLedger {
    static let shared = NativeCapabilityLedger()

    struct Entry: Codable, Equatable {
        var successes: Int
        var failures: Int
        var lastSucceeded: Bool
        var lastUsedAt: Date
        var capabilityId: String?
    }

    private let storageKey = "zyron.nativeCapabilities.ledger.v1"
    private var entries: [String: Entry] = [:]

    private init() {
        entries = load()
    }

    func record(action: String, capabilityId: String?, succeeded: Bool) {
        var entry = entries[action] ?? Entry(
            successes: 0,
            failures: 0,
            lastSucceeded: succeeded,
            lastUsedAt: Date(),
            capabilityId: capabilityId
        )
        if succeeded { entry.successes += 1 } else { entry.failures += 1 }
        entry.lastSucceeded = succeeded
        entry.lastUsedAt = Date()
        if let capabilityId { entry.capabilityId = capabilityId }
        entries[action] = entry
        persist()
    }

    func isProven(_ action: String) -> Bool {
        guard let entry = entries[action] else { return false }
        return entry.successes > 0
    }

    /// Bayesian-smoothed reliability score. Unseen routes start neutral instead
    /// of being treated as broken, while routes that repeatedly succeed rise.
    func reliabilityScore(for action: String) -> Double {
        guard let entry = entries[action] else { return 0.5 }
        let successes = Double(entry.successes)
        let failures = Double(entry.failures)
        var score = (successes + 1.0) / (successes + failures + 2.0)
        if entry.lastSucceeded { score += 0.05 }
        return min(score, 1.0)
    }

    func orderedByReliability(_ actions: [String]) -> [String] {
        actions.enumerated().sorted { lhs, rhs in
            let leftScore = reliabilityScore(for: lhs.element)
            let rightScore = reliabilityScore(for: rhs.element)
            if leftScore == rightScore { return lhs.offset < rhs.offset }
            return leftScore > rightScore
        }.map(\.element)
    }

    func provenActions() -> [String] {
        entries
            .filter { $0.value.successes > 0 }
            .map(\.key)
            .sorted()
    }

    func snapshotJSON() -> String {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(entries),
              let json = String(data: data, encoding: .utf8) else { return "{}" }
        return json
    }

    private func persist() {
        let encoder = JSONEncoder()
        guard let data = try? encoder.encode(entries) else { return }
        UserDefaults.standard.set(data, forKey: storageKey)
    }

    private func load() -> [String: Entry] {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let decoded = try? JSONDecoder().decode([String: Entry].self, from: data) else { return [:] }
        return decoded
    }
}

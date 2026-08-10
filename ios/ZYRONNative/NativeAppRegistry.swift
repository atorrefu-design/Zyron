import Foundation

/// iOS does not expose a public API for enumerating every installed app.
/// ZYRON therefore keeps a privacy-safe catalog of known integrations and
/// learns which ones work on this device from successful launches.
@MainActor
final class NativeAppRegistry {
    static let shared = NativeAppRegistry()

    struct Candidate: Equatable {
        let canonicalName: String
        let aliases: [String]
        let launchURL: String
    }

    private let learnedKey = "zyron.nativeApps.learned.v1"

    private let catalog: [Candidate] = [
        Candidate(canonicalName: "WhatsApp", aliases: ["whatsapp", "wasap", "watsap"], launchURL: "whatsapp://"),
        Candidate(canonicalName: "Spotify", aliases: ["spotify"], launchURL: "spotify://"),
        Candidate(canonicalName: "YouTube", aliases: ["youtube", "you tube"], launchURL: "youtube://"),
        Candidate(canonicalName: "Google Maps", aliases: ["google maps", "google mapas"], launchURL: "comgooglemaps://"),
        Candidate(canonicalName: "Mapas", aliases: ["maps", "mapas", "apple maps", "mapas de apple"], launchURL: "http://maps.apple.com/"),
        Candidate(canonicalName: "Telegram", aliases: ["telegram"], launchURL: "tg://"),
        Candidate(canonicalName: "Gmail", aliases: ["gmail", "google mail"], launchURL: "googlegmail://"),
        Candidate(canonicalName: "Chrome", aliases: ["chrome", "google chrome"], launchURL: "googlechrome://"),
        Candidate(canonicalName: "Waze", aliases: ["waze"], launchURL: "waze://"),
        Candidate(canonicalName: "Teams", aliases: ["teams", "microsoft teams"], launchURL: "msteams://"),
        Candidate(canonicalName: "Outlook", aliases: ["outlook", "microsoft outlook"], launchURL: "ms-outlook://")
    ]

    private init() {}

    func candidate(named rawName: String) -> Candidate? {
        let needle = normalize(rawName)
        return catalog.first { candidate in
            normalize(candidate.canonicalName) == needle || candidate.aliases.contains { normalize($0) == needle }
        }
    }

    func recordSuccessfulLaunch(_ candidate: Candidate) {
        var learned = learnedCanonicalNames()
        learned.insert(candidate.canonicalName)
        UserDefaults.standard.set(Array(learned).sorted(), forKey: learnedKey)
    }

    func learnedApps() -> [String] {
        Array(learnedCanonicalNames()).sorted()
    }

    func knownIntegrationNames() -> [String] {
        catalog.map(\.canonicalName).sorted()
    }

    private func learnedCanonicalNames() -> Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: learnedKey) ?? [])
    }

    private func normalize(_ value: String) -> String {
        value
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "es_ES"))
            .lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

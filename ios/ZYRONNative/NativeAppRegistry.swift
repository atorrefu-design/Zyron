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
        let webFallbackURL: String?
    }

    private let learnedKey = "zyron.nativeApps.learned.v1"

    private let catalog: [Candidate] = [
        Candidate(canonicalName: "WhatsApp", aliases: ["whatsapp", "wasap", "watsap"], launchURL: "whatsapp://", webFallbackURL: "https://web.whatsapp.com/"),
        Candidate(canonicalName: "Spotify", aliases: ["spotify"], launchURL: "spotify://", webFallbackURL: "https://open.spotify.com/"),
        Candidate(canonicalName: "YouTube", aliases: ["youtube", "you tube"], launchURL: "youtube://", webFallbackURL: "https://www.youtube.com/"),
        Candidate(canonicalName: "Google Maps", aliases: ["google maps", "google mapas"], launchURL: "comgooglemaps://", webFallbackURL: "https://maps.google.com/"),
        Candidate(canonicalName: "Mapas", aliases: ["maps", "mapas", "apple maps", "mapas de apple"], launchURL: "http://maps.apple.com/", webFallbackURL: "https://maps.apple.com/"),
        Candidate(canonicalName: "Telegram", aliases: ["telegram"], launchURL: "tg://", webFallbackURL: "https://web.telegram.org/"),
        Candidate(canonicalName: "Gmail", aliases: ["gmail", "google mail"], launchURL: "googlegmail://", webFallbackURL: "https://mail.google.com/"),
        Candidate(canonicalName: "Chrome", aliases: ["chrome", "google chrome"], launchURL: "googlechrome://", webFallbackURL: "https://www.google.com/"),
        Candidate(canonicalName: "Waze", aliases: ["waze"], launchURL: "waze://", webFallbackURL: "https://www.waze.com/live-map/"),
        Candidate(canonicalName: "Teams", aliases: ["teams", "microsoft teams"], launchURL: "msteams://", webFallbackURL: "https://teams.microsoft.com/"),
        Candidate(canonicalName: "Outlook", aliases: ["outlook", "microsoft outlook"], launchURL: "ms-outlook://", webFallbackURL: "https://outlook.office.com/")
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

    /// Diagnostic groups for the adaptive executor. This lets ZYRON report
    /// the preferred route for each known app instead of only for broad domains.
    func adaptiveExecutorGroups() -> [String: [String]] {
        var groups: [String: [String]] = [:]
        for candidate in catalog {
            let key = routeKey(candidate.canonicalName)
            var routes = ["app.\(key).native"]
            if candidate.webFallbackURL != nil { routes.append("app.\(key).web") }
            groups["apps.open.\(candidate.canonicalName)"] = routes
        }
        return groups
    }

    private func routeKey(_ value: String) -> String {
        normalize(value).replacingOccurrences(of: " ", with: "_")
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

import Contacts
import CoreLocation
import Foundation
import UIKit

enum NativeAppOpenResult: Equatable {
    case direct
    case webFallback
    case failed
}

enum NativeMediaHandoffResult: Equatable {
    case spotify
    case youtube
    case web
    case failed
}

@MainActor
final class NativeDeviceActions: NSObject, CLLocationManagerDelegate {
    static let shared = NativeDeviceActions()

    private let locationManager = CLLocationManager()
    private var locationContinuation: CheckedContinuation<CLLocation, Error>?

    override private init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func currentLocation() async throws -> CLLocation {
        return try await NativePermissionGate.shared.run(requiring: .location) {
            try await withCheckedThrowingContinuation { continuation in
                self.locationContinuation = continuation
                self.locationManager.requestLocation()
            }
        }
    }

    func openWhatsApp(target: String? = nil, message: String? = nil) async throws -> Bool {
        let cleanTarget = target?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let cleanMessage = message?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        var phone = ""
        if !cleanTarget.isEmpty {
            if cleanTarget.range(of: #"^\+?[0-9 ()-]{6,}$"#, options: .regularExpression) != nil {
                phone = sanitizePhone(cleanTarget)
            } else {
                phone = try await resolvePhoneNumber(for: cleanTarget)
            }
            guard !phone.isEmpty else { return false }
        }

        let routes = NativeCapabilityLedger.shared.orderedByReliability(["whatsapp.native", "whatsapp.web"])
        for route in routes {
            let url: URL?
            if route == "whatsapp.native" {
                if phone.isEmpty {
                    url = URL(string: "whatsapp://")
                } else {
                    var components = URLComponents()
                    components.scheme = "whatsapp"
                    components.host = "send"
                    var queryItems = [URLQueryItem(name: "phone", value: phone)]
                    if !cleanMessage.isEmpty { queryItems.append(URLQueryItem(name: "text", value: cleanMessage)) }
                    components.queryItems = queryItems
                    url = components.url
                }
            } else {
                if phone.isEmpty {
                    url = URL(string: "https://web.whatsapp.com/")
                } else {
                    var components = URLComponents(string: "https://wa.me/\(phone)")
                    if !cleanMessage.isEmpty {
                        components?.queryItems = [URLQueryItem(name: "text", value: cleanMessage)]
                    }
                    url = components?.url
                }
            }

            guard let url else {
                NativeCapabilityLedger.shared.record(action: route, capabilityId: "whatsapp.handoff", succeeded: false)
                continue
            }
            let opened = await openURL(url)
            NativeCapabilityLedger.shared.record(action: route, capabilityId: "whatsapp.handoff", succeeded: opened)
            if opened { return true }
        }
        return false
    }

    func call(target rawTarget: String) async throws -> Bool {
        let target = rawTarget.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !target.isEmpty else { return false }

        let phone: String
        if target.range(of: #"^\+?[0-9 ()-]{6,}$"#, options: .regularExpression) != nil {
            phone = sanitizePhone(target)
        } else {
            phone = try await resolvePhoneNumber(for: target)
        }
        guard !phone.isEmpty, let url = URL(string: "tel:\(phone)") else { return false }
        let opened = await openURL(url)
        NativeCapabilityLedger.shared.record(action: "phone.tel", capabilityId: "phone.call", succeeded: opened)
        return opened
    }

    func composeSMS(target rawTarget: String, message: String?) async throws -> Bool {
        let target = rawTarget.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !target.isEmpty else { return false }

        let phone: String
        if target.range(of: #"^\+?[0-9 ()-]{6,}$"#, options: .regularExpression) != nil {
            phone = sanitizePhone(target)
        } else {
            phone = try await resolvePhoneNumber(for: target)
        }

        guard !phone.isEmpty else { return false }
        var components = URLComponents()
        components.scheme = "sms"
        components.path = phone
        if let message, !message.isEmpty {
            components.queryItems = [URLQueryItem(name: "body", value: message)]
        }
        guard let url = components.url else { return false }
        let opened = await openURL(url)
        NativeCapabilityLedger.shared.record(action: "messages.sms", capabilityId: "messages.compose", succeeded: opened)
        return opened
    }

    /// Learns a preferred executor independently for every app. A successful
    /// native route or web fallback becomes more likely to be tried first next time.
    func openApp(named rawName: String) async -> NativeAppOpenResult {
        guard let candidate = NativeAppRegistry.shared.candidate(named: rawName) else { return .failed }

        let appKey = normalize(candidate.canonicalName).replacingOccurrences(of: " ", with: "_")
        let nativeRoute = "app.\(appKey).native"
        let webRoute = "app.\(appKey).web"
        var availableRoutes = [nativeRoute]
        if candidate.webFallbackURL != nil { availableRoutes.append(webRoute) }

        let routes = NativeCapabilityLedger.shared.orderedByReliability(availableRoutes)
        for route in routes {
            let rawURL: String?
            if route == nativeRoute { rawURL = candidate.launchURL }
            else { rawURL = candidate.webFallbackURL }

            guard let rawURL else {
                NativeCapabilityLedger.shared.record(action: route, capabilityId: "apps.open", succeeded: false)
                continue
            }

            let opened = await openURLString(rawURL)
            NativeCapabilityLedger.shared.record(action: route, capabilityId: "apps.open", succeeded: opened)
            if opened {
                if route == nativeRoute {
                    NativeAppRegistry.shared.recordSuccessfulLaunch(candidate)
                    return .direct
                }
                return .webFallback
            }
        }
        return .failed
    }

    func playMedia(query rawQuery: String) async -> NativeMediaHandoffResult {
        let query = rawQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return .failed }

        let routes = NativeCapabilityLedger.shared.orderedByReliability([
            "media.spotify",
            "media.youtube",
            "media.web",
        ])

        for route in routes {
            let url: URL?
            switch route {
            case "media.spotify":
                let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? query
                url = URL(string: "spotify:search:\(encoded)")
            case "media.youtube":
                var components = URLComponents(string: "youtube://www.youtube.com/results")
                components?.queryItems = [URLQueryItem(name: "search_query", value: query)]
                url = components?.url
            default:
                var components = URLComponents(string: "https://www.youtube.com/results")
                components?.queryItems = [URLQueryItem(name: "search_query", value: query)]
                url = components?.url
            }

            guard let url else {
                NativeCapabilityLedger.shared.record(action: route, capabilityId: "media.play", succeeded: false)
                continue
            }
            let opened = await openURL(url)
            NativeCapabilityLedger.shared.record(action: route, capabilityId: "media.play", succeeded: opened)
            if opened {
                if route == "media.spotify" { return .spotify }
                if route == "media.youtube" { return .youtube }
                return .web
            }
        }
        return .failed
    }

    func openURLString(_ rawURL: String) async -> Bool {
        guard let url = URL(string: rawURL), url.scheme != nil else { return false }
        return await openURL(url)
    }

    func startNavigation(to destination: String, personalPlace: String? = nil) async -> Bool {
        var resolvedDestination = destination.trimmingCharacters(in: .whitespacesAndNewlines)

        if let personalPlace, !personalPlace.isEmpty {
            do { resolvedDestination = try await resolvePersonalDestination(personalPlace) }
            catch { return false }
        }

        guard !resolvedDestination.isEmpty else { return false }

        let routes = NativeCapabilityLedger.shared.orderedByReliability([
            "navigation.apple_maps",
            "navigation.google_maps",
            "navigation.waze",
        ])

        for route in routes {
            let url: URL?
            switch route {
            case "navigation.google_maps":
                var components = URLComponents()
                components.scheme = "comgooglemaps"
                components.host = ""
                components.queryItems = [
                    URLQueryItem(name: "daddr", value: resolvedDestination),
                    URLQueryItem(name: "directionsmode", value: "driving"),
                ]
                url = components.url
            case "navigation.waze":
                var components = URLComponents(string: "waze://")
                components?.queryItems = [
                    URLQueryItem(name: "q", value: resolvedDestination),
                    URLQueryItem(name: "navigate", value: "yes"),
                ]
                url = components?.url
            default:
                var components = URLComponents(string: "http://maps.apple.com/")
                components?.queryItems = [
                    URLQueryItem(name: "daddr", value: resolvedDestination),
                    URLQueryItem(name: "dirflg", value: "d"),
                ]
                url = components?.url
            }

            guard let url else {
                NativeCapabilityLedger.shared.record(action: route, capabilityId: "maps.navigation", succeeded: false)
                continue
            }
            let opened = await openURL(url)
            NativeCapabilityLedger.shared.record(action: route, capabilityId: "maps.navigation", succeeded: opened)
            if opened { return true }
        }
        return false
    }

    private func resolvePersonalDestination(_ place: String) async throws -> String {
        _ = place
        throw NativeDeviceActionError.personalPlaceUnavailable
    }

    private func resolvePhoneNumber(for name: String) async throws -> String {
        try await NativePermissionGate.shared.run(requiring: .contacts) {
            let store = CNContactStore()
            let keys = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactNicknameKey, CNContactPhoneNumbersKey] as [CNKeyDescriptor]
            let request = CNContactFetchRequest(keysToFetch: keys)
            let needle = self.normalize(name)
            var exactMatches = [CNContact]()
            var partialMatches = [CNContact]()
            try store.enumerateContacts(with: request) { contact, _ in
                let fullName = self.normalize("\(contact.givenName) \(contact.familyName)")
                let nickname = self.normalize(contact.nickname)
                let searchable = [fullName, nickname].filter { !$0.isEmpty }
                if searchable.contains(needle) {
                    exactMatches.append(contact)
                } else if searchable.contains(where: { $0.contains(needle) || needle.contains($0) }) {
                    partialMatches.append(contact)
                }
            }

            let matches = exactMatches.isEmpty ? partialMatches : exactMatches
            guard !matches.isEmpty else {
                throw NativeDeviceActionError.contactPhoneUnavailable
            }
            guard matches.count == 1, let contact = matches.first else {
                let names = matches.prefix(3).map { contact in
                    let fullName = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespacesAndNewlines)
                    return fullName.isEmpty ? contact.nickname : fullName
                }.filter { !$0.isEmpty }.joined(separator: ", ")
                throw NativeDeviceActionError.contactAmbiguous(names)
            }

            let numbers = Array(Set(contact.phoneNumbers.map { self.sanitizePhone($0.value.stringValue) }.filter { !$0.isEmpty }))
            guard numbers.count == 1, let number = numbers.first else {
                if numbers.isEmpty { throw NativeDeviceActionError.contactPhoneUnavailable }
                let displayName = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespacesAndNewlines)
                throw NativeDeviceActionError.contactPhoneAmbiguous(displayName.isEmpty ? contact.nickname : displayName)
            }
            return number
        }
    }

    private func openURL(_ url: URL) async -> Bool {
        await withCheckedContinuation { continuation in
            UIApplication.shared.open(url, options: [:]) { opened in continuation.resume(returning: opened) }
        }
    }

    private func sanitizePhone(_ value: String) -> String { value.filter(\.isNumber) }

    private func normalize(_ value: String) -> String {
        value
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "es_ES"))
            .lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            guard let continuation = locationContinuation else { return }
            locationContinuation = nil
            guard let location = locations.last else {
                continuation.resume(throwing: NativeDeviceActionError.locationUnavailable)
                return
            }
            continuation.resume(returning: location)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            guard let continuation = locationContinuation else { return }
            locationContinuation = nil
            continuation.resume(throwing: error)
        }
    }
}

enum NativeDeviceActionError: LocalizedError {
    case locationUnavailable
    case whatsappUnavailable
    case contactPhoneUnavailable
    case contactAmbiguous(String)
    case contactPhoneAmbiguous(String)
    case personalPlaceUnavailable
    case appUnavailable
    case urlUnavailable
    case navigationUnavailable
    case callUnavailable
    case smsUnavailable
    case mediaUnavailable

    var errorDescription: String? {
        switch self {
        case .locationUnavailable: return "No he podido obtener la ubicación actual."
        case .whatsappUnavailable: return "No he podido abrir WhatsApp en este iPhone."
        case .contactPhoneUnavailable: return "No he encontrado un número de teléfono utilizable para ese contacto."
        case let .contactAmbiguous(names):
            return names.isEmpty
                ? "He encontrado varios contactos posibles. Indica el nombre completo."
                : "He encontrado varios contactos posibles: \(names). Indica cuál quieres."
        case let .contactPhoneAmbiguous(name):
            return "\(name) tiene varios números. Indica cuál quieres usar desde Contactos."
        case .personalPlaceUnavailable: return "No he encontrado esa dirección personal en tu ficha de contacto."
        case .appUnavailable: return "No he podido abrir esa aplicación."
        case .urlUnavailable: return "No he podido abrir ese enlace o aplicación."
        case .navigationUnavailable: return "No he podido iniciar la navegación."
        case .callUnavailable: return "No he podido preparar la llamada."
        case .smsUnavailable: return "No he podido preparar el mensaje."
        case .mediaUnavailable: return "No he podido abrir el contenido multimedia."
        }
    }
}

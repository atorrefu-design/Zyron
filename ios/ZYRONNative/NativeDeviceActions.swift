import Contacts
import CoreLocation
import Foundation
import UIKit

enum NativeAppOpenResult: Equatable {
    case direct
    case webFallback
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

    func openWhatsApp(target: String? = nil, message: String? = nil) async -> Bool {
        let cleanTarget = target?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let cleanMessage = message?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        var phone = ""
        if !cleanTarget.isEmpty {
            if cleanTarget.range(of: #"^\+?[0-9 ()-]{6,}$"#, options: .regularExpression) != nil {
                phone = sanitizePhone(cleanTarget)
            } else {
                do { phone = try await resolvePhoneNumber(for: cleanTarget) }
                catch { return false }
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

    /// App launches learn whether the native URL scheme or a safe web fallback
    /// is more reliable on this particular iPhone and try the proven route first.
    func openApp(named rawName: String) async -> NativeAppOpenResult {
        guard let candidate = NativeAppRegistry.shared.candidate(named: rawName) else { return .failed }
        let key = normalize(candidate.canonicalName).replacingOccurrences(of: " ", with: "_")
        let nativeRoute = "app.\(key).native"
        let webRoute = "app.\(key).web"
        let availableRoutes = candidate.webFallbackURL == nil ? [nativeRoute] : [nativeRoute, webRoute]
        let routes = NativeCapabilityLedger.shared.orderedByReliability(availableRoutes)

        for route in routes {
            let target = route == nativeRoute ? candidate.launchURL : candidate.webFallbackURL
            guard let target else { continue }
            let opened = await openURLString(target)
            NativeCapabilityLedger.shared.record(action: route, capabilityId: "apps.launch", succeeded: opened)
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
        try await NativePermissionGate.shared.run(requiring: .contacts) {
            let store = CNContactStore()
            let keys = [CNContactPostalAddressesKey] as [CNKeyDescriptor]
            let me = try store.unifiedMeContactWithKeys(toFetch: keys)
            let wanted = self.normalize(place)
            let match = me.postalAddresses.first { labeled in
                let label = self.normalize(CNLabeledValue<NSString>.localizedString(forLabel: labeled.label ?? ""))
                if wanted == "home" { return label.contains("casa") || label.contains("home") }
                if wanted == "work" { return label.contains("trabajo") || label.contains("work") }
                return false
            }
            guard let address = match?.value else { throw NativeDeviceActionError.personalPlaceUnavailable }
            let formatted = CNPostalAddressFormatter.string(from: address, style: .mailingAddress)
                .replacingOccurrences(of: "\n", with: ", ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !formatted.isEmpty else { throw NativeDeviceActionError.personalPlaceUnavailable }
            return formatted
        }
    }

    private func resolvePhoneNumber(for name: String) async throws -> String {
        try await NativePermissionGate.shared.run(requiring: .contacts) {
            let store = CNContactStore()
            let keys = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactPhoneNumbersKey] as [CNKeyDescriptor]
            let request = CNContactFetchRequest(keysToFetch: keys)
            let needle = self.normalize(name)
            var bestMatch: CNContact?
            try store.enumerateContacts(with: request) { contact, stop in
                let fullName = self.normalize("\(contact.givenName) \(contact.familyName)")
                if fullName == needle {
                    bestMatch = contact
                    stop.pointee = true
                } else if bestMatch == nil && (fullName.contains(needle) || needle.contains(fullName)) {
                    bestMatch = contact
                }
            }
            guard let number = bestMatch?.phoneNumbers.first?.value.stringValue else {
                throw NativeDeviceActionError.contactPhoneUnavailable
            }
            return self.sanitizePhone(number)
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
    case personalPlaceUnavailable
    case appUnavailable
    case urlUnavailable
    case navigationUnavailable

    var errorDescription: String? {
        switch self {
        case .locationUnavailable: return "No he podido obtener la ubicación actual."
        case .whatsappUnavailable: return "No he podido abrir WhatsApp en este iPhone."
        case .contactPhoneUnavailable: return "No he encontrado un número de teléfono utilizable para ese contacto."
        case .personalPlaceUnavailable: return "No he encontrado esa dirección personal en tu ficha de contacto."
        case .appUnavailable: return "No he podido abrir esa aplicación."
        case .urlUnavailable: return "No he podido abrir ese enlace o aplicación."
        case .navigationUnavailable: return "No he podido iniciar la navegación."
        }
    }
}

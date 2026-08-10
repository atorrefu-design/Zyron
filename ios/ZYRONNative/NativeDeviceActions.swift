import Contacts
import CoreLocation
import Foundation
import UIKit

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

        if cleanTarget.isEmpty {
            return await openURLString("whatsapp://")
        }

        let phone: String
        if cleanTarget.range(of: #"^\+?[0-9 ()-]{6,}$"#, options: .regularExpression) != nil {
            phone = sanitizePhone(cleanTarget)
        } else {
            do {
                phone = try await resolvePhoneNumber(for: cleanTarget)
            } catch {
                return false
            }
        }

        guard !phone.isEmpty else { return false }
        var components = URLComponents()
        components.scheme = "whatsapp"
        components.host = "send"
        var queryItems = [URLQueryItem(name: "phone", value: phone)]
        if !cleanMessage.isEmpty {
            queryItems.append(URLQueryItem(name: "text", value: cleanMessage))
        }
        components.queryItems = queryItems
        guard let url = components.url else { return false }
        return await openURL(url)
    }

    func openApp(named rawName: String) async -> Bool {
        guard let candidate = NativeAppRegistry.shared.candidate(named: rawName) else { return false }
        let opened = await openURLString(candidate.launchURL)
        if opened {
            NativeAppRegistry.shared.recordSuccessfulLaunch(candidate)
        }
        return opened
    }

    func openURLString(_ rawURL: String) async -> Bool {
        guard let url = URL(string: rawURL), url.scheme != nil else { return false }
        return await openURL(url)
    }

    func startNavigation(to destination: String, personalPlace: String? = nil) async -> Bool {
        var resolvedDestination = destination.trimmingCharacters(in: .whitespacesAndNewlines)

        if let personalPlace, !personalPlace.isEmpty {
            do {
                resolvedDestination = try await resolvePersonalDestination(personalPlace)
            } catch {
                return false
            }
        }

        guard !resolvedDestination.isEmpty else { return false }

        var components = URLComponents(string: "http://maps.apple.com/")
        components?.queryItems = [
            URLQueryItem(name: "daddr", value: resolvedDestination),
            URLQueryItem(name: "dirflg", value: "d"),
        ]
        guard let url = components?.url else { return false }
        return await openURL(url)
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

            guard let address = match?.value else {
                throw NativeDeviceActionError.personalPlaceUnavailable
            }
            let formatted = CNPostalAddressFormatter.string(from: address, style: .mailingAddress)
                .replacingOccurrences(of: "\n", with: ", ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !formatted.isEmpty else {
                throw NativeDeviceActionError.personalPlaceUnavailable
            }
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
            UIApplication.shared.open(url, options: [:]) { opened in
                continuation.resume(returning: opened)
            }
        }
    }

    private func sanitizePhone(_ value: String) -> String {
        value.filter(\.isNumber)
    }

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
        case .locationUnavailable:
            return "No he podido obtener la ubicación actual."
        case .whatsappUnavailable:
            return "No he podido abrir WhatsApp en este iPhone."
        case .contactPhoneUnavailable:
            return "No he encontrado un número de teléfono utilizable para ese contacto."
        case .personalPlaceUnavailable:
            return "No he encontrado esa dirección personal en tu ficha de contacto."
        case .appUnavailable:
            return "No he podido abrir esa aplicación."
        case .urlUnavailable:
            return "No he podido abrir ese enlace o aplicación."
        case .navigationUnavailable:
            return "No he podido iniciar la navegación."
        }
    }
}

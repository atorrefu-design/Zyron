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

    func openWhatsApp() async -> Bool {
        await openURLString("whatsapp://")
    }

    func openURLString(_ rawURL: String) async -> Bool {
        guard let url = URL(string: rawURL), url.scheme != nil else { return false }
        return await withCheckedContinuation { continuation in
            UIApplication.shared.open(url, options: [:]) { opened in
                continuation.resume(returning: opened)
            }
        }
    }

    func startNavigation(to destination: String) async -> Bool {
        let trimmed = destination.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }

        var components = URLComponents(string: "http://maps.apple.com/")
        components?.queryItems = [
            URLQueryItem(name: "daddr", value: trimmed),
            URLQueryItem(name: "dirflg", value: "d"),
        ]
        guard let url = components?.url else { return false }
        return await withCheckedContinuation { continuation in
            UIApplication.shared.open(url, options: [:]) { opened in
                continuation.resume(returning: opened)
            }
        }
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
    case urlUnavailable
    case navigationUnavailable

    var errorDescription: String? {
        switch self {
        case .locationUnavailable:
            return "No he podido obtener la ubicación actual."
        case .whatsappUnavailable:
            return "No he podido abrir WhatsApp en este iPhone."
        case .urlUnavailable:
            return "No he podido abrir ese enlace o aplicación."
        case .navigationUnavailable:
            return "No he podido iniciar la navegación."
        }
    }
}

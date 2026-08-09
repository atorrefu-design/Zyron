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
        guard let url = URL(string: "whatsapp://") else { return false }
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

    var errorDescription: String? {
        switch self {
        case .locationUnavailable:
            return "No he podido obtener la ubicación actual."
        case .whatsappUnavailable:
            return "No he podido abrir WhatsApp en este iPhone."
        }
    }
}

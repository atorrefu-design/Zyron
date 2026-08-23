import AVFoundation
import CoreLocation
import Foundation

/// Central permission/readiness layer for the iPhone companion.
///
/// ZYRON asks iOS for each protected capability only when iOS allows it. Once
/// granted, subsequent actions reuse the authorisation and execute directly.
/// The coordinator deliberately does not pretend iOS has a single universal
/// permission: it exposes one onboarding flow over the individual system grants.
@MainActor
final class PermissionCoordinator: NSObject, CLLocationManagerDelegate {
    static let shared = PermissionCoordinator()

    enum Capability: String, CaseIterable, Codable {
        case microphone
        case locationWhenInUse
    }

    enum Status: String, Codable {
        case granted
        case denied
        case notDetermined
        case restricted
    }

    struct Snapshot: Codable, Equatable {
        let microphone: Status
        let locationWhenInUse: Status

        var readyCapabilities: [Capability] {
            var result: [Capability] = []
            if microphone == .granted { result.append(.microphone) }
            if locationWhenInUse == .granted { result.append(.locationWhenInUse) }
            return result
        }
    }

    private let locationManager = CLLocationManager()
    private var locationContinuation: CheckedContinuation<Bool, Never>?

    override private init() {
        super.init()
        locationManager.delegate = self
    }

    func snapshot() -> Snapshot {
        Snapshot(
            microphone: Self.microphoneStatus(),
            locationWhenInUse: Self.locationStatus(locationManager.authorizationStatus)
        )
    }

    /// Onboarding helper: request the useful permissions that can be requested
    /// programmatically. iOS still owns and displays every consent sheet.
    func prepareCorePermissions() async -> Snapshot {
        if Self.microphoneStatus() == .notDetermined {
            _ = await NativeRecordingController.shared.requestPermission()
        }
        if Self.locationStatus(locationManager.authorizationStatus) == .notDetermined {
            _ = await requestLocationWhenInUse()
        }
        return snapshot()
    }

    /// Used by action executors. If already granted this returns immediately;
    /// if not determined it asks once; if denied/restricted it never loops.
    func ensure(_ capability: Capability) async -> Bool {
        switch capability {
        case .microphone:
            switch Self.microphoneStatus() {
            case .granted: return true
            case .notDetermined: return await NativeRecordingController.shared.requestPermission()
            case .denied, .restricted: return false
            }
        case .locationWhenInUse:
            switch Self.locationStatus(locationManager.authorizationStatus) {
            case .granted: return true
            case .notDetermined: return await requestLocationWhenInUse()
            case .denied, .restricted: return false
            }
        }
    }

    private func requestLocationWhenInUse() async -> Bool {
        if let locationContinuation {
            return await withCheckedContinuation { continuation in
                Task { @MainActor in
                    let existing = await withCheckedContinuation { inner in
                        self.locationContinuation = inner
                    }
                    continuation.resume(returning: existing)
                }
            }
        }

        return await withCheckedContinuation { continuation in
            locationContinuation = continuation
            locationManager.requestWhenInUseAuthorization()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard let continuation = locationContinuation else { return }
        let status = Self.locationStatus(manager.authorizationStatus)
        guard status != .notDetermined else { return }
        locationContinuation = nil
        continuation.resume(returning: status == .granted)
        VoiceDiagnosticsLog.record("permission_location_resolved", detail: status.rawValue)
    }

    private static func microphoneStatus() -> Status {
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: return .granted
        case .denied: return .denied
        case .undetermined: return .notDetermined
        @unknown default: return .restricted
        }
    }

    private static func locationStatus(_ value: CLAuthorizationStatus) -> Status {
        switch value {
        case .authorizedAlways, .authorizedWhenInUse: return .granted
        case .denied: return .denied
        case .notDetermined: return .notDetermined
        case .restricted: return .restricted
        @unknown default: return .restricted
        }
    }
}

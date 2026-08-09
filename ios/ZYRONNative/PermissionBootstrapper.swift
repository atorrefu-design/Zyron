import AVFoundation
import Contacts
import CoreLocation
import EventKit
import Foundation
import Photos
import UserNotifications

@MainActor
final class PermissionBootstrapper: NSObject, CLLocationManagerDelegate {
    static let shared = PermissionBootstrapper()

    enum PermissionKind: String, CaseIterable {
        case microphone
        case notifications
        case location
        case contacts
        case calendar
        case photos
    }

    struct Snapshot: Equatable {
        let granted: Set<PermissionKind>
        let denied: Set<PermissionKind>
        let notDetermined: Set<PermissionKind>

        var isComplete: Bool { notDetermined.isEmpty }
    }

    private let locationManager = CLLocationManager()
    private var locationContinuation: CheckedContinuation<Bool, Never>?

    override private init() {
        super.init()
        locationManager.delegate = self
    }

    func snapshot() async -> Snapshot {
        var granted = Set<PermissionKind>()
        var denied = Set<PermissionKind>()
        var notDetermined = Set<PermissionKind>()

        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: granted.insert(.microphone)
        case .denied: denied.insert(.microphone)
        case .undetermined: notDetermined.insert(.microphone)
        @unknown default: notDetermined.insert(.microphone)
        }

        let notification = await UNUserNotificationCenter.current().notificationSettings()
        switch notification.authorizationStatus {
        case .authorized, .provisional, .ephemeral: granted.insert(.notifications)
        case .denied: denied.insert(.notifications)
        case .notDetermined: notDetermined.insert(.notifications)
        @unknown default: notDetermined.insert(.notifications)
        }

        switch locationManager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: granted.insert(.location)
        case .denied, .restricted: denied.insert(.location)
        case .notDetermined: notDetermined.insert(.location)
        @unknown default: notDetermined.insert(.location)
        }

        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .authorized, .limited: granted.insert(.contacts)
        case .denied, .restricted: denied.insert(.contacts)
        case .notDetermined: notDetermined.insert(.contacts)
        @unknown default: notDetermined.insert(.contacts)
        }

        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess, .authorized, .writeOnly: granted.insert(.calendar)
        case .denied, .restricted: denied.insert(.calendar)
        case .notDetermined: notDetermined.insert(.calendar)
        @unknown default: notDetermined.insert(.calendar)
        }

        switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
        case .authorized, .limited: granted.insert(.photos)
        case .denied, .restricted: denied.insert(.photos)
        case .notDetermined: notDetermined.insert(.photos)
        @unknown default: notDetermined.insert(.photos)
        }

        return Snapshot(granted: granted, denied: denied, notDetermined: notDetermined)
    }

    /// Requests one permission only if iOS has not already made a decision.
    /// The returned snapshot lets the caller resume the original action immediately
    /// after the user accepts the system dialog, without asking them to repeat it.
    @discardableResult
    func request(_ permission: PermissionKind) async -> Snapshot {
        let before = await snapshot()
        guard before.notDetermined.contains(permission) else { return before }

        switch permission {
        case .microphone:
            _ = await NativeRecordingController.shared.requestPermission()

        case .notifications:
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])

        case .location:
            _ = await requestLocationWhenInUse()

        case .contacts:
            _ = try? await CNContactStore().requestAccess(for: .contacts)

        case .calendar:
            let store = EKEventStore()
            if #available(iOS 17.0, *) {
                _ = try? await store.requestFullAccessToEvents()
            } else {
                _ = try? await withCheckedThrowingContinuation { continuation in
                    store.requestAccess(to: .event) { granted, error in
                        if let error { continuation.resume(throwing: error) }
                        else { continuation.resume(returning: granted) }
                    }
                }
            }

        case .photos:
            _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        }

        let after = await snapshot()
        WakeWordDiagnostics.shared.record(
            "permission_request_completed",
            detail: "permission=\(permission.rawValue); granted=\(after.granted.contains(permission))"
        )
        return after
    }

    /// Requests every useful permission that iOS allows an app to request proactively.
    /// Already decided permissions are skipped, so this is safe to call again later.
    @discardableResult
    func requestInitialPermissions() async -> Snapshot {
        for permission in PermissionKind.allCases {
            _ = await request(permission)
        }

        let result = await snapshot()
        WakeWordDiagnostics.shared.record(
            "permission_bootstrap_completed",
            detail: "granted=\(result.granted.map(\.rawValue).sorted().joined(separator: ",")); denied=\(result.denied.map(\.rawValue).sorted().joined(separator: ","))"
        )
        return result
    }

    private func requestLocationWhenInUse() async -> Bool {
        await withCheckedContinuation { continuation in
            locationContinuation = continuation
            locationManager.requestWhenInUseAuthorization()
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            guard let continuation = locationContinuation else { return }
            switch manager.authorizationStatus {
            case .authorizedAlways, .authorizedWhenInUse:
                locationContinuation = nil
                continuation.resume(returning: true)
            case .denied, .restricted:
                locationContinuation = nil
                continuation.resume(returning: false)
            case .notDetermined:
                break
            @unknown default:
                locationContinuation = nil
                continuation.resume(returning: false)
            }
        }
    }
}

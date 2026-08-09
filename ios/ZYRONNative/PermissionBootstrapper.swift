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
        case .authorized: granted.insert(.contacts)
        case .denied, .restricted: denied.insert(.contacts)
        case .notDetermined: notDetermined.insert(.contacts)
        case .limited: granted.insert(.contacts)
        @unknown default: notDetermined.insert(.contacts)
        }

        let eventStatus = EKEventStore.authorizationStatus(for: .event)
        switch eventStatus {
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

    /// Requests every useful permission that iOS allows an app to request proactively.
    /// iOS still owns the system dialogs; ZYRON cannot approve them on the user's behalf.
    /// Already decided permissions are skipped, so this is safe to call again later.
    @discardableResult
    func requestInitialPermissions() async -> Snapshot {
        if AVAudioSession.sharedInstance().recordPermission == .undetermined {
            _ = await NativeRecordingController.shared.requestPermission()
        }

        let notificationSettings = await UNUserNotificationCenter.current().notificationSettings()
        if notificationSettings.authorizationStatus == .notDetermined {
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
        }

        if locationManager.authorizationStatus == .notDetermined {
            _ = await requestLocationWhenInUse()
        }

        if CNContactStore.authorizationStatus(for: .contacts) == .notDetermined {
            _ = try? await CNContactStore().requestAccess(for: .contacts)
        }

        if EKEventStore.authorizationStatus(for: .event) == .notDetermined {
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
        }

        if PHPhotoLibrary.authorizationStatus(for: .readWrite) == .notDetermined {
            _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
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

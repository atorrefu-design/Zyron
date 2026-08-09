import Foundation

@MainActor
final class NativePermissionGate {
    static let shared = NativePermissionGate()

    private init() {}

    enum Outcome: Equatable {
        case granted
        case denied
        case unavailable
    }

    /// Central permission gate for native actions.
    ///
    /// If a permission is already granted, the action continues immediately.
    /// If iOS has not asked yet, ZYRON requests it once and resumes the original
    /// action automatically as soon as the user accepts the system dialog.
    /// The user never has to repeat the spoken command after granting access.
    func ensure(_ permission: PermissionBootstrapper.PermissionKind) async -> Outcome {
        let initial = await PermissionBootstrapper.shared.snapshot()
        if initial.granted.contains(permission) { return .granted }
        if initial.denied.contains(permission) { return .denied }

        let updated = await PermissionBootstrapper.shared.request(permission)
        if updated.granted.contains(permission) { return .granted }
        if updated.denied.contains(permission) { return .denied }
        return .unavailable
    }

    func run<T>(
        requiring permission: PermissionBootstrapper.PermissionKind,
        operation: () async throws -> T
    ) async throws -> T {
        switch await ensure(permission) {
        case .granted:
            return try await operation()
        case .denied:
            throw NativePermissionGateError.denied(permission)
        case .unavailable:
            throw NativePermissionGateError.unavailable(permission)
        }
    }
}

enum NativePermissionGateError: LocalizedError {
    case denied(PermissionBootstrapper.PermissionKind)
    case unavailable(PermissionBootstrapper.PermissionKind)

    var errorDescription: String? {
        switch self {
        case let .denied(permission):
            return "El permiso \(permission.rawValue) está bloqueado en Ajustes."
        case let .unavailable(permission):
            return "No he podido obtener el permiso \(permission.rawValue)."
        }
    }
}

import Foundation

@MainActor
protocol NativeRealtimeTransport: RealtimeEventSending, AnyObject {
    var onEvent: ((String) -> Void)? { get set }
    var onDisconnected: ((String?) -> Void)? { get set }

    var isConnected: Bool { get }

    func connect(responseMode: ZyronResponseMode) async throws -> ZyronResponseMode
    func disconnect()
}

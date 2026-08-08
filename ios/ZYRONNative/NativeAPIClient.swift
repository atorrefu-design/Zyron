import Foundation

struct NativeLoginResponse: Decodable {
    let ok: Bool
    let token: String
    let tokenType: String
    let expiresIn: Int
}

struct VoicePolicyEnvelope: Decodable {
    struct Communication: Decodable {
        let timeZone: String
        let localHour: Int
        let wakeWord: String
        let responseMode: String
        let shouldSpeak: Bool
        let textDelivery: String?
    }

    struct Engagement: Decodable {
        let wakeWord: String
        let wakeConfirmationWindowMs: Int
        let wakePauseActivationMs: Int
        let idleConversationTimeoutMs: Int
        let softGoodbyeTimeoutMs: Int
        let localContextWindowMs: Int
    }

    let communication: Communication
    let engagement: Engagement
}

enum NativeAPIError: LocalizedError {
    case notAuthenticated
    case invalidResponse
    case server(status: Int, detail: String)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "ZYRON necesita iniciar sesión en este iPhone."
        case .invalidResponse:
            return "ZYRON ha recibido una respuesta de servidor no válida."
        case let .server(status, detail):
            return detail.isEmpty ? "Error de servidor (\(status))." : detail
        }
    }
}

final class NativeAPIClient {
    static let shared = NativeAPIClient()

    let baseURL = URL(string: "https://zyron-five.vercel.app")!

    private init() {}

    func login(ownerKey: String) async throws {
        var request = URLRequest(url: baseURL.appending(path: "/api/auth/native-login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(["key": ownerKey])

        let (data, response) = try await URLSession.shared.data(for: request)
        let http = try validatedHTTP(response)
        guard (200..<300).contains(http.statusCode) else {
            throw NativeAPIError.server(status: http.statusCode, detail: serverDetail(data))
        }

        let login = try JSONDecoder().decode(NativeLoginResponse.self, from: data)
        guard login.ok, !login.token.isEmpty else { throw NativeAPIError.invalidResponse }
        try KeychainStore.saveOwnerSession(login.token)
    }

    func fetchVoicePolicy() async throws -> VoicePolicyEnvelope {
        var request = try authenticatedRequest(path: "/api/voice/policy")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        let http = try validatedHTTP(response)
        guard (200..<300).contains(http.statusCode) else {
            throw NativeAPIError.server(status: http.statusCode, detail: serverDetail(data))
        }
        return try JSONDecoder().decode(VoicePolicyEnvelope.self, from: data)
    }

    func createRealtimeCall(sdpOffer: String) async throws -> String {
        var request = try authenticatedRequest(path: "/api/realtime/call")
        request.httpMethod = "POST"
        request.setValue("application/sdp", forHTTPHeaderField: "Content-Type")
        request.setValue("application/sdp", forHTTPHeaderField: "Accept")
        request.httpBody = Data(sdpOffer.utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        let http = try validatedHTTP(response)
        guard (200..<300).contains(http.statusCode) else {
            throw NativeAPIError.server(status: http.statusCode, detail: serverDetail(data))
        }
        guard let answer = String(data: data, encoding: .utf8), answer.hasPrefix("v=0") else {
            throw NativeAPIError.invalidResponse
        }
        return answer
    }

    func logout() {
        KeychainStore.clearOwnerSession()
    }

    private func authenticatedRequest(path: String) throws -> URLRequest {
        guard let token = KeychainStore.ownerSession() else {
            throw NativeAPIError.notAuthenticated
        }
        var request = URLRequest(url: baseURL.appending(path: path))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return request
    }

    private func validatedHTTP(_ response: URLResponse) throws -> HTTPURLResponse {
        guard let http = response as? HTTPURLResponse else { throw NativeAPIError.invalidResponse }
        return http
    }

    private func serverDetail(_ data: Data) -> String {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "" }
        return (object["detail"] as? String) ?? (object["error"] as? String) ?? ""
    }
}

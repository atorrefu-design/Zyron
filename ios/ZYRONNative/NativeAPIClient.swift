import Foundation

struct NativeLoginResponse: Decodable {
    let ok: Bool
    let token: String
    let tokenType: String
    let expiresIn: Int
}

struct NativeDeviceLocation: Codable {
    let latitude: Double
    let longitude: Double
    let accuracy: Double
    let capturedAt: String
}

struct NativeHealthResponse: Decodable {
    let ok: Bool
    let service: String?
    let timestamp: String?
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

struct NativeRealtimeCall {
    let answerSDP: String
    let outputMode: ZyronResponseMode
}

private struct NativeChatRequest: Encodable {
    struct Message: Encodable {
        let role: String
        let content: String
    }

    let messages: [Message]
    let deviceLocation: NativeDeviceLocation?
}

struct NativeActionResolution: Decodable {
    let ok: Bool?
    let mode: String?
    let action: String?
    let capabilityId: String?
    let input: String?
    let payload: [String: String]?
    let message: String?
    let reply: String?
    let error: String?
}

private struct NativePlacesRequest: Encodable {
    let query: String
    let latitude: Double?
    let longitude: Double?
}

private struct NativeTaskCreateRequest: Encodable {
    let title: String
    let dueAt: String?
}

private struct NativeCalendarCommandRequest: Encodable {
    let message: String
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

    var hasOwnerSession: Bool {
        KeychainStore.ownerSession() != nil
    }

    private init() {}

    func fetchHealth() async throws -> NativeHealthResponse {
        var request = try authenticatedRequest(path: "/api/health")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let (data, response) = try await URLSession.shared.data(for: request)
        let http = try validatedHTTP(response)
        guard (200..<300).contains(http.statusCode) else {
            throw NativeAPIError.server(status: http.statusCode, detail: serverDetail(data))
        }
        return try JSONDecoder().decode(NativeHealthResponse.self, from: data)
    }

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

    func createRealtimeCall(
        sdpOffer: String,
        responseMode: ZyronResponseMode = VoiceCommunicationPolicy.current().responseMode
    ) async throws -> NativeRealtimeCall {
        var request = try authenticatedRequest(path: "/api/realtime/native-call")
        request.httpMethod = "POST"
        request.setValue("application/sdp", forHTTPHeaderField: "Content-Type")
        request.setValue("application/sdp", forHTTPHeaderField: "Accept")
        request.setValue(responseMode.rawValue, forHTTPHeaderField: "X-Zyron-Output-Mode")
        request.httpBody = Data(sdpOffer.utf8)

        let start = Date()
        let (data, response) = try await URLSession.shared.data(for: request)
        print("ZYRON_REALTIME_CALL_MS:", Int(Date().timeIntervalSince(start) * 1000))
        let http = try validatedHTTP(response)
        guard (200..<300).contains(http.statusCode) else {
            throw NativeAPIError.server(status: http.statusCode, detail: serverDetail(data))
        }
        guard let answer = String(data: data, encoding: .utf8), answer.hasPrefix("v=0") else {
            throw NativeAPIError.invalidResponse
        }

        let confirmedMode = http.value(forHTTPHeaderField: "X-Zyron-Output-Mode")
            .flatMap(ZyronResponseMode.init(rawValue:)) ?? responseMode
        return NativeRealtimeCall(answerSDP: answer, outputMode: confirmedMode)
    }

    func queryCore(_ query: String, deviceLocation: NativeDeviceLocation? = nil) async throws -> String {
        let body = NativeChatRequest(
            messages: [.init(role: "user", content: query)],
            deviceLocation: deviceLocation
        )
        let data = try await postJSON(path: "/api/chat", body: body)
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let reply = object["reply"] as? String,
              !reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw NativeAPIError.invalidResponse
        }
        return reply
    }

    func resolveNativeAction(_ query: String, deviceLocation: NativeDeviceLocation? = nil) async throws -> NativeActionResolution {
        let body = NativeChatRequest(
            messages: [.init(role: "user", content: query)],
            deviceLocation: deviceLocation
        )
        let data = try await postJSON(path: "/api/act", body: body)
        return try JSONDecoder().decode(NativeActionResolution.self, from: data)
    }

    func createTask(title: String, dueAt: String? = nil) async throws -> String {
        let data = try await postJSON(
            path: "/api/tasks",
            body: NativeTaskCreateRequest(title: title, dueAt: dueAt)
        )
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let task = object["task"] as? [String: Any],
              let savedTitle = task["title"] as? String else {
            throw NativeAPIError.invalidResponse
        }
        return "He creado la tarea «\(savedTitle)»."
    }

    func runCalendarCommand(_ message: String) async throws -> String {
        let data = try await postJSON(
            path: "/api/calendar/command",
            body: NativeCalendarCommandRequest(message: message)
        )
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let reply = object["reply"] as? String,
              !reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw NativeAPIError.invalidResponse
        }
        return reply
    }

    func searchPlaces(_ query: String, deviceLocation: NativeDeviceLocation? = nil) async throws -> String {
        let body = NativePlacesRequest(
            query: query,
            latitude: deviceLocation?.latitude,
            longitude: deviceLocation?.longitude
        )
        let data = try await postJSON(path: "/api/places/search", body: body)
        guard let json = String(data: data, encoding: .utf8), !json.isEmpty else {
            throw NativeAPIError.invalidResponse
        }
        return json
    }

    func logout() {
        KeychainStore.clearOwnerSession()
    }

    private func postJSON<Body: Encodable>(path: String, body: Body) async throws -> Data {
        var request = try authenticatedRequest(path: path)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let http = try validatedHTTP(response)
        guard (200..<300).contains(http.statusCode) else {
            throw NativeAPIError.server(status: http.statusCode, detail: serverDetail(data))
        }
        return data
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

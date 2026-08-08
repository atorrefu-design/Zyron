import Foundation

struct RealtimeServerEvent: Decodable {
    struct EventError: Decodable {
        let message: String?
        let code: String?
    }

    let type: String?
    let transcript: String?
    let text: String?
    let itemID: String?
    let callID: String?
    let name: String?
    let arguments: String?
    let error: EventError?

    enum CodingKeys: String, CodingKey {
        case type
        case transcript
        case text
        case itemID = "item_id"
        case callID = "call_id"
        case name
        case arguments
        case error
    }

    static func decode(_ raw: String) -> RealtimeServerEvent? {
        guard let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(RealtimeServerEvent.self, from: data)
    }
}

enum RealtimeClientEventCodec {
    static func functionOutput(callID: String, output: String) -> String? {
        encode([
            "type": "conversation.item.create",
            "item": [
                "type": "function_call_output",
                "call_id": callID,
                "output": output,
            ],
        ])
    }

    static func responseCreate() -> String? {
        encode(["type": "response.create"])
    }

    static func inputText(_ text: String) -> String? {
        encode([
            "type": "conversation.item.create",
            "item": [
                "type": "message",
                "role": "user",
                "content": [[
                    "type": "input_text",
                    "text": text,
                ]],
            ],
        ])
    }

    private static func encode(_ object: [String: Any]) -> String? {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let json = String(data: data, encoding: .utf8) else {
            return nil
        }
        return json
    }
}

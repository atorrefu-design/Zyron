import Foundation

/// Converts opaque native action values into a small typed context that later
/// steps can consume without having to know how every previous action encoded
/// its result.
struct NativeResultContext {
    static func values(action: String, capabilityId: String?, value: String) -> [String: String] {
        var context: [String: String] = [
            "result.value": value,
            "result.type": inferType(action: action, capabilityId: capabilityId, value: value),
            "result.best": value,
        ]

        switch context["result.type"] {
        case "location":
            if let location = parseLocation(value) {
                context["location.latitude"] = String(location.latitude)
                context["location.longitude"] = String(location.longitude)
                context["location.accuracy"] = String(location.accuracy)
                context["location.coordinate"] = "\(location.latitude),\(location.longitude)"
                context["location.share"] = "Mi ubicación: https://maps.apple.com/?ll=\(location.latitude),\(location.longitude)"
                context["result.share"] = context["location.share"]
                context["result.best"] = context["location.share"]
                context["result.destination"] = context["location.coordinate"]
            }
        case "file":
            context["file.path"] = value
            context["file.url"] = URL(fileURLWithPath: value).absoluteString
            context["result.share"] = context["file.url"]
            context["result.best"] = context["file.url"]
        case "notification":
            context["notification.id"] = value
            context["result.best"] = value
        case "executor":
            context["executor.name"] = value
            context["result.best"] = value
        case "url":
            context["url.value"] = value
            context["result.share"] = value
            context["result.best"] = value
        default:
            context["text.value"] = value
            context["result.best"] = value
        }

        return context
    }

    private static func inferType(action: String, capabilityId: String?, value: String) -> String {
        if action == "get_current_location" || capabilityId == "location.current" || parseLocation(value) != nil {
            return "location"
        }
        if action == "recording.start" || action == "recording.stop" || action == "recording_control" {
            return value.hasPrefix("/") ? "file" : "text"
        }
        if action == "schedule_native_notification" { return "notification" }
        if action == "app.open" || action == "media.play" { return "executor" }
        if value.hasPrefix("/") { return "file" }
        if value.hasPrefix("http://") || value.hasPrefix("https://") { return "url" }
        return "text"
    }

    private static func parseLocation(_ value: String) -> (latitude: Double, longitude: Double, accuracy: Double)? {
        guard let data = value.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let latitude = object["latitude"] as? Double,
              let longitude = object["longitude"] as? Double else { return nil }
        let accuracy = object["accuracy"] as? Double ?? -1
        return (latitude, longitude, accuracy)
    }
}

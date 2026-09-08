import Foundation

enum VehicleModePrompt {
    static func greeting(forHour hour: Int) -> String {
        switch hour {
        case 5..<14:
            return "Buenos días, señor."
        case 14..<21:
            return "Buenas tardes, señor."
        default:
            return "Buenas noches, señor."
        }
    }

    static func command(now: Date = Date(), timeZone: TimeZone? = TimeZone(identifier: "Europe/Madrid")) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone ?? .current
        let greeting = greeting(forHour: calendar.component(.hour, from: now))
        return "[ZYRON_MODO_COCHE_INICIO] Di exactamente: «\(greeting) ¿Dónde quiere ir?». Después espera su respuesta. Interpreta su siguiente respuesta como el destino, aunque solo diga el nombre del lugar, y llama inmediatamente a iniciar_navegacion_google_maps."
    }
}

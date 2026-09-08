import XCTest
@testable import ZYRON

final class VehicleModePromptTests: XCTestCase {
    func testGreetingChangesAtConfiguredBoundaries() {
        XCTAssertEqual(VehicleModePrompt.greeting(forHour: 4), "Buenas noches, señor.")
        XCTAssertEqual(VehicleModePrompt.greeting(forHour: 5), "Buenos días, señor.")
        XCTAssertEqual(VehicleModePrompt.greeting(forHour: 13), "Buenos días, señor.")
        XCTAssertEqual(VehicleModePrompt.greeting(forHour: 14), "Buenas tardes, señor.")
        XCTAssertEqual(VehicleModePrompt.greeting(forHour: 20), "Buenas tardes, señor.")
        XCTAssertEqual(VehicleModePrompt.greeting(forHour: 21), "Buenas noches, señor.")
    }

    func testCommandKeepsVehicleModeAndGoogleMapsContract() {
        let command = VehicleModePrompt.command(now: Date(timeIntervalSince1970: 0), timeZone: TimeZone(secondsFromGMT: 0))
        XCTAssertTrue(command.contains("[ZYRON_MODO_COCHE_INICIO]"))
        XCTAssertTrue(command.contains("¿Dónde quiere ir?"))
        XCTAssertTrue(command.contains("iniciar_navegacion_google_maps"))
    }
}

import XCTest

final class LaunchTests: XCTestCase {
    func testHomeRendersAndReturnsFromBackground() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()

        let title = app.staticTexts["zyron.home.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 15),
                      "ZYRON did not render its home screen after launch.")
        XCTAssertTrue(title.isHittable, "The home screen is not visible.")

        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(title.waitForExistence(timeout: 10),
                      "ZYRON did not restore its home screen.")

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "ZYRON home after foreground"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

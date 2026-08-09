import XCTest
@testable import ZYRON

final class VoiceEngagementClassifierTests: XCTestCase {
    func testDirectCallWithRequestActivatesAndExtractsCommand() {
        let result = VoiceEngagementClassifier.classify(
            transcript: "Oye ZYRON, busca una farmacia cerca",
            activeConversation: false
        )

        XCTAssertEqual(result.decision.rawValue, VoiceEngagementDecision.activate.rawValue)
        XCTAssertEqual(result.command, "busca una farmacia cerca")
    }

    func testCasualMentionDoesNotActivate() {
        let result = VoiceEngagementClassifier.classify(
            transcript: "Ayer estaba hablando de ZYRON",
            activeConversation: false
        )

        XCTAssertEqual(result.decision.rawValue, VoiceEngagementDecision.ignore.rawValue)
        XCTAssertEqual(result.reason, "name_mentioned")
    }

    func testNameFollowedByPauseActivates() {
        let result = VoiceEngagementClassifier.classify(
            transcript: "ZYRON",
            activeConversation: false,
            silenceAfterWakeMs: 1_800
        )

        XCTAssertEqual(result.decision.rawValue, VoiceEngagementDecision.activate.rawValue)
    }

    func testExplicitGoodbyeEndsActiveConversation() {
        let result = VoiceEngagementClassifier.classify(
            transcript: "Hasta luego, ZYRON",
            activeConversation: true
        )

        XCTAssertEqual(result.decision.rawValue, VoiceEngagementDecision.end.rawValue)
        XCTAssertEqual(result.reason, "explicit_end")
    }

    func testNormalTurnContinuesActiveConversation() {
        let result = VoiceEngagementClassifier.classify(
            transcript: "Y busca otra que esté abierta",
            activeConversation: true
        )

        XCTAssertEqual(result.decision.rawValue, VoiceEngagementDecision.continue.rawValue)
    }
}

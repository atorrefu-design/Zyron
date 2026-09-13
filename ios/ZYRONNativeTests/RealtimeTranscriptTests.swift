import XCTest
@testable import ZYRON

final class RealtimeTranscriptTests: XCTestCase {
    func testTranscriptKeepsItemIdentityForIdempotentStorage() {
        let event = RealtimeServerEvent.decode("{\"type\":\"conversation.item.input_audio_transcription.completed\",\"item_id\":\"item_example\",\"transcript\":\"Prefiero respuestas breves\"}")
        XCTAssertEqual(event?.itemID, "item_example")
        XCTAssertEqual(event?.transcript, "Prefiero respuestas breves")
    }
    func testPlaybackEventDoesNotRequireTranscript() {
        XCTAssertEqual(RealtimeServerEvent.decode("{\"type\":\"output_audio_buffer.stopped\"}")?.type, "output_audio_buffer.stopped")
    }
}

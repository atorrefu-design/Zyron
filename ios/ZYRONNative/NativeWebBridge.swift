import Foundation
import WebKit

/// Receives privileged action requests from the ZYRON web UI running inside
/// the native companion and forwards them to NativeActionDispatcher.
///
/// JavaScript posts to `window.webkit.messageHandlers.zyronNativeAction`.
/// The bridge replies back into the page by dispatching
/// `zyron:native-action-result` with the execution outcome.
@MainActor
final class NativeWebBridge: NSObject, WKScriptMessageHandler {
    static let messageHandlerName = "zyronNativeAction"

    weak var webView: WKWebView?

    init(webView: WKWebView? = nil) {
        self.webView = webView
        super.init()
    }

    func install(on configuration: WKWebViewConfiguration) {
        configuration.userContentController.removeScriptMessageHandler(forName: Self.messageHandlerName)
        configuration.userContentController.add(self, name: Self.messageHandlerName)
    }

    func uninstall(from configuration: WKWebViewConfiguration) {
        configuration.userContentController.removeScriptMessageHandler(forName: Self.messageHandlerName)
    }

    nonisolated func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.messageHandlerName else { return }
        Task { @MainActor in
            await self.handle(message.body)
        }
    }

    private func handle(_ body: Any) async {
        guard JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body),
              let envelope = try? JSONDecoder().decode(NativeActionEnvelope.self, from: data) else {
            await emitResult(action: nil, result: .init(
                handled: false,
                succeeded: false,
                reply: "La orden nativa recibida no es válida.",
                value: nil
            ))
            return
        }

        let result = await NativeActionDispatcher.shared.execute(envelope)
        await emitResult(action: envelope.action, result: result)
    }

    private func emitResult(action: String?, result: NativeActionDispatcher.Result) async {
        guard let webView else { return }

        let payload: [String: Any?] = [
            "action": action,
            "handled": result.handled,
            "succeeded": result.succeeded,
            "reply": result.reply,
            "value": result.value,
        ]

        let jsonObject = payload.compactMapValues { $0 }
        guard JSONSerialization.isValidJSONObject(jsonObject),
              let data = try? JSONSerialization.data(withJSONObject: jsonObject),
              let json = String(data: data, encoding: .utf8) else { return }

        let script = "window.dispatchEvent(new CustomEvent('zyron:native-action-result',{detail:\(json)}));"
        do {
            _ = try await webView.evaluateJavaScript(script)
        } catch {
            VoiceDiagnosticsLog.record("native_bridge_reply_failed", detail: error.localizedDescription)
        }
    }
}

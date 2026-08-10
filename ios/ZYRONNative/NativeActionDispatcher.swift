import Foundation

struct NativeActionEnvelope: Codable, Equatable {
    let action: String
    let input: String?
    let capabilityId: String?
    let payload: [String: String]?
}

private struct NativeSequenceStep: Codable {
    let action: String
    let capabilityId: String
    let input: String
    let payload: [String: String]
}

private struct NativeConditionalPlan: Codable {
    let primary: NativeSequenceStep
    let condition: String
    let branch: NativeSequenceStep
}

@MainActor
final class NativeActionDispatcher {
    static let shared = NativeActionDispatcher()

    struct Result: Equatable {
        let handled: Bool
        let succeeded: Bool
        let reply: String?
        let value: String?
    }

    typealias Handler = (NativeActionEnvelope) async -> Result

    private var handlers: [String: Handler] = [:]

    private init() { registerBuiltIns() }

    func register(_ action: String, handler: @escaping Handler) { handlers[action] = handler }

    func execute(_ envelope: NativeActionEnvelope) async -> Result {
        guard let handler = handlers[envelope.action] else {
            WakeWordDiagnostics.shared.record("native_action_unhandled", detail: envelope.action)
            return Result(handled: false, succeeded: false, reply: nil, value: nil)
        }

        let result = await handler(envelope)
        NativeCapabilityLedger.shared.record(action: envelope.action, capabilityId: envelope.capabilityId, succeeded: result.succeeded)
        WakeWordDiagnostics.shared.record(
            result.succeeded ? "native_action_succeeded" : "native_action_failed",
            detail: "\(envelope.action); capability=\(envelope.capabilityId ?? "unknown")"
        )
        return result
    }

    private func registerBuiltIns() {
        register("conditional.execute") { envelope in
            guard let raw = envelope.payload?["plan"],
                  let data = raw.data(using: .utf8),
                  let plan = try? JSONDecoder().decode(NativeConditionalPlan.self, from: data) else {
                return Result(handled: true, succeeded: false, reply: "No he podido interpretar la condición.", value: nil)
            }

            let primaryEnvelope = NativeActionEnvelope(
                action: plan.primary.action,
                input: plan.primary.input,
                capabilityId: plan.primary.capabilityId,
                payload: plan.primary.payload
            )
            let primaryResult = await self.execute(primaryEnvelope)
            let shouldBranch = plan.condition == "on_failure"
                ? (!primaryResult.handled || !primaryResult.succeeded)
                : (primaryResult.handled && primaryResult.succeeded)

            guard shouldBranch else { return primaryResult }

            var branchPayload = plan.branch.payload
            var branchInput = plan.branch.input
            if let value = primaryResult.value {
                let context = ["last.value": value, "primary.value": value]
                branchPayload = self.resolveTemplates(branchPayload, context: context)
                branchInput = self.resolveTemplates(branchInput, context: context)
            }

            let branchEnvelope = NativeActionEnvelope(
                action: plan.branch.action,
                input: branchInput,
                capabilityId: plan.branch.capabilityId,
                payload: branchPayload
            )
            let branchResult = await self.execute(branchEnvelope)
            return Result(
                handled: true,
                succeeded: branchResult.succeeded,
                reply: branchResult.reply,
                value: branchResult.value
            )
        }

        register("sequence.execute") { envelope in
            guard let raw = envelope.payload?["steps"],
                  let data = raw.data(using: .utf8),
                  let steps = try? JSONDecoder().decode([NativeSequenceStep].self, from: data),
                  !steps.isEmpty else {
                return Result(handled: true, succeeded: false, reply: "No he podido interpretar la secuencia.", value: nil)
            }

            var values: [String] = []
            var context: [String: String] = [:]
            for (index, step) in steps.enumerated() {
                let resolvedInput = self.resolveTemplates(step.input, context: context)
                let resolvedPayload = self.resolveTemplates(step.payload, context: context)
                let child = NativeActionEnvelope(
                    action: step.action,
                    input: resolvedInput,
                    capabilityId: step.capabilityId,
                    payload: resolvedPayload
                )
                let result = await self.execute(child)
                if !result.handled || !result.succeeded {
                    return Result(
                        handled: true,
                        succeeded: false,
                        reply: result.reply ?? "Una de las acciones no se ha podido completar.",
                        value: result.value
                    )
                }
                if let value = result.value {
                    values.append(value)
                    context["last.value"] = value
                    context["step.\(index).value"] = value
                    context["capability.\(step.capabilityId).value"] = value
                    if step.capabilityId == "location.current" {
                        context["location.current.value"] = value
                        if let shareText = self.locationShareText(from: value) {
                            context["location.current.share"] = shareText
                            context["last.share"] = shareText
                        }
                    }
                }
            }

            let value = values.isEmpty ? nil : self.jsonArray(values)
            return Result(handled: true, succeeded: true, reply: "Hecho.", value: value)
        }

        register("recording.start") { _ in await self.startRecording() }
        register("recording.stop") { _ in self.stopRecording() }

        register("recording_control") { envelope in
            if envelope.payload?["command"] == "stop" { return self.stopRecording() }
            if envelope.payload?["command"] == "start" { return await self.startRecording() }
            let input = self.normalize(envelope.input ?? "")
            if ["deja de grabar", "para de grabar", "deten la grabacion", "termina de grabar", "finaliza la grabacion"].contains(where: input.contains) {
                return self.stopRecording()
            }
            return await self.startRecording()
        }

        register("permissions.bootstrap") { _ in await self.bootstrapPermissions() }

        register("get_current_location") { _ in
            do {
                let location = try await NativeDeviceActions.shared.currentLocation()
                let value = "{\"latitude\":\(location.coordinate.latitude),\"longitude\":\(location.coordinate.longitude),\"accuracy\":\(location.horizontalAccuracy)}"
                return Result(handled: true, succeeded: true, reply: nil, value: value)
            } catch {
                return Result(handled: true, succeeded: false, reply: error.localizedDescription, value: nil)
            }
        }

        register("app.open") { envelope in
            let app = envelope.payload?["app"] ?? envelope.input ?? ""
            let outcome = await NativeDeviceActions.shared.openApp(named: app)
            switch outcome {
            case .direct:
                return Result(handled: true, succeeded: true, reply: "Abierto.", value: "direct")
            case .webFallback:
                return Result(handled: true, succeeded: true, reply: "Abierto.", value: "web_fallback")
            case .failed:
                return Result(handled: true, succeeded: false, reply: NativeDeviceActionError.appUnavailable.localizedDescription, value: nil)
            }
        }

        register("phone.call") { envelope in
            let target = envelope.payload?["target"] ?? envelope.input ?? ""
            let opened = await NativeDeviceActions.shared.call(target: target)
            return Result(
                handled: true,
                succeeded: opened,
                reply: opened ? "Llamada preparada." : NativeDeviceActionError.callUnavailable.localizedDescription,
                value: nil
            )
        }

        register("messages.sms") { envelope in
            let target = envelope.payload?["target"] ?? ""
            let message = envelope.payload?["message"] ?? envelope.input
            let opened = await NativeDeviceActions.shared.composeSMS(target: target, message: message)
            return Result(
                handled: true,
                succeeded: opened,
                reply: opened ? "Mensaje preparado." : NativeDeviceActionError.smsUnavailable.localizedDescription,
                value: nil
            )
        }

        register("media.play") { envelope in
            let query = envelope.payload?["query"] ?? envelope.input ?? ""
            let outcome = await NativeDeviceActions.shared.playMedia(query: query)
            switch outcome {
            case .spotify:
                return Result(handled: true, succeeded: true, reply: "Spotify abierto.", value: "spotify")
            case .youtube:
                return Result(handled: true, succeeded: true, reply: "YouTube abierto.", value: "youtube")
            case .web:
                return Result(handled: true, succeeded: true, reply: "Contenido abierto.", value: "web")
            case .failed:
                return Result(handled: true, succeeded: false, reply: NativeDeviceActionError.mediaUnavailable.localizedDescription, value: nil)
            }
        }

        register("apps.learned") { _ in
            let learned = NativeAppRegistry.shared.learnedApps()
            let known = NativeAppRegistry.shared.knownIntegrationNames()
            let value = "{\"learned\":\(self.jsonArray(learned)),\"known\":\(self.jsonArray(known))}"
            return Result(handled: true, succeeded: true, reply: nil, value: value)
        }

        register("capabilities.learned") { _ in
            let proven = NativeCapabilityLedger.shared.provenActions()
            let ledger = NativeCapabilityLedger.shared.snapshotJSON()
            var groups: [String: [String]] = [
                "maps.navigation": ["navigation.apple_maps", "navigation.google_maps", "navigation.waze"],
                "whatsapp.handoff": ["whatsapp.native", "whatsapp.web"],
                "media.play": ["media.spotify", "media.youtube", "media.web"],
                "phone.call": ["phone.tel"],
                "messages.compose": ["messages.sms"],
            ]
            for (key, routes) in NativeAppRegistry.shared.adaptiveExecutorGroups() {
                groups[key] = routes
            }
            let preferred = NativeCapabilityLedger.shared.preferredExecutorsSnapshot(groups)
            let value = "{\"proven\":\(self.jsonArray(proven)),\"preferred\":\(self.jsonObject(preferred)),\"ledger\":\(ledger)}"
            return Result(handled: true, succeeded: true, reply: nil, value: value)
        }

        register("open_whatsapp_target") { envelope in
            let target = envelope.payload?["target"]
            let message = envelope.payload?["message"]
            let opened = await NativeDeviceActions.shared.openWhatsApp(target: target, message: message)
            let reply: String
            if opened {
                if let target, !target.isEmpty {
                    reply = message?.isEmpty == false ? "Chat de WhatsApp preparado." : "Chat de WhatsApp abierto."
                } else { reply = "WhatsApp abierto." }
            } else { reply = NativeDeviceActionError.whatsappUnavailable.localizedDescription }
            return Result(handled: true, succeeded: opened, reply: reply, value: nil)
        }

        register("open_url") { envelope in
            guard let rawURL = envelope.payload?["url"] ?? envelope.input, !rawURL.isEmpty else {
                return Result(handled: true, succeeded: false, reply: "Falta el enlace que debo abrir.", value: nil)
            }
            let opened = await NativeDeviceActions.shared.openURLString(rawURL)
            return Result(handled: true, succeeded: opened, reply: opened ? "Abierto." : NativeDeviceActionError.urlUnavailable.localizedDescription, value: nil)
        }

        register("navigation.start") { envelope in
            let destination = envelope.payload?["destination"] ?? envelope.input ?? ""
            let personalPlace = envelope.payload?["personalPlace"]
            let opened = await NativeDeviceActions.shared.startNavigation(to: destination, personalPlace: personalPlace)
            return Result(handled: true, succeeded: opened, reply: opened ? "Navegación iniciada." : NativeDeviceActionError.navigationUnavailable.localizedDescription, value: nil)
        }

        register("schedule_native_notification") { envelope in
            let title = envelope.payload?["title"] ?? "ZYRON"
            let body = envelope.payload?["body"] ?? envelope.input ?? ""
            let seconds = TimeInterval(envelope.payload?["afterSeconds"] ?? "1") ?? 1
            do {
                let identifier = try await NativeNotificationActions.shared.schedule(title: title, body: body, after: seconds)
                return Result(handled: true, succeeded: true, reply: "Aviso programado.", value: identifier)
            } catch {
                return Result(handled: true, succeeded: false, reply: error.localizedDescription, value: nil)
            }
        }
    }

    private func startRecording() async -> Result {
        do {
            let url = try await NativePermissionGate.shared.run(requiring: .microphone) { try await NativeRecordingController.shared.start() }
            return Result(handled: true, succeeded: true, reply: "Grabando.", value: url.path)
        } catch { return Result(handled: true, succeeded: false, reply: error.localizedDescription, value: nil) }
    }

    private func stopRecording() -> Result {
        do {
            let url = try NativeRecordingController.shared.stop()
            return Result(handled: true, succeeded: true, reply: url == nil ? "No estaba grabando." : "Grabación guardada.", value: url?.path)
        } catch { return Result(handled: true, succeeded: false, reply: error.localizedDescription, value: nil) }
    }

    private func bootstrapPermissions() async -> Result {
        let snapshot = await PermissionBootstrapper.shared.requestInitialPermissions()
        if snapshot.denied.isEmpty && snapshot.notDetermined.isEmpty {
            return Result(handled: true, succeeded: true, reply: "Permisos configurados.", value: nil)
        }
        if !snapshot.denied.isEmpty {
            return Result(handled: true, succeeded: false, reply: "He configurado los permisos disponibles. Algunos siguen bloqueados en Ajustes.", value: nil)
        }
        return Result(handled: true, succeeded: true, reply: "He iniciado la configuración de permisos.", value: nil)
    }

    private func resolveTemplates(_ payload: [String: String], context: [String: String]) -> [String: String] {
        payload.mapValues { resolveTemplates($0, context: context) }
    }

    private func resolveTemplates(_ value: String, context: [String: String]) -> String {
        var resolved = value
        for (key, replacement) in context {
            resolved = resolved.replacingOccurrences(of: "{{\(key)}}", with: replacement)
        }
        return resolved
    }

    private func locationShareText(from value: String) -> String? {
        guard let data = value.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let latitude = object["latitude"] as? Double,
              let longitude = object["longitude"] as? Double else { return nil }
        return "Mi ubicación: https://maps.apple.com/?ll=\(latitude),\(longitude)"
    }

    private func jsonArray(_ values: [String]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: values), let json = String(data: data, encoding: .utf8) else { return "[]" }
        return json
    }

    private func jsonObject(_ value: [String: String]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value), let json = String(data: data, encoding: .utf8) else { return "{}" }
        return json
    }

    private func normalize(_ value: String) -> String {
        value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "es_ES")).lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

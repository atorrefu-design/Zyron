import Foundation
import Combine

struct JournalEvent: Codable {
    let id: String
    let channel: String
    let role: String
    let content: String
    let occurredAt: String
}

@MainActor
final class ConversationJournal: ObservableObject {
    static let shared = ConversationJournal()
    @Published private(set) var status = "Historial preparado."
    @Published private(set) var pendingCount = 0
    private var pending: [JournalEvent] = []
    private(set) var recent: [JournalEvent] = []
    private var syncing = false
    private let fileURL: URL

    private init() {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ZYRON", isDirectory: true)
        fileURL = directory.appendingPathComponent("pending-conversations.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var excluded = directory
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            try excluded.setResourceValues(values)
            if FileManager.default.fileExists(atPath: fileURL.path) {
                pending = try JSONDecoder().decode([JournalEvent].self, from: Data(contentsOf: fileURL))
            }
            pendingCount = pending.count
            status = pending.isEmpty ? "Historial preparado." : "Hay \(pending.count) mensajes pendientes."
        } catch { status = "No se ha podido recuperar el historial local pendiente." }
    }

    func record(role: String, text: String, itemID: String?) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        let event = JournalEvent(id: "ios:\(itemID ?? UUID().uuidString):\(role)", channel: "ios", role: role,
                                 content: String(clean.prefix(20000)), occurredAt: ISO8601DateFormatter().string(from: Date()))
        guard !pending.contains(where: { $0.id == event.id }), !recent.contains(where: { $0.id == event.id }) else { return }
        pending.append(event)
        recent.append(event); recent = Array(recent.suffix(16))
        persist()
        Task { await flush() }
    }

    private func persist() {
        pendingCount = pending.count
        do {
            let data = try JSONEncoder().encode(pending)
            try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUnlessOpen])
            status = pending.isEmpty ? "Historial sincronizado." : "\(pending.count) mensajes pendientes de sincronizar."
        } catch { status = "No se ha podido conservar el historial en el iPhone. Mantenga la app abierta y reintente." }
    }

    func flush() async {
        guard !syncing, NativeAPIClient.shared.hasOwnerSession else { return }
        syncing = true
        defer { syncing = false }
        do {
            while !pending.isEmpty {
                let batch = Array(pending.prefix(25))
                try await NativeAPIClient.shared.saveConversationEvents(batch)
                let ids = Set(batch.map(\.id))
                pending.removeAll { ids.contains($0.id) }
                persist()
            }
        } catch { status = "Historial pendiente de conexión: \(pending.count) mensajes. Reintente la sincronización." }
    }
}

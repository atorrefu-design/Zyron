import Foundation
import Security

enum KeychainStore {
    private static let service = "com.zyron.native"
    private static let ownerSessionAccount = "owner-session"
    private static let picovoiceAccessKeyAccount = "picovoice-access-key"

    static func saveOwnerSession(_ token: String) throws {
        try save(token, account: ownerSessionAccount)
    }

    static func ownerSession() -> String? {
        read(account: ownerSessionAccount)
    }

    static func clearOwnerSession() {
        clear(account: ownerSessionAccount)
    }

    static func savePicovoiceAccessKey(_ accessKey: String) throws {
        try save(accessKey, account: picovoiceAccessKeyAccount)
    }

    static func picovoiceAccessKey() -> String? {
        read(account: picovoiceAccessKeyAccount)
    }

    static func clearPicovoiceAccessKey() {
        clear(account: picovoiceAccessKeyAccount)
    }

    private static func save(_ value: String, account: String) throws {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        SecItemDelete(query as CFDictionary)

        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(insert as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }

    private static func read(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let token = String(data: data, encoding: .utf8),
              !token.isEmpty else {
            return nil
        }
        return token
    }

    private static func clear(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

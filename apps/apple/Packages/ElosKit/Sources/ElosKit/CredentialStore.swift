import Foundation
import Security

/// Reads and writes the gateway credentials. The access key is a bearer token for the
/// whole installation, so it never goes to UserDefaults and is never logged.
public protocol CredentialStore: Sendable {
  func load() throws -> GatewayCredentials?
  func save(_ credentials: GatewayCredentials) throws
  func clear() throws
}

public struct KeychainCredentialStore: CredentialStore {
  private let service: String
  private let account: String

  public init(service: String = "com.elos.agent.gateway", account: String = "default") {
    self.service = service
    self.account = account
  }

  private var baseQuery: [String: Any] {
    [
      kSecClass as String: kSecClassInternetPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account
    ]
  }

  public func load() throws -> GatewayCredentials? {
    var query = baseQuery
    query[kSecReturnData as String] = true
    query[kSecReturnAttributes as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw CredentialStoreError.keychain(status) }

    guard let attributes = item as? [String: Any],
      let data = attributes[kSecValueData as String] as? Data,
      let accessKey = String(data: data, encoding: .utf8),
      let label = attributes[kSecAttrLabel as String] as? String,
      let serverURL = URL(string: label)
    else { throw CredentialStoreError.malformedServerURL }

    return GatewayCredentials(serverURL: serverURL, accessKey: accessKey)
  }

  public func save(_ credentials: GatewayCredentials) throws {
    try clear()
    var query = baseQuery
    query[kSecAttrLabel as String] = credentials.serverURL.absoluteString
    query[kSecValueData as String] = Data(credentials.accessKey.utf8)
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { throw CredentialStoreError.keychain(status) }
  }

  public func clear() throws {
    let status = SecItemDelete(baseQuery as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw CredentialStoreError.keychain(status)
    }
  }
}

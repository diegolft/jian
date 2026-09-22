import Foundation

/// Where the gateway lives and the administrator token used to reach it. The gateway has one
/// API credential and it opens the whole installation, so this device holds everything.
public struct GatewayCredentials: Sendable, Equatable {
  public let serverURL: URL
  public let adminToken: String

  public init(serverURL: URL, adminToken: String) {
    self.serverURL = serverURL
    self.adminToken = adminToken
  }
}

public enum CredentialStoreError: Error, Equatable {
  case malformedServerURL
  /// The Keychain refused the operation; the OSStatus is kept for diagnosis.
  case keychain(OSStatus)
}

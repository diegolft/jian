import Foundation

/// Where the gateway lives and the scoped access key used to reach it.
public struct GatewayCredentials: Sendable, Equatable {
  public let serverURL: URL
  public let accessKey: String

  public init(serverURL: URL, accessKey: String) {
    self.serverURL = serverURL
    self.accessKey = accessKey
  }
}

public enum CredentialStoreError: Error, Equatable {
  case malformedServerURL
  /// The Keychain refused the operation; the OSStatus is kept for diagnosis.
  case keychain(OSStatus)
}

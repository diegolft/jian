import JianKit
import Foundation

/// Holds the signed-in gateway for the whole app. Views never see the token.
@Observable
@MainActor
final class GatewaySession {
  enum State: Equatable {
    case signedOut
    case working
    case signedIn([Profile])
  }

  private(set) var state: State = .signedOut
  private(set) var failure: String?

  private let store: any CredentialStore
  private var client: JianClient?

  init(store: any CredentialStore = KeychainCredentialStore()) {
    self.store = store
  }

  /// Reuses a token stored on a previous launch, so the app opens signed in.
  func restore() async {
    guard case .signedOut = state, let credentials = try? store.load() else { return }
    await connect(with: credentials)
  }

  func signIn(serverURL: String, adminToken: String) async {
    guard let url = URL(string: serverURL.trimmingCharacters(in: .whitespaces)), url.scheme != nil else {
      failure = "Enter the full gateway URL, including https://"
      return
    }
    await connect(with: GatewayCredentials(serverURL: url, adminToken: adminToken), persist: true)
  }

  func signOut() {
    try? store.clear()
    client = nil
    failure = nil
    state = .signedOut
  }

  func refresh() async {
    guard let client else { return }
    await load(using: client)
  }

  private func connect(with credentials: GatewayCredentials, persist: Bool = false) async {
    let client = JianClient(credentials: credentials)
    state = .working
    await load(using: client)
    guard case .signedIn = state else { return }
    self.client = client
    if persist { try? store.save(credentials) }
  }

  private func load(using client: JianClient) async {
    do {
      state = .signedIn(try await client.listProfiles())
      failure = nil
    } catch {
      // A rejected token must not leave a stale session behind.
      if case JianError.unauthorized = error { self.client = nil }
      failure = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
      state = .signedOut
    }
  }
}

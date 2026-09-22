import SwiftUI

struct RootView: View {
  @Environment(GatewaySession.self) private var session

  var body: some View {
    NavigationStack {
      switch session.state {
      case .signedOut:
        SignInView()
      case .working:
        ProgressView("Reaching the gateway…")
      case let .signedIn(profiles):
        ProfileListView(profiles: profiles)
      }
    }
  }
}

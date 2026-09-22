import SwiftUI

@main
struct ElosAgentApp: App {
  @State private var session = GatewaySession()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(session)
        .task { await session.restore() }
    }
    #if os(macOS)
      .defaultSize(width: 720, height: 520)
    #endif
  }
}

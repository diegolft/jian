import SwiftUI

struct SignInView: View {
  @Environment(GatewaySession.self) private var session
  // The Gateway, not the web panel's dev server. On a device, use the host's LAN address.
  @State private var serverURL = "http://127.0.0.1:4310"
  @State private var accessKey = ""

  var body: some View {
    Form {
      Section("Gateway") {
        TextField("Server URL", text: $serverURL)
          #if os(iOS)
            .textInputAutocapitalization(.never)
            .keyboardType(.URL)
          #endif
          .autocorrectionDisabled()
        SecureField("Access key", text: $accessKey)
      }

      if let failure = session.failure {
        Section { Text(failure).foregroundStyle(.red) }
      }

      Section {
        Button("Connect") {
          Task { await session.signIn(serverURL: serverURL, accessKey: accessKey) }
        }
        .disabled(accessKey.isEmpty || serverURL.isEmpty)
      }
    }
    .formStyle(.grouped)
    .navigationTitle("Jian")
  }
}

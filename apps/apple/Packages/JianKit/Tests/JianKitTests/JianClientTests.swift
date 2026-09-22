import Foundation
import HTTPTypes
import Testing

@testable import JianKit

private let credentials = GatewayCredentials(
  serverURL: URL(string: "https://gateway.example")!,
  adminToken: "jian_test_admin_token"
)

@Test func listProfilesMapsTheGeneratedPayload() async throws {
  let recorder = RequestRecorder()
  let client = JianClient(
    credentials: credentials,
    transport: StubTransport(
      respond: { _ in jsonResponse(status: 200, sampleProfileJSON) },
      recorder: recorder
    )
  )

  let profiles = try await client.listProfiles()

  #expect(profiles.count == 1)
  #expect(profiles[0].name == "Atlas")
  #expect(profiles[0].role == "assistant")
  #expect(profiles[0].version == 3)
}

@Test func everyRequestCarriesTheAdministratorToken() async throws {
  let recorder = RequestRecorder()
  let client = JianClient(
    credentials: credentials,
    transport: StubTransport(
      respond: { _ in jsonResponse(status: 200, sampleProfileJSON) },
      recorder: recorder
    )
  )

  _ = try await client.listProfiles()

  let sent = await recorder.requests
  #expect(sent.first?.headerFields[.authorization] == "Bearer jian_test_admin_token")
}

@Test func rejectedTokenSurfacesAsUnauthorized() async throws {
  let recorder = RequestRecorder()
  let client = JianClient(
    credentials: credentials,
    transport: StubTransport(
      respond: { _ in jsonResponse(status: 401, #"{"error":"Unauthorized"}"#) },
      recorder: recorder
    )
  )

  await #expect(throws: JianError.unauthorized) { try await client.listProfiles() }
}

@Test func gatewayErrorKeepsStatusAndMessage() async throws {
  let recorder = RequestRecorder()
  let client = JianClient(
    credentials: credentials,
    transport: StubTransport(
      respond: { _ in jsonResponse(status: 503, #"{"error":"database unavailable"}"#) },
      recorder: recorder
    )
  )

  await #expect(throws: JianError.gateway(status: 503, message: "database unavailable")) {
    try await client.listProfiles()
  }
}

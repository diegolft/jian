import Foundation
import HTTPTypes
import Testing

@testable import ElosKit

private let credentials = GatewayCredentials(
  serverURL: URL(string: "https://gateway.example")!,
  accessKey: "elos_test_key"
)

@Test func listProfilesMapsTheGeneratedPayload() async throws {
  let recorder = RequestRecorder()
  let client = ElosClient(
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

@Test func everyRequestCarriesTheAccessKey() async throws {
  let recorder = RequestRecorder()
  let client = ElosClient(
    credentials: credentials,
    transport: StubTransport(
      respond: { _ in jsonResponse(status: 200, sampleProfileJSON) },
      recorder: recorder
    )
  )

  _ = try await client.listProfiles()

  let sent = await recorder.requests
  #expect(sent.first?.headerFields[.authorization] == "Bearer elos_test_key")
}

@Test func revokedKeySurfacesAsUnauthorized() async throws {
  let recorder = RequestRecorder()
  let client = ElosClient(
    credentials: credentials,
    transport: StubTransport(
      respond: { _ in jsonResponse(status: 401, #"{"error":"revoked"}"#) },
      recorder: recorder
    )
  )

  await #expect(throws: ElosError.unauthorized) { try await client.listProfiles() }
}

@Test func gatewayErrorKeepsStatusAndMessage() async throws {
  let recorder = RequestRecorder()
  let client = ElosClient(
    credentials: credentials,
    transport: StubTransport(
      respond: { _ in jsonResponse(status: 503, #"{"error":"database unavailable"}"#) },
      recorder: recorder
    )
  )

  await #expect(throws: ElosError.gateway(status: 503, message: "database unavailable")) {
    try await client.listProfiles()
  }
}

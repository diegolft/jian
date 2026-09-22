import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Answers requests from memory so the tests never touch the network or a real gateway.
struct StubTransport: ClientTransport {
  let respond: @Sendable (HTTPRequest) -> (HTTPResponse, HTTPBody?)
  let recorder: RequestRecorder

  func send(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID: String
  ) async throws -> (HTTPResponse, HTTPBody?) {
    await recorder.record(request)
    return respond(request)
  }
}

actor RequestRecorder {
  private(set) var requests: [HTTPRequest] = []
  func record(_ request: HTTPRequest) { requests.append(request) }
}

func jsonResponse(status: Int, _ json: String) -> (HTTPResponse, HTTPBody?) {
  var response = HTTPResponse(status: .init(code: status))
  response.headerFields[.contentType] = "application/json"
  return (response, HTTPBody(json))
}

let sampleProfileJSON = """
[{
  "id": "6f8d2f0c-1f4a-4a5e-9f2b-1c3d4e5f6a7b",
  "name": "Atlas",
  "instructions": "Be useful.",
  "model": { "provider": "anthropic", "modelId": "claude-opus-5" },
  "identity": { "role": "assistant", "tone": "direct", "goals": [], "boundaries": [] },
  "contextPolicy": {
    "inputTokens": 100, "outputTokens": 100, "memoryTokens": 100, "historyTokens": 100,
    "toolResultTokens": 100, "maxSteps": 4, "maxRunTokens": 1000
  },
  "skills": [],
  "mcpServers": [],
  "allowSelfManagement": false,
  "version": 3,
  "createdAt": "2026-09-21T10:00:00.000Z",
  "updatedAt": "2026-09-21T12:00:00.000Z"
}]
"""

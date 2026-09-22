import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Attaches the administrator token to every outbound request.
struct BearerAuthenticationMiddleware: ClientMiddleware {
  let adminToken: String

  func intercept(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID: String,
    next: (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    var request = request
    request.headerFields[.authorization] = "Bearer \(adminToken)"
    return try await next(request, body, baseURL)
  }
}

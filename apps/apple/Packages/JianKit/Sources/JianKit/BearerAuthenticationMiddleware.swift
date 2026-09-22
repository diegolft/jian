import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Attaches the scoped access key to every outbound request.
struct BearerAuthenticationMiddleware: ClientMiddleware {
  let accessKey: String

  func intercept(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID: String,
    next: (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    var request = request
    request.headerFields[.authorization] = "Bearer \(accessKey)"
    return try await next(request, body, baseURL)
  }
}

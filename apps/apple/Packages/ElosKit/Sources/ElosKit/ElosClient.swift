import ElosAPI
import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

/// Talks to one Elos gateway installation with one scoped access key.
public struct ElosClient: Sendable {
  private let generated: ElosAPI.Client

  public init(
    credentials: GatewayCredentials,
    transport: any ClientTransport = URLSessionTransport()
  ) {
    generated = ElosAPI.Client(
      serverURL: credentials.serverURL,
      configuration: Configuration(dateTranscoder: GatewayDateTranscoder()),
      transport: transport,
      middlewares: [BearerAuthenticationMiddleware(accessKey: credentials.accessKey)]
    )
  }

  public func listProfiles() async throws -> [Profile] {
    let output = try await generated.listProfiles()
    guard case let .ok(ok) = output else { throw Self.failure(from: output) }
    return try ok.body.json.map { item in
      Profile(
        id: item.id,
        name: item.name,
        role: item.identity.role,
        version: item.version,
        updatedAt: item.updatedAt
      )
    }
  }

  private static let unexplained = "The gateway did not explain the failure."

  /// Every operation shares one error envelope, so only the status tells these apart.
  /// Decoding the envelope may itself fail, and a failure to explain a failure is not
  /// worth raising over the original status.
  private static func failure(from output: Operations.ListProfiles.Output) -> ElosError {
    switch output {
    case .ok:
      .gateway(status: 200, message: "The gateway returned success where none was expected.")
    case .unauthorized:
      .unauthorized
    case .forbidden:
      .forbidden
    case .tooManyRequests:
      .rateLimited
    case let .badRequest(response):
      .gateway(status: 400, message: (try? response.body.json.error) ?? unexplained)
    case let .notFound(response):
      .gateway(status: 404, message: (try? response.body.json.error) ?? unexplained)
    case let .conflict(response):
      .gateway(status: 409, message: (try? response.body.json.error) ?? unexplained)
    case let .contentTooLarge(response):
      .gateway(status: 413, message: (try? response.body.json.error) ?? unexplained)
    case let .internalServerError(response):
      .gateway(status: 500, message: (try? response.body.json.error) ?? unexplained)
    case let .serviceUnavailable(response):
      .gateway(status: 503, message: (try? response.body.json.error) ?? unexplained)
    case let .undocumented(statusCode, _):
      .gateway(status: statusCode, message: unexplained)
    }
  }
}

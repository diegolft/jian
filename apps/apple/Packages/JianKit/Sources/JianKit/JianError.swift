import Foundation

public enum JianError: Error, Equatable {
  /// The token is missing or no longer the host's; the caller should sign in again.
  case unauthorized
  /// The gateway refused this operation for a reason of its own, such as a channel binding.
  case forbidden
  case rateLimited
  case gateway(status: Int, message: String)
}

extension JianError: LocalizedError {
  public var errorDescription: String? {
    switch self {
    case .unauthorized: "The administrator token was rejected. Sign in again."
    case .forbidden: "The gateway refused that operation."
    case .rateLimited: "The gateway is rate limiting this client. Try again shortly."
    case let .gateway(status, message): "The gateway returned \(status): \(message)"
    }
  }
}

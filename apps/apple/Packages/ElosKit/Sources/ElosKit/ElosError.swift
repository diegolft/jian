import Foundation

public enum ElosError: Error, Equatable {
  /// The access key is missing, expired or revoked; the caller should sign in again.
  case unauthorized
  /// The key is valid but lacks the scope for this operation.
  case forbidden
  case rateLimited
  case gateway(status: Int, message: String)
}

extension ElosError: LocalizedError {
  public var errorDescription: String? {
    switch self {
    case .unauthorized: "The access key was rejected. Sign in again."
    case .forbidden: "This access key does not have permission for that."
    case .rateLimited: "The gateway is rate limiting this key. Try again shortly."
    case let .gateway(status, message): "The gateway returned \(status): \(message)"
    }
  }
}

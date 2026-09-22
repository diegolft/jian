import Foundation

/// The parts of a gateway profile this app shows. The generated types inline a full
/// profile shape into every operation, so callers get this stable model instead.
public struct Profile: Identifiable, Sendable, Hashable {
  public let id: String
  public let name: String
  public let role: String
  public let version: Int
  public let updatedAt: Date

  public init(id: String, name: String, role: String, version: Int, updatedAt: Date) {
    self.id = id
    self.name = name
    self.role = role
    self.version = version
    self.updatedAt = updatedAt
  }
}

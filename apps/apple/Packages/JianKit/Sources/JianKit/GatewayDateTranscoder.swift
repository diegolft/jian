import Foundation
import OpenAPIRuntime

/// The gateway serialises timestamps with milliseconds (`2026-09-21T12:00:00.000Z`),
/// which the runtime's default ISO8601 decoder rejects. Encode with fractional seconds
/// and accept either form on the way in.
struct GatewayDateTranscoder: DateTranscoder {
  private let fractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
  private let plain = Date.ISO8601FormatStyle()

  func encode(_ date: Date) throws -> String { fractional.format(date) }

  func decode(_ dateString: String) throws -> Date {
    if let date = try? fractional.parse(dateString) { return date }
    if let date = try? plain.parse(dateString) { return date }
    throw DecodingError.dataCorrupted(
      .init(codingPath: [], debugDescription: "Expected an ISO8601 timestamp, got \(dateString).")
    )
  }
}

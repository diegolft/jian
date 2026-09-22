// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "JianKit",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "JianKit", targets: ["JianKit"])
  ],
  dependencies: [
    .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.10.0"),
    .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.0"),
    .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.1.0"),
  ],
  targets: [
    // openapi.json here is written by `pnpm contracts:generate`; the plugin regenerates
    // the Swift types on every build, so nothing generated is committed.
    .target(
      name: "JianAPI",
      dependencies: [.product(name: "OpenAPIRuntime", package: "swift-openapi-runtime")],
      // Nothing in this target is hand-written, so its warnings are not actionable here.
      swiftSettings: [.unsafeFlags(["-suppress-warnings"])],
      plugins: [.plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")]
    ),
    .target(
      name: "JianKit",
      dependencies: [
        "JianAPI",
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
        .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
      ]
    ),
    .testTarget(name: "JianKitTests", dependencies: ["JianKit"]),
  ]
)

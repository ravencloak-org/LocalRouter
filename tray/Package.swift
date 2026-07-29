// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "LocalRouterTray",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(name: "LocalRouterTray", path: "Sources/LocalRouterTray")
    ]
)

// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SpaceNotesMac",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .library(name: "SpaceNotesCore", targets: ["SpaceNotesCore"]),
        .executable(name: "SpaceNotes", targets: ["SpaceNotesMac"])
    ],
    targets: [
        .target(
            name: "SpaceNotesCore"
        ),
        .executableTarget(
            name: "SpaceNotesMac",
            dependencies: ["SpaceNotesCore"]
        ),
        .testTarget(
            name: "SpaceNotesCoreTests",
            dependencies: ["SpaceNotesCore"]
        )
    ],
    swiftLanguageModes: [.v5]
)

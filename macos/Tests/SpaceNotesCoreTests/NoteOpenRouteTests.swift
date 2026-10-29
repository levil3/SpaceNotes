import Foundation
import XCTest
@testable import SpaceNotesCore

final class NoteOpenRouteTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent(
                "spacenotes-open-route-\(UUID().uuidString)",
                isDirectory: true
            )
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: true
        )
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    func testNestedNoteStaysInCurrentVault() throws {
        let vault = root.appendingPathComponent("vault", isDirectory: true)
        let folder = vault.appendingPathComponent("notes", isDirectory: true)
        try FileManager.default.createDirectory(
            at: folder,
            withIntermediateDirectories: true
        )
        let file = folder.appendingPathComponent("raft.md")
        try "# raft\n".write(to: file, atomically: true, encoding: .utf8)

        let destination = NoteOpenRoute.resolve(
            fileURL: file,
            currentVaultPath: vault.path
        )

        XCTAssertFalse(destination.needsVaultSwitch)
        XCTAssertEqual(destination.relativePath, "notes/raft.md")
        XCTAssertEqual(
            destination.vaultRoot.path,
            vault.resolvingSymlinksInPath().standardizedFileURL.path
        )
    }

    func testSiblingDirectoryWithSharedPrefixSwitchesVault() throws {
        let vault = root.appendingPathComponent("vault", isDirectory: true)
        let sibling = root.appendingPathComponent("vault-other", isDirectory: true)
        try FileManager.default.createDirectory(
            at: vault,
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: sibling,
            withIntermediateDirectories: true
        )
        let file = sibling.appendingPathComponent("draft.markdown")
        try "# draft\n".write(to: file, atomically: true, encoding: .utf8)

        let destination = NoteOpenRoute.resolve(
            fileURL: file,
            currentVaultPath: vault.path
        )

        XCTAssertTrue(destination.needsVaultSwitch)
        XCTAssertEqual(destination.relativePath, "draft.markdown")
        XCTAssertEqual(
            destination.vaultRoot.path,
            sibling.resolvingSymlinksInPath().standardizedFileURL.path
        )
    }

    func testFileWithoutVaultFallsBackToParentDirectory() throws {
        let folder = root.appendingPathComponent("loose", isDirectory: true)
        try FileManager.default.createDirectory(
            at: folder,
            withIntermediateDirectories: true
        )
        let file = folder.appendingPathComponent("loose.md")
        try "# loose\n".write(to: file, atomically: true, encoding: .utf8)

        let destination = NoteOpenRoute.resolve(
            fileURL: file,
            currentVaultPath: nil
        )

        XCTAssertTrue(destination.needsVaultSwitch)
        XCTAssertEqual(destination.relativePath, "loose.md")
        XCTAssertEqual(
            destination.vaultRoot.path,
            folder.resolvingSymlinksInPath().standardizedFileURL.path
        )
    }

    func testMarkdownExtensionsAreMatchedCaseInsensitively() {
        XCTAssertTrue(
            NoteOpenRoute.isMarkdownFile(URL(fileURLWithPath: "/tmp/Note.MD"))
        )
        XCTAssertTrue(
            NoteOpenRoute.isMarkdownFile(
                URL(fileURLWithPath: "/tmp/Note.markdown")
            )
        )
        XCTAssertFalse(
            NoteOpenRoute.isMarkdownFile(URL(fileURLWithPath: "/tmp/Note.txt"))
        )
    }
}

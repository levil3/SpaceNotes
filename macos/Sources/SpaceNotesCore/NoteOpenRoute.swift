import Foundation

/// Resolves a file URL delivered by LaunchServices into a vault-relative note.
public enum NoteOpenRoute {
    public static let markdownExtensions: Set<String> = [
        "md",
        "markdown",
        "mdown",
        "mkd",
        "mdwn",
        "mdtext"
    ]

    public struct Destination: Equatable, Sendable {
        public let vaultRoot: URL
        public let relativePath: String
        public let needsVaultSwitch: Bool
    }

    public static func isMarkdownFile(_ url: URL) -> Bool {
        markdownExtensions.contains(url.pathExtension.lowercased())
    }

    /// Keeps the current vault when the file lives inside it; otherwise the
    /// file's parent directory becomes the vault that has to be opened first.
    public static func resolve(
        fileURL: URL,
        currentVaultPath: String?
    ) -> Destination {
        let file = normalized(fileURL)
        if let currentVaultPath, !currentVaultPath.isEmpty {
            let vault = normalized(
                URL(fileURLWithPath: currentVaultPath, isDirectory: true)
            )
            if let relative = relativePath(of: file, inside: vault) {
                return Destination(
                    vaultRoot: vault,
                    relativePath: relative,
                    needsVaultSwitch: false
                )
            }
        }
        let parent = file.deletingLastPathComponent()
        return Destination(
            vaultRoot: parent,
            relativePath: file.lastPathComponent,
            needsVaultSwitch: true
        )
    }

    private static func relativePath(of file: URL, inside vault: URL) -> String? {
        let root = vault.path.hasSuffix("/") ? vault.path : vault.path + "/"
        guard
            file.path.count > root.count,
            file.path.lowercased().hasPrefix(root.lowercased())
        else {
            return nil
        }
        let start = file.path.index(file.path.startIndex, offsetBy: root.count)
        return String(file.path[start...])
    }

    private static func normalized(_ url: URL) -> URL {
        url.resolvingSymlinksInPath().standardizedFileURL
    }
}

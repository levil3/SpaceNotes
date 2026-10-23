import Foundation

public enum VaultPathError: LocalizedError {
    case invalidRelativePath
    case outsideVault

    public var errorDescription: String? {
        switch self {
        case .invalidRelativePath:
            return "文件路径无效。"
        case .outsideVault:
            return "文件路径超出当前笔记库。"
        }
    }
}

public enum VaultPathGuard {
    public static func resolve(
        relativePath: String,
        in vaultRoot: URL
    ) throws -> URL {
        let trimmed = relativePath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            !trimmed.isEmpty,
            !trimmed.contains("\0"),
            !trimmed.hasPrefix("/"),
            !trimmed.hasPrefix("~")
        else {
            throw VaultPathError.invalidRelativePath
        }

        let root = vaultRoot
            .resolvingSymlinksInPath()
            .standardizedFileURL
        let candidate = root
            .appendingPathComponent(trimmed)
            .standardizedFileURL
            .resolvingSymlinksInPath()
        let rootPrefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
        guard candidate.path.hasPrefix(rootPrefix) else {
            throw VaultPathError.outsideVault
        }
        return candidate
    }
}

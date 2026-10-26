import Foundation
import Darwin

public enum VaultPathError: LocalizedError {
    case invalidRelativePath
    case outsideVault
    case operationFailed(String)

    public var errorDescription: String? {
        switch self {
        case .invalidRelativePath:
            return "文件路径无效。"
        case .outsideVault:
            return "文件路径超出当前笔记库。"
        case let .operationFailed(message):
            return message
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
        let resolvedCandidate = candidate.resolvingSymlinksInPath()
        let rootPrefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
        guard resolvedCandidate.path.hasPrefix(rootPrefix) else {
            throw VaultPathError.outsideVault
        }
        return candidate
    }

    @discardableResult
    public static func moveToTrash(
        relativePath: String,
        in vaultRoot: URL,
        trashRoot: URL? = nil
    ) throws -> URL {
        _ = try resolve(relativePath: relativePath, in: vaultRoot)
        let components = relativePath
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: "/", omittingEmptySubsequences: false)
            .map(String.init)
        guard
            !components.isEmpty,
            components.allSatisfy({
                !$0.isEmpty && $0 != "." && $0 != ".."
            })
        else {
            throw VaultPathError.invalidRelativePath
        }

        let canonicalRoot = vaultRoot
            .resolvingSymlinksInPath()
            .standardizedFileURL
        let rootFD = Darwin.open(
            canonicalRoot.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard rootFD >= 0 else {
            throw posixError("无法打开笔记库目录。", code: errno)
        }

        var parentFD = rootFD
        for component in components.dropLast() {
            let nextFD = component.withCString {
                Darwin.openat(
                    parentFD,
                    $0,
                    O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
                )
            }
            guard nextFD >= 0 else {
                let errorCode = errno
                Darwin.close(parentFD)
                throw posixError("无法打开笔记所在目录。", code: errorCode)
            }
            Darwin.close(parentFD)
            parentFD = nextFD
        }
        defer { Darwin.close(parentFD) }

        let destinationRoot = try (
            trashRoot ?? defaultTrashRoot(for: canonicalRoot)
        )
            .resolvingSymlinksInPath()
            .standardizedFileURL
        try FileManager.default.createDirectory(
            at: destinationRoot,
            withIntermediateDirectories: true
        )
        let destinationFD = try openDirectoryExclusively(
            at: destinationRoot
        )
        defer { Darwin.close(destinationFD) }

        let fileName = components.last!
        let movedName = try moveExclusive(
            fileName: fileName,
            sourceDirectoryFD: parentFD,
            destinationDirectoryFD: destinationFD
        )
        return destinationRoot.appendingPathComponent(movedName)
    }

    static func defaultTrashRoot(for vaultRoot: URL) throws -> URL {
        let canonicalRoot = vaultRoot
            .resolvingSymlinksInPath()
            .standardizedFileURL
        var vaultStatus = stat()
        guard canonicalRoot.path.withCString({
            stat($0, &vaultStatus)
        }) == 0 else {
            throw posixError("无法读取笔记库所在卷。", code: errno)
        }
        var homeStatus = stat()
        let homePath = NSHomeDirectory()
        guard homePath.withCString({
            stat($0, &homeStatus)
        }) == 0 else {
            throw posixError("无法读取用户主目录所在卷。", code: errno)
        }

        if vaultStatus.st_dev == homeStatus.st_dev {
            return userTrashRoot() ?? URL(
                fileURLWithPath: homePath,
                isDirectory: true
            ).appendingPathComponent(".Trash", isDirectory: true)
        }

        let volumeRoot = volumeRoot(
            containing: canonicalRoot,
            device: vaultStatus.st_dev
        )
        return volumeRoot
            .appendingPathComponent(".Trashes", isDirectory: true)
            .appendingPathComponent(
                String(getuid()),
                isDirectory: true
            )
    }

    private static func userTrashRoot() -> URL? {
        FileManager.default.urls(
            for: .trashDirectory,
            in: .userDomainMask
        ).first?
            .resolvingSymlinksInPath()
            .standardizedFileURL
    }

    private static func volumeRoot(
        containing start: URL,
        device: dev_t
    ) -> URL {
        var current = start
        while current.path != "/" {
            let parent = current.deletingLastPathComponent()
                .standardizedFileURL
            var parentStatus = stat()
            guard parent.path.withCString({
                stat($0, &parentStatus)
            }) == 0, parentStatus.st_dev == device else {
                break
            }
            current = parent
        }
        return current
    }

    static func openDirectoryExclusively(at directory: URL) throws -> Int32 {
        let resolvedPath = directory.path.withCString {
            Darwin.realpath($0, nil)
        }
        guard let resolvedPath else {
            throw posixError("无法解析目标目录。", code: errno)
        }
        defer { Darwin.free(resolvedPath) }
        let components = String(cString: resolvedPath)
            .split(separator: "/", omittingEmptySubsequences: true)
        let flags = O_SEARCH | O_NOFOLLOW | O_CLOEXEC
        var currentFD = Darwin.open("/", flags)
        guard currentFD >= 0 else {
            throw posixError("无法打开文件系统根目录。", code: errno)
        }
        for component in components {
            let nextFD = component.withCString {
                Darwin.openat(currentFD, $0, flags)
            }
            guard nextFD >= 0 else {
                let errorCode = errno
                Darwin.close(currentFD)
                throw posixError("无法安全打开目标目录。", code: errorCode)
            }
            Darwin.close(currentFD)
            currentFD = nextFD
        }
        return currentFD
    }

    static func moveExclusive(
        fileName: String,
        sourceDirectoryFD: Int32,
        destinationDirectoryFD: Int32
    ) throws -> String {
        let fileURL = URL(fileURLWithPath: fileName)
        let stem = fileURL.deletingPathExtension().lastPathComponent
        let fileExtension = fileURL.pathExtension
        for index in 0..<10_000 {
            let suffix = index == 0 ? "" : " \(index + 1)"
            let candidate = fileExtension.isEmpty
                ? "\(stem)\(suffix)"
                : "\(stem)\(suffix).\(fileExtension)"
            let renamed = fileName.withCString { sourceName in
                candidate.withCString { destinationName in
                    Darwin.renameatx_np(
                        sourceDirectoryFD,
                        sourceName,
                        destinationDirectoryFD,
                        destinationName,
                        UInt32(RENAME_EXCL)
                    )
                }
            }
            if renamed == 0 {
                return candidate
            }
            let errorCode = errno
            if errorCode == EEXIST {
                continue
            }
            throw posixError(
                "无法将笔记移入废纸篓。",
                code: errorCode
            )
        }
        throw VaultPathError.operationFailed("废纸篓中存在过多同名文件。")
    }

    private static func posixError(
        _ message: String,
        code: Int32
    ) -> VaultPathError {
        .operationFailed(
            "\(message)（\(String(cString: strerror(code)))）"
        )
    }
}

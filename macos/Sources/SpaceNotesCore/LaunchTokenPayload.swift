import CryptoKit
import Foundation

public enum LaunchTokenPayload {
    public static func data(for token: String) throws -> Data {
        guard !token.isEmpty, !token.contains(where: \.isNewline) else {
            throw LaunchTokenError.invalid
        }
        return Data("SPACENOTES_TOKEN=\(token)\n".utf8)
    }

    public static func fingerprint(of token: String) -> String {
        SHA256.hash(data: Data(token.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}

public enum LaunchTokenError: LocalizedError {
    case invalid

    public var errorDescription: String? {
        "sidecar 启动令牌无效。"
    }
}

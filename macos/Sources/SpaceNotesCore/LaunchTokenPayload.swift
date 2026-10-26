import CryptoKit
import Foundation

public enum LaunchTokenPayload {
    public static func data(
        token: String,
        internalToken: String
    ) throws -> Data {
        for value in [token, internalToken]
        where value.isEmpty || value.contains(where: \.isNewline) {
            throw LaunchTokenError.invalid
        }
        return Data(
            """
            SPACENOTES_TOKEN=\(token)
            SPACENOTES_INTERNAL_TOKEN=\(internalToken)

            """.utf8
        )
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

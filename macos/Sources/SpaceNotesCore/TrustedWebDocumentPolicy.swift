import Foundation

public struct TrustedWebDocumentPolicy {
    private let trustedOrigins: [URL]

    public init(trustedOrigins: [URL]) {
        self.trustedOrigins = trustedOrigins
    }

    public func isTrustedDocument(_ url: URL) -> Bool {
        guard
            isTrustedOrigin(
                scheme: url.scheme,
                host: url.host,
                port: url.port
            )
        else {
            return false
        }
        return ["", "/", "/index.html"].contains(url.path)
    }

    public func isTrustedOrigin(
        scheme: String?,
        host: String?,
        port: Int?
    ) -> Bool {
        guard let scheme = scheme?.lowercased(), let host else {
            return false
        }
        return trustedOrigins.contains { origin in
            origin.scheme?.lowercased() == scheme &&
                origin.host?.lowercased() == host.lowercased() &&
                effectivePort(for: origin) == effectivePort(
                    scheme: scheme,
                    port: port
                )
        }
    }

    private func effectivePort(for url: URL) -> Int? {
        effectivePort(scheme: url.scheme, port: url.port)
    }

    private func effectivePort(scheme: String?, port: Int?) -> Int? {
        if let port {
            return port
        }
        switch scheme?.lowercased() {
        case "http":
            return 80
        case "https":
            return 443
        default:
            return nil
        }
    }
}

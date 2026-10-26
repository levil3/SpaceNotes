import Foundation

public enum WebNavigationDecision: Equatable {
    case allow
    case openExternally
    case cancel
}

public enum WebNavigationPolicy {
    public static func decision(
        url: URL,
        isMainFrame: Bool,
        isTrustedOrigin: Bool,
        isTrustedDocument: Bool
    ) -> WebNavigationDecision {
        if isMainFrame && isTrustedDocument {
            return .allow
        }
        if !isTrustedOrigin,
           !isTrustedDocument,
           ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            return .openExternally
        }
        return .cancel
    }
}

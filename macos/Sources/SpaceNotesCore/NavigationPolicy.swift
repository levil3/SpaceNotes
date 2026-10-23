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
        isTrustedDocument: Bool
    ) -> WebNavigationDecision {
        if isMainFrame && isTrustedDocument {
            return .allow
        }
        if !isTrustedDocument,
           ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            return .openExternally
        }
        return .cancel
    }
}

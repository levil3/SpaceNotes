import AppKit
import SpaceNotesCore
import WebKit

final class NavigationDelegate: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let documentPolicy: TrustedWebDocumentPolicy
    private let openExternal: (URL) -> Void
    private let onSameOriginNavigationCanceled: () -> Void
    private let onFinish: () -> Void

    init(
        documentPolicy: TrustedWebDocumentPolicy,
        openExternal: @escaping (URL) -> Void = {
            NSWorkspace.shared.open($0)
        },
        onSameOriginNavigationCanceled: @escaping () -> Void = {},
        onFinish: @escaping () -> Void
    ) {
        self.documentPolicy = documentPolicy
        self.openExternal = openExternal
        self.onSameOriginNavigationCanceled = onSameOriginNavigationCanceled
        self.onFinish = onFinish
    }

    func webView(
        _ webView: WKWebView,
        didFinish navigation: WKNavigation!
    ) {
        guard let currentURL = webView.url,
              documentPolicy.isTrustedDocument(currentURL) else {
            return
        }
        onFinish()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        let decision = WebNavigationPolicy.decision(
            url: url,
            isMainFrame: navigationAction.targetFrame?.isMainFrame == true,
            isTrustedOrigin: documentPolicy.isTrustedOrigin(url),
            isTrustedDocument: documentPolicy.isTrustedDocument(url)
        )
        switch decision {
        case .allow:
            decisionHandler(.allow)
            return
        case .openExternally:
            openExternally(url)
        case .cancel:
            if documentPolicy.isTrustedOrigin(url) {
                onSameOriginNavigationCanceled()
            }
        }
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url,
           WebNavigationPolicy.decision(
               url: url,
               isMainFrame: false,
               isTrustedOrigin: documentPolicy.isTrustedOrigin(url),
               isTrustedDocument: documentPolicy.isTrustedDocument(url)
           ) == .openExternally {
            openExternally(url)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        let alert = NSAlert()
        alert.messageText = "页面加载失败"
        alert.informativeText = error.localizedDescription
        alert.runModal()
    }

    private func openExternally(_ url: URL) {
        if WebNavigationPolicy.decision(
            url: url,
            isMainFrame: false,
            isTrustedOrigin: false,
            isTrustedDocument: false
        ) == .openExternally {
            openExternal(url)
        }
    }
}

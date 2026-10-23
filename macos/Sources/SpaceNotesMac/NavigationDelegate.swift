import AppKit
import SpaceNotesCore
import WebKit

final class NavigationDelegate: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let documentPolicy: TrustedWebDocumentPolicy
    private let onFinish: () -> Void

    init(
        documentPolicy: TrustedWebDocumentPolicy,
        onFinish: @escaping () -> Void
    ) {
        self.documentPolicy = documentPolicy
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
        if navigationAction.targetFrame?.isMainFrame == true,
           documentPolicy.isTrustedDocument(url) {
            decisionHandler(.allow)
            return
        }
        if navigationAction.targetFrame == nil {
            openExternally(url)
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
           !documentPolicy.isTrustedDocument(url) {
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
        if ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            NSWorkspace.shared.open(url)
        }
    }
}

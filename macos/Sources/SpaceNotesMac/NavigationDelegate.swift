import AppKit
import WebKit

final class NavigationDelegate: NSObject, WKNavigationDelegate {
    private let allowedOrigin: URL
    private let onFinish: () -> Void

    init(allowedOrigin: URL, onFinish: @escaping () -> Void) {
        self.allowedOrigin = allowedOrigin
        self.onFinish = onFinish
    }

    func webView(
        _ webView: WKWebView,
        didFinish navigation: WKNavigation!
    ) {
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
        if url.scheme == "notes-asset" {
            decisionHandler(.allow)
            return
        }
        if url.scheme == allowedOrigin.scheme,
           url.host == allowedOrigin.host,
           url.port == allowedOrigin.port
        {
            decisionHandler(.allow)
            return
        }
        if ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
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
}

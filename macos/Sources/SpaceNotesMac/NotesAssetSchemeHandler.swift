import Foundation
import SpaceNotesCore
import WebKit

final class NotesAssetSchemeHandler: NSObject, WKURLSchemeHandler {
    private let clientProvider: () -> SidecarClient?
    private let lock = NSLock()
    private var tasks: [ObjectIdentifier: URLSessionDataTask] = [:]

    init(clientProvider: @escaping () -> SidecarClient?) {
        self.clientProvider = clientProvider
    }

    func webView(
        _ webView: WKWebView,
        start urlSchemeTask: WKURLSchemeTask
    ) {
        guard let sourceURL = urlSchemeTask.request.url,
              let request = AssetRequest(url: sourceURL),
              let client = clientProvider(),
              var components = URLComponents(
                url: client.baseURL.appendingPathComponent("assets"),
                resolvingAgainstBaseURL: false
              )
        else {
            fail(urlSchemeTask)
            return
        }
        components.queryItems = [
            URLQueryItem(name: "target", value: request.target),
            URLQueryItem(name: "note", value: request.notePath),
            URLQueryItem(name: "token", value: client.token)
        ]
        guard let url = components.url else {
            fail(urlSchemeTask)
            return
        }
        var sidecarRequest = URLRequest(url: url)
        sidecarRequest.setValue(
            "Bearer \(client.token)",
            forHTTPHeaderField: "Authorization"
        )
        let key = ObjectIdentifier(urlSchemeTask)
        let task = URLSession.shared.dataTask(with: sidecarRequest) {
            [weak self, weak urlSchemeTask] data, response, error in
            DispatchQueue.main.async {
                guard let self, let urlSchemeTask else {
                    return
                }
                self.lock.lock()
                let wasActive = self.tasks.removeValue(forKey: key) != nil
                self.lock.unlock()
                guard wasActive else { return }
                if let error {
                    urlSchemeTask.didFailWithError(error)
                    return
                }
                guard let data, let response else {
                    self.fail(urlSchemeTask)
                    return
                }
                urlSchemeTask.didReceive(response)
                urlSchemeTask.didReceive(data)
                urlSchemeTask.didFinish()
            }
        }
        lock.lock()
        tasks[key] = task
        lock.unlock()
        task.resume()
    }

    func webView(
        _ webView: WKWebView,
        stop urlSchemeTask: WKURLSchemeTask
    ) {
        let key = ObjectIdentifier(urlSchemeTask)
        lock.lock()
        let task = tasks.removeValue(forKey: key)
        lock.unlock()
        task?.cancel()
    }

    private func fail(_ task: WKURLSchemeTask) {
        task.didFailWithError(
            NSError(
                domain: "com.levil.notes.asset",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "附件不存在。"]
            )
        )
    }
}

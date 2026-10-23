import Foundation

public enum SidecarClientError: LocalizedError {
    case invalidResponse
    case server(String)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "sidecar 返回了无效响应。"
        case let .server(message):
            return message
        }
    }
}

public struct SidecarClient: Sendable {
    public let baseURL: URL
    public let token: String
    private let session: URLSession

    public init(
        baseURL: URL,
        token: String,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
    }

    public func call(method: String, arguments: [Any] = []) async throws -> Any? {
        try await post(path: "/api/\(method)", arguments: arguments)
    }

    public func internalCall(
        method: String,
        arguments: [Any] = []
    ) async throws -> Any? {
        try await post(path: "/internal/\(method)", arguments: arguments)
    }

    public func snapshot() async throws -> [String: Any] {
        guard let value = try await call(method: "getVaultSnapshot"),
              let snapshot = value as? [String: Any]
        else {
            throw SidecarClientError.invalidResponse
        }
        return snapshot
    }

    private func post(path: String, arguments: [Any]) async throws -> Any? {
        guard let endpoint = Self.endpointURL(baseURL: baseURL, path: path)
        else {
            throw SidecarClientError.invalidResponse
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(
            withJSONObject: ["args": arguments],
            options: []
        )
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SidecarClientError.invalidResponse
        }
        let object = try? JSONSerialization.jsonObject(with: data)
        let dictionary = object as? [String: Any]
        guard (200..<300).contains(http.statusCode) else {
            throw Self.serverError(
                statusCode: http.statusCode,
                data: data,
                token: token
            )
        }
        guard let dictionary, dictionary.keys.contains("result") else {
            throw SidecarClientError.invalidResponse
        }
        return dictionary["result"]
    }

    static func endpointURL(baseURL: URL, path: String) -> URL? {
        let normalizedPath = path.trimmingCharacters(
            in: CharacterSet(charactersIn: "/")
        )
        guard
            var components = URLComponents(
                url: baseURL,
                resolvingAgainstBaseURL: false
            ),
            !normalizedPath.isEmpty
        else {
            return nil
        }
        components.path = "/\(normalizedPath)"
        components.query = nil
        components.fragment = nil
        return components.url
    }

    static func serverError(
        statusCode: Int,
        data: Data,
        token: String
    ) -> SidecarClientError {
        let object = try? JSONSerialization.jsonObject(with: data)
        let serverMessage = (object as? [String: Any])?["error"] as? String
        let rawBody = serverMessage
            ?? String(data: data, encoding: .utf8)
            ?? ""
        let safeBody = rawBody
            .replacingOccurrences(of: token, with: "[redacted]")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let detail = safeBody.isEmpty ? "" : "：\(safeBody.prefix(300))"
        return .server("sidecar 请求失败（HTTP \(statusCode)）\(detail)")
    }
}

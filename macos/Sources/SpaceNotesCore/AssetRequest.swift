import Foundation

public struct AssetRequest: Equatable, Sendable {
    public let target: String
    public let notePath: String

    public init(target: String, notePath: String) {
        self.target = target
        self.notePath = notePath
    }

    public init?(url: URL) {
        guard url.scheme?.lowercased() == "notes-asset" else {
            return nil
        }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let query = Dictionary(
            uniqueKeysWithValues: (components?.queryItems ?? []).compactMap {
                item in item.value.map { (item.name, $0) }
            }
        )
        let pathTarget = url.path
            .removingPercentEncoding?
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            ?? ""
        let target = query["target"] ?? pathTarget
        guard !target.isEmpty else {
            return nil
        }
        self.init(
            target: target,
            notePath: query["note"] ?? ""
        )
    }
}

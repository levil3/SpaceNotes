import Foundation

public struct BridgeRequest: Equatable {
    public let id: Int
    public let name: String
    public let arguments: [Any]

    public init?(body: Any) {
        guard
            let dictionary = body as? [String: Any],
            let name = dictionary["name"] as? String,
            !name.isEmpty
        else {
            return nil
        }
        if dictionary["id"] == nil {
            self.id = 0
        } else if
            let number = dictionary["id"] as? NSNumber,
            number.intValue > 0
        {
            self.id = number.intValue
        } else {
            return nil
        }
        self.name = name
        self.arguments = dictionary["args"] as? [Any] ?? []
    }

    public var isNotification: Bool {
        id == 0
    }

    public static func == (left: BridgeRequest, right: BridgeRequest) -> Bool {
        left.id == right.id &&
            left.name == right.name &&
            NSArray(array: left.arguments).isEqual(to: right.arguments)
    }
}

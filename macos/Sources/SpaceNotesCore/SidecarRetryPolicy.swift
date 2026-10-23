public struct SidecarRetryPolicy: Sendable {
    public let maximumAutomaticRestarts: Int
    public private(set) var automaticRestarts = 0

    public init(maximumAutomaticRestarts: Int = 1) {
        self.maximumAutomaticRestarts = maximumAutomaticRestarts
    }

    public mutating func consumeRestart() -> Bool {
        guard automaticRestarts < maximumAutomaticRestarts else {
            return false
        }
        automaticRestarts += 1
        return true
    }
}

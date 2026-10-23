import Foundation

public enum ReadyHandshake {
    public static func port(from line: String) -> Int? {
        guard
            let data = line.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data),
            let dictionary = object as? [String: Any],
            dictionary["type"] as? String == "ready",
            dictionary["host"] as? String == "127.0.0.1",
            let port = dictionary["port"] as? NSNumber,
            port.intValue > 0,
            port.intValue <= 65535
        else {
            return nil
        }
        return port.intValue
    }
}

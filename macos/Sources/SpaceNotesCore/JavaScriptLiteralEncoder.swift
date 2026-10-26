import Foundation

public enum JavaScriptLiteralEncoder {
    public static func encode(_ value: Any) -> String? {
        if value is NSNull {
            return "null"
        }
        guard
            JSONSerialization.isValidJSONObject(value)
                || value is String
                || value is NSNumber,
            let data = try? JSONSerialization.data(
                withJSONObject: value,
                options: [.fragmentsAllowed]
            )
        else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }
}

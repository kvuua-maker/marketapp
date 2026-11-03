import Foundation

/// Stable per-install identifier sent as `X-Client-Token`.
/// The server stores only its hash on orders, so order history can be read by
/// this device and by nobody else — knowing a phone number is not enough.
enum ClientIdentity {
    private static let key = "marketapp.clientToken"

    static let token: String = {
        let defaults = UserDefaults.standard
        if let existing = defaults.string(forKey: key), existing.count >= 16 {
            return existing
        }
        let generated = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        defaults.set(generated, forKey: key)
        return generated
    }()
}

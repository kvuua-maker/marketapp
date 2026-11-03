import Foundation

enum AppConfig {
    /// Configured in Info.plist (APIBaseURL) so the same binary can point at
    /// staging or production without a rebuild.
    static var baseURL: URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String,
           !raw.isEmpty,
           let url = URL(string: raw) {
            return url
        }
        return URL(string: "http://127.0.0.1:8899")!
    }
}

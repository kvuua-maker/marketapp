import Foundation

/// Fire-and-forget product analytics. Failures never affect the UI.
enum Analytics {
    static func track(_ name: String, productId: String? = nil, orderId: String? = nil, meta: [String: String] = [:]) {
        guard var components = URLComponents(
            url: AppConfig.baseURL.appendingPathComponent("/v1/events"),
            resolvingAgainstBaseURL: false
        ) else { return }
        components.query = nil

        guard let url = components.url else { return }
        var body: [String: Any] = ["name": name, "meta": meta]
        if let productId { body["productId"] = productId }
        if let orderId { body["orderId"] = orderId }

        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(ClientIdentity.token, forHTTPHeaderField: "X-Client-Token")
        request.httpBody = data

        URLSession.shared.dataTask(with: request) { _, _, _ in }.resume()
    }
}

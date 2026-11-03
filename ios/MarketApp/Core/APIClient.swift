import Foundation

struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private struct ServerErrorEnvelope: Decodable {
    struct Payload: Decodable {
        let code: String
        let message: String
    }
    let error: Payload
}

struct APIClient {
    static let shared = APIClient()

    let baseURL: URL
    private let session: URLSession
    private let decoder = JSONDecoder()

    init(baseURL: URL = AppConfig.baseURL) {
        self.baseURL = baseURL
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 20
        configuration.urlCache = URLCache(
            memoryCapacity: 16 * 1024 * 1024,
            diskCapacity: 64 * 1024 * 1024,
            diskPath: "marketapp-api"
        )
        self.session = URLSession(configuration: configuration)
    }

    func categories() async throws -> CategoryPage {
        try await get("/v1/categories")
    }

    func products(category: String?, query: String, offset: Int, limit: Int) async throws -> ProductPage {
        var items: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
        if let category, !category.isEmpty {
            items.append(URLQueryItem(name: "category", value: category))
        }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            items.append(URLQueryItem(name: "q", value: trimmed))
        }
        return try await get("/v1/products", query: items)
    }

    func product(id: String) async throws -> Product {
        try await get("/v1/products/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)")
    }

    func createOrder(_ request: OrderRequest) async throws -> OrderResponse {
        try await post("/v1/orders", body: request)
    }

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )
        if !query.isEmpty { components?.queryItems = query }
        guard let url = components?.url else { throw APIError(message: "Некоректна адреса сервера") }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await send(request)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIError(message: "Невідома відповідь сервера")
            }
            guard (200..<300).contains(http.statusCode) else {
                throw APIError(message: Self.errorMessage(from: data) ?? "Помилка сервера (\(http.statusCode))")
            }
            return try decoder.decode(T.self, from: data)
        } catch let error as APIError {
            throw error
        } catch is DecodingError {
            throw APIError(message: "Сервер повернув неочікуваний формат даних")
        } catch {
            throw APIError(message: "Немає звʼязку з сервером. Перевірте інтернет.")
        }
    }

    private static func errorMessage(from data: Data) -> String? {
        guard let envelope = try? JSONDecoder().decode(ServerErrorEnvelope.self, from: data) else { return nil }
        return envelope.error.message
    }
}

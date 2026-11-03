import Foundation

struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Renders everything Apple tells us about a failed request, so the device
/// screen becomes a usable diagnostic instead of "no connection".
enum ErrorReport {
    static func describe(_ error: Error, request: URLRequest) -> String {
        let ns = error as NSError
        let url = request.url?.absoluteString ?? "(no url)"
        return [
            "\(ns.domain) \(ns.code)",
            ns.localizedDescription,
            "URL: \(url)",
        ].joined(separator: "\n")
    }
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

    /// All supplier photos go through the server-side resizer (2 MB -> ~40 KB).
    static func imageURL(_ raw: String?, width: Int = 400) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        var components = URLComponents(url: AppConfig.baseURL.appendingPathComponent("/v1/img"), resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "w", value: String(width)),
            URLQueryItem(name: "url", value: raw),
        ]
        return components?.url
    }

    let baseURL: URL
    private let session: URLSession
    private let decoder = JSONDecoder()

    init(baseURL: URL = AppConfig.baseURL) {
        self.baseURL = baseURL
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 20
        configuration.urlCache = URLCache(
            memoryCapacity: 32 * 1024 * 1024,
            diskCapacity: 256 * 1024 * 1024,
            diskPath: "marketapp-api"
        )
        self.session = URLSession(configuration: configuration)
    }

    // MARK: - Catalog

    func categories() async throws -> CategoryPage {
        try await get("/v1/categories")
    }

    func brands() async throws -> BrandPage {
        try await get("/v1/brands")
    }

    func products(_ query: ProductQuery) async throws -> ProductPage {
        var items: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: String(query.limit)),
            URLQueryItem(name: "offset", value: String(query.offset)),
            URLQueryItem(name: "sort", value: query.sort),
        ]
        if let category = query.category, !category.isEmpty {
            items.append(URLQueryItem(name: "category", value: category))
        }
        let trimmed = query.search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            items.append(URLQueryItem(name: "q", value: trimmed))
        }
        if query.includeOutOfStock {
            items.append(URLQueryItem(name: "include_out_of_stock", value: "1"))
        }
        if query.onlyInStock {
            items.append(URLQueryItem(name: "in_stock", value: "1"))
        }
        if let min = query.minPriceCents {
            items.append(URLQueryItem(name: "min_price", value: String(min)))
        }
        if let max = query.maxPriceCents {
            items.append(URLQueryItem(name: "max_price", value: String(max)))
        }
        if !query.brands.isEmpty {
            items.append(URLQueryItem(name: "brand", value: query.brands.joined(separator: ",")))
        }
        return try await get("/v1/products", query: items)
    }

    func filters() async throws -> FilterOptions {
        try await get("/v1/filters")
    }

    func suggest(_ query: String) async throws -> SuggestionPage {
        try await get("/v1/search/suggest", query: [URLQueryItem(name: "q", value: query)])
    }

    func cities(_ query: String) async throws -> CityPage {
        try await get("/v1/np/cities", query: [URLQueryItem(name: "q", value: query)])
    }

    func warehouses(city: String, query: String) async throws -> WarehousePage {
        try await get("/v1/np/warehouses", query: [
            URLQueryItem(name: "city", value: city),
            URLQueryItem(name: "q", value: query),
        ])
    }

    func products(ids: [String]) async throws -> ProductList {
        guard !ids.isEmpty else { return ProductList(items: []) }
        return try await get("/v1/products", query: [
            URLQueryItem(name: "ids", value: ids.joined(separator: ",")),
            URLQueryItem(name: "limit", value: "60"),
            URLQueryItem(name: "include_out_of_stock", value: "1"),
        ])
    }

    func productDetail(id: String) async throws -> ProductDetail {
        try await get("/v1/products/\(encoded(id))")
    }

    func similar(id: String) async throws -> ProductList {
        try await get("/v1/products/\(encoded(id))/similar")
    }

    func promotions(limit: Int = 10) async throws -> ProductList {
        try await get("/v1/promotions", query: [URLQueryItem(name: "limit", value: String(limit))])
    }

    // MARK: - Reviews

    func reviews(productId: String) async throws -> ReviewPage {
        try await get("/v1/products/\(encoded(productId))/reviews")
    }

    func reportReview(id: Int, reason: String) async throws -> ReviewReportResult {
        try await post("/v1/reviews/\(id)/report", body: ["reason": reason])
    }

    func submitReview(productId: String, author: String, rating: Int, text: String) async throws -> ReviewResult {
        try await post(
            "/v1/products/\(encoded(productId))/reviews",
            body: ["author": author, "rating": String(rating), "text": text]
        )
    }

    // MARK: - Orders

    func orders(phone: String) async throws -> OrderHistoryPage {
        try await get("/v1/orders", query: [URLQueryItem(name: "phone", value: phone)])
    }

    func createOrder(_ request: OrderRequest) async throws -> OrderResponse {
        try await post("/v1/orders", body: request)
    }

    // MARK: - Transport

    private func encoded(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)
        if !query.isEmpty { components?.queryItems = query }
        guard let url = components?.url else { throw APIError(message: "Некоректна адреса сервера") }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(ClientIdentity.token, forHTTPHeaderField: "X-Client-Token")
        return try await send(request)
    }

    private func post<T: Decodable>(_ path: String, body: [String: String]) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(ClientIdentity.token, forHTTPHeaderField: "X-Client-Token")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(ClientIdentity.token, forHTTPHeaderField: "X-Client-Token")
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
            throw APIError(message: "Сервер повернув неочікуваний формат даних\nURL: \(request.url?.absoluteString ?? "?")")
        } catch {
            let report = ErrorReport.describe(error, request: request)
            print("[MarketApp] request failed:\n\(report)")
            throw APIError(message: "Немає звʼязку з сервером\n\(report)")
        }
    }

    private static func errorMessage(from data: Data) -> String? {
        guard let envelope = try? JSONDecoder().decode(ServerErrorEnvelope.self, from: data) else { return nil }
        return envelope.error.message
    }
}

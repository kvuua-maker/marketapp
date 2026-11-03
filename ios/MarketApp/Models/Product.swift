import Foundation

struct Product: Identifiable, Codable, Hashable {
    let id: String
    let title: String
    let shortDescription: String
    let imageUrl: String
    let images: [String]
    let priceCents: Int
    let oldPriceCents: Int?
    let discountPercent: Int
    let currency: String
    let category: String
    let stock: Int
    let vendor: String?
    let supplierId: String
    let productUrl: String?
    let rating: Double
    let ratingCount: Int

    var isAvailable: Bool { stock > 0 }
    var hasDiscount: Bool { (oldPriceCents ?? 0) > priceCents }
}

/// The detail endpoint returns the same product plus the full description.
struct ProductDetail: Codable, Identifiable {
    let id: String
    let title: String
    let shortDescription: String
    let description: String
    let imageUrl: String
    let images: [String]
    let priceCents: Int
    let oldPriceCents: Int?
    let discountPercent: Int
    let currency: String
    let category: String
    let stock: Int
    let vendor: String?
    let supplierId: String
    let rating: Double
    let ratingCount: Int
}

struct ProductPage: Codable {
    let items: [Product]
    let total: Int
    let limit: Int
    let offset: Int
}

struct ProductList: Codable {
    let items: [Product]
}

struct CategoryCount: Identifiable, Codable, Hashable {
    let name: String
    let count: Int
    var id: String { name }
}

struct CategoryPage: Codable {
    let total: Int
    let items: [CategoryCount]
}

struct BrandCount: Identifiable, Codable, Hashable {
    let name: String
    let count: Int
    var id: String { name }
}

struct BrandPage: Codable {
    let items: [BrandCount]
}

struct Customer: Codable, Equatable {
    var fullName: String = ""
    var phone: String = ""
    var city: String = ""
    var branch: String = ""
    var comment: String = ""
}

struct OrderItemInput: Codable {
    let productId: String
    let qty: Int
}

struct OrderRequest: Codable {
    let customer: Customer
    let items: [OrderItemInput]
}

struct SupplierRouted: Codable, Hashable {
    let supplierId: String
    let supplierName: String
    let status: String
    let items: Int
}

struct OrderResponse: Codable {
    let orderId: String
    let status: String
    let totalCents: Int
    let currency: String
    let payment: String
    let ttn: String?
    let suppliers: [SupplierRouted]?
}

struct Review: Identifiable, Codable, Hashable {
    let id: Int
    let author: String
    let rating: Int
    let text: String
    let createdAt: String
}

struct ReviewPage: Codable {
    let average: Double
    let count: Int
    let items: [Review]
}

struct ReviewReportResult: Codable {
    let accepted: Bool
    let reports: Int?
}

struct ReviewResult: Codable {
    let status: String
    let average: Double
    let count: Int
}

struct OrderHistoryItem: Identifiable, Codable, Hashable {
    let productId: String
    let title: String
    let qty: Int
    let unitPriceCents: Int
    var id: String { productId }
}

struct OrderSummary: Identifiable, Codable, Hashable {
    let id: String
    let status: String
    let totalCents: Int
    let currency: String
    let createdAt: String
    let ttn: String?
    let trackingUrl: String?
    let items: [OrderHistoryItem]
}

struct OrderHistoryPage: Codable {
    let items: [OrderSummary]
}

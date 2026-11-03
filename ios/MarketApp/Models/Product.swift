import Foundation

struct Product: Identifiable, Codable, Hashable {
    let id: String
    let title: String
    let shortDescription: String
    let description: String
    let imageUrl: String
    let images: [String]
    let priceCents: Int
    let currency: String
    let category: String
    let stock: Int
    let vendor: String?
    let supplierId: String
    let productUrl: String?

    var isAvailable: Bool { stock > 0 }
}

struct ProductPage: Codable {
    let items: [Product]
    let total: Int
    let limit: Int
    let offset: Int
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

struct Customer: Codable, Equatable {
    var fullName: String
    var phone: String
    var city: String
    var branch: String
    var comment: String
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
    let suppliers: [SupplierRouted]?
}

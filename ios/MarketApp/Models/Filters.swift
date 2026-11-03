import Foundation

// MARK: - Filters & suggestions

struct FilterOptions: Codable {
    let minPriceCents: Int
    let maxPriceCents: Int
    let brands: [BrandCount]
}

struct Suggestion: Identifiable, Codable, Hashable {
    let type: String
    let id: String
    let title: String
    let priceCents: Int?
}

struct SuggestionPage: Codable {
    let items: [Suggestion]
}

struct ProductQuery {
    var category: String?
    var search: String = ""
    var sort: String = "relevance"
    var includeOutOfStock = false
    var onlyInStock = true
    var minPriceCents: Int?
    var maxPriceCents: Int?
    var brands: [String] = []
    var offset = 0
    var limit = 24
}

// MARK: - Nova Poshta reference data

struct CityOption: Identifiable, Codable, Hashable {
    let name: String
    let ref: String?
    var id: String { name }
}

struct CityPage: Codable {
    let configured: Bool
    let items: [CityOption]
}

struct WarehouseOption: Identifiable, Codable, Hashable {
    let name: String
    let ref: String?
    var id: String { name }
}

struct WarehousePage: Codable {
    let configured: Bool
    let items: [WarehouseOption]
}

// MARK: - Saved addresses

struct SavedAddress: Identifiable, Codable, Hashable {
    var id = UUID()
    var label: String
    var city: String
    var branch: String
}

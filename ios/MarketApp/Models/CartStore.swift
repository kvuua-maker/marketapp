import Foundation

@MainActor
final class CartStore: ObservableObject {
    struct Line: Identifiable, Codable, Hashable {
        var product: Product
        var qty: Int
        var id: String { product.id }
        var totalCents: Int { product.priceCents * qty }
    }

    /// Persisted so closing the app never loses the basket.
    @Published private(set) var lines: [Line] = [] {
        didSet { persist() }
    }

    private let storageKey = "marketapp.cart.v1"

    init() {
        load()
    }

    var count: Int { lines.reduce(0) { $0 + $1.qty } }
    var totalCents: Int { lines.reduce(0) { $0 + $1.totalCents } }
    var isEmpty: Bool { lines.isEmpty }

    /// Never more than the supplier actually has, and never more than 10.
    static func maxQty(for product: Product) -> Int {
        max(1, min(10, product.stock))
    }

    func add(_ product: Product) {
        guard product.isAvailable else { return }
        let cap = Self.maxQty(for: product)

        if let index = lines.firstIndex(where: { $0.id == product.id }) {
            let next = min(lines[index].qty + 1, cap)
            guard next != lines[index].qty else { return }
            lines[index].qty = next
            lines[index].product = product // refresh price / stock
        } else {
            lines.append(Line(product: product, qty: 1))
        }
    }

    func setQty(_ qty: Int, for id: String) {
        guard let index = lines.firstIndex(where: { $0.id == id }) else { return }
        if qty <= 0 {
            lines.remove(at: index)
        } else {
            lines[index].qty = min(qty, Self.maxQty(for: lines[index].product))
        }
    }

    func remove(id: String) {
        lines.removeAll { $0.id == id }
    }

    func clear() {
        lines.removeAll()
    }

    func orderItems() -> [OrderItemInput] {
        lines.map { OrderItemInput(productId: $0.product.id, qty: $0.qty) }
    }

    // MARK: - Persistence

    private func persist() {
        guard let data = try? JSONEncoder().encode(lines) else { return }
        UserDefaults.standard.set(data, forKey: storageKey)
    }

    private func load() {
        guard
            let data = UserDefaults.standard.data(forKey: storageKey),
            let decoded = try? JSONDecoder().decode([Line].self, from: data)
        else { return }
        lines = decoded.filter { $0.product.isAvailable && $0.qty > 0 }
    }
}

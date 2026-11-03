import Foundation

@MainActor
final class CartStore: ObservableObject {
    struct Line: Identifiable {
        var product: Product
        var qty: Int
        var id: String { product.id }
        var totalCents: Int { product.priceCents * qty }
    }

    @Published private(set) var lines: [Line] = []

    var count: Int { lines.reduce(0) { $0 + $1.qty } }
    var totalCents: Int { lines.reduce(0) { $0 + $1.totalCents } }
    var isEmpty: Bool { lines.isEmpty }

    func add(_ product: Product) {
        guard product.isAvailable else { return }
        if let index = lines.firstIndex(where: { $0.id == product.id }) {
            lines[index].qty = min(lines[index].qty + 1, 10)
        } else {
            lines.append(Line(product: product, qty: 1))
        }
    }

    func setQty(_ qty: Int, for id: String) {
        guard let index = lines.firstIndex(where: { $0.id == id }) else { return }
        if qty <= 0 {
            lines.remove(at: index)
        } else {
            lines[index].qty = min(qty, 10)
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
}

import Foundation

/// Small in-memory cache for product details so re-opening a card does not
/// hit the network again. Bounded to 40 entries (LRU-ish eviction).
final class ProductDetailCache {
    static let shared = ProductDetailCache()

    private var storage: [String: ProductDetail] = [:]
    private var order: [String] = []
    private let limit = 40

    func value(for id: String) -> ProductDetail? {
        storage[id]
    }

    func insert(_ detail: ProductDetail) {
        if storage[detail.id] == nil { order.append(detail.id) }
        storage[detail.id] = detail

        while order.count > limit {
            let evicted = order.removeFirst()
            storage.removeValue(forKey: evicted)
        }
    }

    func clear() {
        storage.removeAll()
        order.removeAll()
    }
}

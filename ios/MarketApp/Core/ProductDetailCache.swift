import Foundation

/// Small in-memory cache for product details so re-opening a card does not hit
/// the network again. Entries expire after five minutes, so a price change on
/// the server is picked up without an app restart.
final class ProductDetailCache {
    static let shared = ProductDetailCache()

    private struct Entry {
        let detail: ProductDetail
        let storedAt: Date
    }

    private var storage: [String: Entry] = [:]
    private var order: [String] = []
    private let limit = 40
    private let ttl: TimeInterval = 5 * 60

    func value(for id: String) -> ProductDetail? {
        guard let entry = storage[id] else { return nil }
        guard Date().timeIntervalSince(entry.storedAt) < ttl else {
            storage.removeValue(forKey: id)
            order.removeAll { $0 == id }
            return nil
        }
        return entry.detail
    }

    func insert(_ detail: ProductDetail) {
        if storage[detail.id] == nil { order.append(detail.id) }
        storage[detail.id] = Entry(detail: detail, storedAt: Date())

        while order.count > limit {
            let evicted = order.removeFirst()
            storage.removeValue(forKey: evicted)
        }
    }

    func invalidate(id: String) {
        storage.removeValue(forKey: id)
        order.removeAll { $0 == id }
    }

    func clear() {
        storage.removeAll()
        order.removeAll()
    }
}

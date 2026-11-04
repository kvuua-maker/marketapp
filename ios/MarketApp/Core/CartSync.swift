import Foundation

/// Two-way cart sync between all devices signed into the same Apple ID.
///
/// Rules:
///  * server has items, this device has none → pull
///  * this device has items, server has none → push
///  * both have items → merge by product id (max qty, capped by stock, no duplicates)
///
/// The merge runs on every launch (RootView), right after sign-in, and the
/// local cart is pushed (debounced) after every change.
@MainActor
enum CartSync {
    private static var pushTask: Task<Void, Never>?
    private static var mergeInFlight = false

    // MARK: - Merge

    static func mergeRemoteIntoLocal(_ cart: CartStore) async {
        guard SessionStore.token != nil else {
            print("[CartSync] skip: not signed in")
            return
        }
        guard !mergeInFlight else {
            print("[CartSync] merge already running, skipping duplicate trigger")
            return
        }
        mergeInFlight = true
        defer { mergeInFlight = false }

        print("[CartSync] pull ← GET /v1/cart")
        guard let remote = try? await APIClient.shared.remoteCart() else {
            print("[CartSync] pull failed, keeping local cart (\(cart.lines.count) lines)")
            return
        }
        print("[CartSync] remote has \(remote.items.count) items, local has \(cart.lines.count)")

        var orderedIds: [String] = []
        var seen = Set<String>()
        for item in cart.orderItems() where seen.insert(item.productId).inserted {
            orderedIds.append(item.productId)
        }
        for item in remote.items where seen.insert(item.productId).inserted {
            orderedIds.append(item.productId)
        }

        guard !orderedIds.isEmpty else {
            print("[CartSync] both carts empty — nothing to do")
            return
        }

        let products = await fetchProducts(ids: orderedIds)
        var localQty: [String: Int] = [:]
        for item in cart.orderItems() {
            localQty[item.productId] = max(localQty[item.productId] ?? 0, item.qty)
        }
        var remoteQty: [String: Int] = [:]
        for item in remote.items {
            remoteQty[item.productId] = max(remoteQty[item.productId] ?? 0, item.qty)
        }

        var merged: [(product: Product, qty: Int)] = []
        for id in orderedIds {
            guard let product = products[id], product.isAvailable else { continue }
            let qty = min(max(localQty[id] ?? 0, remoteQty[id] ?? 0), CartStore.maxQty(for: product))
            guard qty > 0 else { continue }
            merged.append((product, qty))
        }

        cart.replaceAll(with: merged)
        print("[CartSync] merged \(merged.count) items (max qty, capped by stock)")

        await pushNow(cart)
    }

    // MARK: - Push

    static func pushNow(_ cart: CartStore) async {
        guard SessionStore.token != nil else { return }
        let items = cart.orderItems()
        do {
            let result = try await APIClient.shared.saveRemoteCart(items: items)
            print("[CartSync] push → PUT /v1/cart: \(items.count) items (saved: \(result.saved == true))")
        } catch {
            print("[CartSync] push failed: \(error.localizedDescription)")
        }
    }

    /// Called on every cart mutation; coalesces bursts of +/- taps.
    static func schedulePush(_ cart: CartStore) {
        guard SessionStore.token != nil else { return }
        pushTask?.cancel()
        pushTask = Task {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            guard !Task.isCancelled else { return }
            await pushNow(cart)
        }
    }

    // MARK: - Helpers

    private static func fetchProducts(ids: [String]) async -> [String: Product] {
        var products: [String: Product] = [:]
        var index = 0
        while index < ids.count {
            let chunk = Array(ids[index..<min(index + 60, ids.count)])
            index += 60
            if let page = try? await APIClient.shared.products(ids: chunk) {
                for product in page.items {
                    products[product.id] = product
                }
            }
        }
        return products
    }
}

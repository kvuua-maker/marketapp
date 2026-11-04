import Foundation

/// Two-way cart sync between all devices signed into the same Apple ID.
///
/// Rules:
///  * server has items, this device has none → pull
///  * this device has items, server has none → push
///  * both have items → merge by product id (max qty, capped by stock, no duplicates)
///
/// Order is important: the Apple session is verified first (GET /v1/profile),
/// and only then the cart is fetched, merged and pushed back.
@MainActor
enum CartSync {
    private static var pushTask: Task<Void, Never>?
    private static var mergeInFlight = false

    // MARK: - Merge (pull → merge → push)

    static func mergeRemoteIntoLocal(_ cart: CartStore) async {
        guard let token = SessionStore.token else {
            print("[CartSync] no Apple session (guest mode) — sync skipped")
            return
        }
        guard !mergeInFlight else {
            print("[CartSync] merge already running, skipping duplicate trigger")
            return
        }
        mergeInFlight = true
        defer { mergeInFlight = false }

        // 1. Verify the stored session before touching the cart.
        print("[CartSync] Auth token found (…\(token.suffix(6))), verifying with GET /v1/profile")
        do {
            let profile = try await APIClient.shared.remoteProfile()
            print("[CartSync] Auth token verified, starting sync... (phone: \(profile.phone ?? "—"))")
        } catch let error as APIError {
            print("[CartSync] token verification failed (HTTP \(error.status ?? -1)): \(error.message)")
            if error.status == 401 {
                print("[CartSync] session expired — sign in again to resume cross-device sync")
            }
            return
        } catch {
            print("[CartSync] token verification error: \(error.localizedDescription)")
            return
        }

        // 2. Pull the account cart (one retry for flaky mobile networks).
        var remote: RemoteCart?
        for attempt in 1...2 {
            do {
                remote = try await APIClient.shared.remoteCart()
                break
            } catch let error as APIError {
                print("[CartSync] pull failed (attempt \(attempt), HTTP \(error.status ?? -1)): \(error.message)")
                if error.status == 401 || attempt == 2 { return }
            } catch {
                print("[CartSync] pull failed (attempt \(attempt)): \(error.localizedDescription)")
                if attempt == 2 { return }
            }
            try? await Task.sleep(nanoseconds: 800_000_000)
        }
        guard let remote else { return }
        print("[CartSync] Fetched \(remote.items.count) items from server, local cart has \(cart.lines.count)")

        // The server keeps updatedAt: an empty cart WITH a timestamp means the
        // basket was cleared on purpose (order placed / items removed), so the
        // stale local copy must not be pushed back.
        if remote.items.isEmpty, remote.updatedAt != nil {
            if cart.isEmpty {
                print("[CartSync] server cart is empty (cleared) — local is empty too")
            } else {
                cart.replaceAll(with: [])
                print("[CartSync] server cart was cleared elsewhere (order placed) — local cart emptied")
            }
            return
        }

        // 3. Merge by product id.
        var orderedIds: [String] = []
        var seen = Set<String>()
        for item in cart.orderItems() where seen.insert(item.productId).inserted {
            orderedIds.append(item.productId)
        }
        for item in remote.items where seen.insert(item.productId).inserted {
            orderedIds.append(item.productId)
        }

        guard !orderedIds.isEmpty else {
            print("[CartSync] both carts are empty — nothing to merge")
            return
        }

        var localQty: [String: Int] = [:]
        for item in cart.orderItems() {
            localQty[item.productId] = max(localQty[item.productId] ?? 0, item.qty)
        }
        var remoteQty: [String: Int] = [:]
        for item in remote.items {
            remoteQty[item.productId] = max(remoteQty[item.productId] ?? 0, item.qty)
        }

        let products = await fetchProducts(ids: orderedIds)
        var merged: [(product: Product, qty: Int)] = []
        for id in orderedIds {
            guard let product = products[id], product.isAvailable else { continue }
            let qty = min(max(localQty[id] ?? 0, remoteQty[id] ?? 0), CartStore.maxQty(for: product))
            guard qty > 0 else { continue }
            merged.append((product, qty))
        }

        cart.replaceAll(with: merged)
        print("[CartSync] merged \(merged.count) items (max qty, capped by stock)")

        // 4. Push the merged basket back so every device converges.
        await pushNow(cart)
    }

    /// Pull-to-refresh entry point on the cart screen.
    static func refresh(_ cart: CartStore) async {
        print("[CartSync] manual refresh requested")
        await mergeRemoteIntoLocal(cart)
    }

    // MARK: - Push

    static func pushNow(_ cart: CartStore) async {
        guard SessionStore.token != nil else { return }
        let items = cart.orderItems()
        do {
            let result = try await APIClient.shared.saveRemoteCart(items: items)
            print("[CartSync] push → PUT /v1/cart: \(items.count) items (saved: \(result.saved == true))")
        } catch let error as APIError {
            print("[CartSync] push failed (HTTP \(error.status ?? -1)): \(error.message)")
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

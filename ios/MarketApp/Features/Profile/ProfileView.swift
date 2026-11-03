import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var profile: ProfileStore
    @EnvironmentObject private var favorites: FavoritesStore
    @EnvironmentObject private var cart: CartStore

    @State private var orders: [OrderSummary] = []
    @State private var favoriteProducts: [Product] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var notice: String?

    var body: some View {
        Form {
            Section {
                TextField("+380 XX XXX XX XX", text: $profile.phone)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
            } header: {
                Text("Мій номер")
            } footer: {
                Text(profile.isValidPhone
                     ? "За цим номером ми знаходимо ваші замовлення."
                     : "Вкажіть номер телефону, щоб побачити історію замовлень.")
            }

            if let notice {
                Section {
                    Text(notice).font(.footnote).foregroundStyle(.green)
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage).font(.footnote).foregroundStyle(.red)
                }
            }

            if profile.isValidPhone {
                Section("Мої замовлення") {
                    if isLoading {
                        HStack { ProgressView(); Text("Завантаження…").foregroundStyle(.secondary) }
                    } else if orders.isEmpty {
                        Text("Замовлень поки немає").foregroundStyle(.secondary)
                    } else {
                        ForEach(orders) { order in
                            orderRow(order)
                        }
                    }
                }
            }

            Section("Обране (\(favoriteProducts.count))") {
                if favoriteProducts.isEmpty {
                    Text("Додавайте товари сердечком у каталозі").foregroundStyle(.secondary)
                } else {
                    ForEach(favoriteProducts) { product in
                        NavigationLink(value: product) {
                            HStack(spacing: 10) {
                                CachedAsyncImage(url: APIClient.imageURL(product.imageUrl, width: 160))
                                    .frame(width: 44, height: 44)
                                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(product.title).font(.footnote).lineLimit(2)
                                    Text(Money.uah(cents: product.priceCents))
                                        .font(.caption.weight(.semibold))
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Профіль")
        .task { await refresh() }
        .onChange(of: profile.phone) { _, _ in
            Task { await loadOrders() }
        }
        .refreshable { await refresh() }
    }

    @ViewBuilder
    private func orderRow(_ order: OrderSummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(order.id).font(.caption.weight(.semibold))
                Spacer()
                Text(Money.uah(cents: order.totalCents)).font(.caption.weight(.bold))
            }
            Text(statusText(order.status))
                .font(.caption2)
                .foregroundStyle(.secondary)

            ForEach(order.items) { item in
                Text("\(item.qty) × \(item.title)")
                    .font(.caption2)
                    .lineLimit(1)
            }

            if let urlString = order.trackingUrl, let url = URL(string: urlString) {
                Link("ТТН \(order.ttn ?? "") — відстежити", destination: url)
                    .font(.caption2)
            }

            Button {
                reorder(order)
            } label: {
                Label("Повторити замовлення", systemImage: "arrow.clockwise")
                    .font(.caption.weight(.semibold))
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(.vertical, 4)
    }

    private func statusText(_ status: String) -> String {
        switch status {
        case "routed": return "Прийнято · передано постачальнику"
        case "routed_email": return "Прийнято · лист постачальнику"
        default: return status
        }
    }

    private func refresh() async {
        await loadOrders()
        await loadFavorites()
    }

    private func loadOrders() async {
        guard profile.isValidPhone else {
            orders = []
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            orders = try await APIClient.shared.orders(phone: profile.phone).items
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadFavorites() async {
        guard !favorites.ids.isEmpty else {
            favoriteProducts = []
            return
        }
        favoriteProducts = (try? await APIClient.shared.products(ids: Array(favorites.ids)).items) ?? []
    }

    private func reorder(_ order: OrderSummary) {
        Task { @MainActor in
            do {
                let list = try await APIClient.shared.products(ids: order.items.map(\.productId))
                guard !list.items.isEmpty else {
                    notice = "Товари з цього замовлення більше недоступні"
                    return
                }
                for product in list.items {
                    for _ in 0..<max(1, order.items.first(where: { $0.productId == product.id })?.qty ?? 1) {
                        cart.add(product)
                    }
                }
                notice = "Додано в кошик: \(list.items.count)"
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

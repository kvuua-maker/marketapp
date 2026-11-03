import SwiftUI

struct RootView: View {
    @StateObject private var cart = CartStore()
    @StateObject private var catalog = CatalogViewModel()
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                SplitRootView()
            } else {
                TabRootView()
            }
        }
        .environmentObject(cart)
        .environmentObject(catalog)
    }
}

/// iPad: full-screen NavigationSplitView with categories on the left.
struct SplitRootView: View {
    @EnvironmentObject private var catalog: CatalogViewModel

    private var selection: Binding<String?> {
        Binding(
            get: { catalog.selectedCategory },
            set: { catalog.selectCategory($0) }
        )
    }

    var body: some View {
        NavigationSplitView {
            List(selection: selection) {
                Label("Усі товари", systemImage: "square.grid.2x2")
                    .tag(String?.none)

                Section("Категорії") {
                    ForEach(catalog.categories) { category in
                        HStack(spacing: 8) {
                            Text(category.name)
                                .lineLimit(1)
                            Spacer(minLength: 4)
                            Text("\(category.count)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .tag(Optional(category.name))
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("MarketApp")
        } detail: {
            NavigationStack {
                CatalogView()
                    .navigationDestination(for: Product.self) { product in
                        ProductDetailView(product: product)
                    }
            }
        }
    }
}

/// iPhone: TabView with catalog and cart only (no admin, no payment screens).
struct TabRootView: View {
    @EnvironmentObject private var cart: CartStore

    var body: some View {
        TabView {
            NavigationStack {
                CatalogView()
                    .navigationDestination(for: Product.self) { product in
                        ProductDetailView(product: product)
                    }
            }
            .tabItem { Label("Каталог", systemImage: "square.grid.2x2") }

            NavigationStack {
                CartView()
            }
            .tabItem { Label("Кошик", systemImage: "cart") }
            .badge(cart.count)
        }
    }
}

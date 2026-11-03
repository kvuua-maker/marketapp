import SwiftUI
import UIKit

struct RootView: View {
    @StateObject private var cart = CartStore()
    @StateObject private var catalog = CatalogViewModel()
    @StateObject private var favorites = FavoritesStore()
    @StateObject private var profile = ProfileStore()

    /// Universal app: the device decides the shell, not the size class.
    private var isPad: Bool {
        UIDevice.current.userInterfaceIdiom == .pad
    }

    var body: some View {
        Group {
            if isPad {
                SplitRootView()
            } else {
                TabRootView()
            }
        }
        .environmentObject(cart)
        .environmentObject(catalog)
        .environmentObject(favorites)
        .environmentObject(profile)
    }
}

enum SidebarItem: Hashable {
    case all
    case cart
    case profile
    case category(String)
}

/// iPad: full-screen NavigationSplitView with a persistent sidebar.
struct SplitRootView: View {
    @EnvironmentObject private var catalog: CatalogViewModel
    @EnvironmentObject private var cart: CartStore

    @State private var selection: SidebarItem? = .all

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Label("Усі товари", systemImage: "square.grid.2x2")
                    .tag(SidebarItem.all)

                Label("Кошик", systemImage: "cart")
                    .badge(cart.count)
                    .tag(SidebarItem.cart)

                Label("Профіль", systemImage: "person.crop.circle")
                    .tag(SidebarItem.profile)

                Section("Категорії") {
                    ForEach(catalog.categories) { category in
                        HStack(spacing: 8) {
                            Text(category.name).lineLimit(1)
                            Spacer(minLength: 4)
                            Text("\(category.count)")
                                .font(.caption)
                                .monospacedDigit()
                                .foregroundStyle(.secondary)
                        }
                        .tag(SidebarItem.category(category.name))
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("MarketApp")
            .navigationSplitViewColumnWidth(min: 240, ideal: 300, max: 360)
        } detail: {
            NavigationStack {
                Group {
                    switch selection ?? .all {
                    case .cart:
                        CartView()
                    case .profile:
                        ProfileView()
                    case .category(_), .all:
                        CatalogView()
                    }
                }
                // Must live INSIDE the stack — otherwise NavigationLink does nothing (iPad bug).
                .navigationDestination(for: Product.self) { product in
                    ProductDetailView(product: product)
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
        .onChange(of: selection) { _, newValue in
            switch newValue ?? .all {
            case .category(let name):
                catalog.selectCategory(name)
            case .all:
                catalog.selectCategory(nil)
            case .cart, .profile:
                break
            }
        }
        .task { await catalog.bootstrap() }
    }
}

/// iPhone: bottom TabView — catalog, cart, profile.
struct TabRootView: View {
    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var favorites: FavoritesStore

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

            NavigationStack {
                ProfileView()
                    .navigationDestination(for: Product.self) { product in
                        ProductDetailView(product: product)
                    }
            }
            .tabItem { Label("Профіль", systemImage: "person.crop.circle") }
            .badge(favorites.count)
        }
    }
}

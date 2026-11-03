import SwiftUI
import UIKit

struct RootView: View {
    @StateObject private var cart = CartStore()
    @StateObject private var catalog = CatalogViewModel()

    /// Universal app: the device decides the shell, not the size class.
    /// iPhone keeps TabView even in landscape (wide iPhone would otherwise
    /// report a regular size class and "turn into" an iPad layout).
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
    }
}

enum SidebarItem: Hashable {
    case all
    case cart
    case category(String)
}

/// iPad: full-screen NavigationSplitView with a persistent sidebar.
/// The catalog always occupies the whole detail area — no floating windows,
/// no iPhone-sized column in the middle of the screen.
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

                Section("Категорії") {
                    ForEach(catalog.categories) { category in
                        HStack(spacing: 8) {
                            Text(category.name)
                                .lineLimit(1)
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
                switch selection ?? .all {
                case .cart:
                    CartView()
                case .category(_), .all:
                    CatalogView()
                }
            }
            .navigationDestination(for: Product.self) { product in
                ProductDetailView(product: product)
            }
        }
        .navigationSplitViewStyle(.balanced)
        .onChange(of: selection) { _, newValue in
            switch newValue ?? .all {
            case .category(let name):
                catalog.selectCategory(name)
            case .all:
                catalog.selectCategory(nil)
            case .cart:
                break
            }
        }
        .task { await catalog.bootstrap() }
    }
}

/// iPhone: standard bottom TabView with catalog and cart only.
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

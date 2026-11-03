import SwiftUI
import UIKit

/// Shared navigation state so buttons like "Перейти до каталогу" really work.
@MainActor
final class AppRouter: ObservableObject {
    enum Tab: Hashable {
        case catalog
        case cart
        case profile
    }

    @Published var tab: Tab = .catalog
    @Published var sidebar: SidebarItem? = .all

    func goToCatalog() {
        tab = .catalog
        sidebar = .all
    }
}

enum SidebarItem: Hashable {
    case all
    case cart
    case profile
    case category(String)
}

struct RootView: View {
    @StateObject private var cart = CartStore()
    @StateObject private var catalog = CatalogViewModel()
    @StateObject private var favorites = FavoritesStore()
    @StateObject private var profile = ProfileStore()
    @StateObject private var router = AppRouter()

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
        .environmentObject(router)
        .preferredColorScheme(profile.theme.colorScheme)
    }
}

/// iPad: full-screen NavigationSplitView.
struct SplitRootView: View {
    @EnvironmentObject private var catalog: CatalogViewModel
    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var router: AppRouter

    var body: some View {
        NavigationSplitView {
            List(selection: $router.sidebar) {
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
                    switch router.sidebar ?? .all {
                    case .cart:
                        CartView()
                    case .profile:
                        ProfileView()
                    case .category(_), .all:
                        CatalogView()
                    }
                }
                .navigationDestination(for: Product.self) { product in
                    ProductDetailView(product: product)
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
        .onChange(of: router.sidebar) { _, newValue in
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

/// iPhone: TabView (catalog, cart, profile).
struct TabRootView: View {
    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var favorites: FavoritesStore
    @EnvironmentObject private var router: AppRouter

    var body: some View {
        TabView(selection: $router.tab) {
            NavigationStack {
                CatalogView()
                    .navigationDestination(for: Product.self) { product in
                        ProductDetailView(product: product)
                    }
            }
            .tabItem { Label("Каталог", systemImage: "square.grid.2x2") }
            .tag(AppRouter.Tab.catalog)

            NavigationStack {
                CartView()
            }
            .tabItem { Label("Кошик", systemImage: "cart") }
            .badge(cart.count)
            .tag(AppRouter.Tab.cart)

            NavigationStack {
                ProfileView()
                    .navigationDestination(for: Product.self) { product in
                        ProductDetailView(product: product)
                    }
            }
            .tabItem { Label("Профіль", systemImage: "person.crop.circle") }
            .badge(favorites.count)
            .tag(AppRouter.Tab.profile)
        }
    }
}

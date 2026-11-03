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

    /// Single entry point so chips, sidebar and reset always agree.
    func selectCategory(_ name: String?) {
        sidebar = name.map(SidebarItem.category) ?? .all
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
        // Single source of truth: any sidebar change (buttons, chips, reset,
        // "go to catalog") drives the catalog exactly once.
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
    }
}

/// iPad: full-screen NavigationSplitView.
struct SplitRootView: View {
    @EnvironmentObject private var catalog: CatalogViewModel
    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var router: AppRouter

    @State private var detailPath = NavigationPath()

    var body: some View {
        NavigationSplitView {
            List {
                Button {
                    router.sidebar = .all
                } label: {
                    sidebarRow(icon: "square.grid.2x2", title: "Усі товари", selected: router.sidebar == .all)
                }
                .buttonStyle(.plain)

                Button {
                    router.sidebar = .cart
                } label: {
                    sidebarRow(icon: "cart", title: "Кошик", selected: router.sidebar == .cart, badge: cart.count)
                }
                .buttonStyle(.plain)

                Button {
                    router.sidebar = .profile
                } label: {
                    sidebarRow(icon: "person.crop.circle", title: "Профіль", selected: router.sidebar == .profile)
                }
                .buttonStyle(.plain)

                Section("Категорії") {
                    ForEach(catalog.categories) { category in
                        Button {
                            router.sidebar = .category(category.name)
                        } label: {
                            sidebarRow(
                                title: category.name,
                                selected: router.sidebar == .category(category.name),
                                count: category.count
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("MarketApp")
            .navigationSplitViewColumnWidth(min: 240, ideal: 300, max: 360)
        } detail: {
            NavigationStack(path: $detailPath) {
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
        // Tapping a category / cart / profile must land on the root screen,
        // never on top of a product card that is still pushed.
        .onChange(of: router.sidebar) { _, _ in
            detailPath = NavigationPath()
        }
        .task { await catalog.loadShell() }
    }

    /// Full-width, explicit hit area — the reason sidebar taps were dead on iPad.
    private func sidebarRow(
        icon: String? = nil,
        title: String,
        selected: Bool,
        count: Int? = nil,
        badge: Int? = nil
    ) -> some View {
        HStack(spacing: 8) {
            if let icon {
                Image(systemName: icon)
                    .frame(width: 22)
            }
            Text(title)
                .lineLimit(1)
            Spacer(minLength: 6)
            if let badge, badge > 0 {
                Text("\(badge)")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.red, in: Capsule())
            }
            if let count {
                Text("\(count)")
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .background(
            selected ? Theme.accent.opacity(0.16) : Color.clear,
            in: RoundedRectangle(cornerRadius: 8, style: .continuous)
        )
    }
}

/// iPhone: TabView (catalog, cart, profile).
struct TabRootView: View {
    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var favorites: FavoritesStore
    @EnvironmentObject private var router: AppRouter

    @State private var catalogPath = NavigationPath()
    @State private var cartPath = NavigationPath()
    @State private var profilePath = NavigationPath()

    var body: some View {
        TabView(selection: $router.tab) {
            NavigationStack(path: $catalogPath) {
                CatalogView()
                    .navigationDestination(for: Product.self) { product in
                        ProductDetailView(product: product)
                    }
            }
            .tabItem { Label("Каталог", systemImage: "square.grid.2x2") }
            .tag(AppRouter.Tab.catalog)

            NavigationStack(path: $cartPath) {
                CartView()
            }
            .tabItem { Label("Кошик", systemImage: "cart") }
            .badge(cart.count)
            .tag(AppRouter.Tab.cart)

            NavigationStack(path: $profilePath) {
                ProfileView()
                    .navigationDestination(for: Product.self) { product in
                        ProductDetailView(product: product)
                    }
            }
            .tabItem { Label("Профіль", systemImage: "person.crop.circle") }
            .badge(favorites.count)
            .tag(AppRouter.Tab.profile)
        }
        .onChange(of: router.tab) { _, _ in
            catalogPath = NavigationPath()
            cartPath = NavigationPath()
            profilePath = NavigationPath()
        }
    }
}

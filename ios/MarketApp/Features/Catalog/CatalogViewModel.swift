import Foundation

enum SortOption: String, CaseIterable, Identifiable {
    case relevance
    case priceAsc = "price_asc"
    case priceDesc = "price_desc"
    case newest = "new"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .relevance: return "За релевантністю"
        case .priceAsc: return "Від дешевих"
        case .priceDesc: return "Від дорогих"
        case .newest: return "Новинки"
        }
    }
}

@MainActor
final class CatalogViewModel: ObservableObject {
    @Published private(set) var products: [Product] = []
    @Published private(set) var categories: [CategoryCount] = []
    @Published private(set) var promotions: [Product] = []
    @Published private(set) var total = 0
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published var selectedCategory: String?
    @Published var searchText = ""
    @Published var sort: SortOption = .relevance
    @Published var includeOutOfStock = false
    @Published var errorMessage: String?

    private let pageSize = 24
    private var offset = 0
    private var hasMore = true
    private var searchTask: Task<Void, Never>?

    /// True while the very first page is loading (drives the skeleton grid).
    var isInitialLoading: Bool { isLoading && products.isEmpty }

    func bootstrap() async {
        if categories.isEmpty { await loadCategories() }
        if promotions.isEmpty { await loadPromotions() }
        if products.isEmpty && errorMessage == nil { await reload() }
    }

    func loadCategories() async {
        do {
            categories = try await APIClient.shared.categories().items
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadPromotions() async {
        promotions = (try? await APIClient.shared.promotions(limit: 8))?.items ?? []
    }

    func reload() async {
        offset = 0
        hasMore = true
        await loadPage(replace: true)
    }

    func loadPage(replace: Bool = false) async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            let page = try await APIClient.shared.products(
                category: selectedCategory,
                query: searchText,
                sort: sort == .relevance && searchText.isEmpty ? "new" : sort.rawValue,
                includeOutOfStock: includeOutOfStock,
                offset: replace ? 0 : offset,
                limit: pageSize
            )
            if replace {
                products = page.items
                offset = page.items.count
            } else {
                products.append(contentsOf: page.items)
                offset += page.items.count
            }
            total = page.total
            hasMore = offset < page.total && !page.items.isEmpty
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadMore(after product: Product) async {
        guard hasMore, !isLoading, !isLoadingMore, product.id == products.last?.id else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        await loadPage(replace: false)
    }

    func selectCategory(_ name: String?) {
        guard selectedCategory != name else { return }
        selectedCategory = name
        Task { await reload() }
    }

    func applySort(_ option: SortOption) {
        guard sort != option else { return }
        sort = option
        Task { await reload() }
    }

    func toggleOutOfStock() {
        includeOutOfStock.toggle()
        Task { await reload() }
    }

    func searchChanged() {
        searchTask?.cancel()
        searchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            await self?.reload()
        }
    }
}

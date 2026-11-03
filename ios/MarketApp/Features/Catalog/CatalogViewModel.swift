import Foundation

@MainActor
final class CatalogViewModel: ObservableObject {
    @Published private(set) var products: [Product] = []
    @Published private(set) var categories: [CategoryCount] = []
    @Published private(set) var total = 0
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published var selectedCategory: String?
    @Published var searchText = ""
    @Published var errorMessage: String?

    private let pageSize = 24
    private var offset = 0
    private var hasMore = true
    private var searchTask: Task<Void, Never>?

    func bootstrap() async {
        if categories.isEmpty { await loadCategories() }
        if products.isEmpty && errorMessage == nil { await reload() }
    }

    func loadCategories() async {
        do {
            categories = try await APIClient.shared.categories().items
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func reload() async {
        offset = 0
        hasMore = true
        products = []
        total = 0
        await loadPage()
    }

    func loadPage() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            let page = try await APIClient.shared.products(
                category: selectedCategory,
                query: searchText,
                offset: offset,
                limit: pageSize
            )
            if offset == 0 {
                products = page.items
            } else {
                products.append(contentsOf: page.items)
            }
            total = page.total
            offset += page.items.count
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
        await loadPage()
    }

    func selectCategory(_ name: String?) {
        guard selectedCategory != name else { return }
        selectedCategory = name
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

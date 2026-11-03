import Foundation

@MainActor
final class CatalogViewModel: ObservableObject {
    @Published private(set) var products: [Product] = []
    @Published private(set) var categories: [CategoryCount] = []
    @Published private(set) var promotions: [Product] = []
    @Published private(set) var total = 0
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var suggestions: [Suggestion] = []

    @Published var selectedCategory: String?
    @Published var searchText = ""
    @Published var sort: SortOption = .relevance
    @Published var errorMessage: String?

    // Applied filters
    @Published var onlyInStock = true
    @Published var minPriceCents: Int?
    @Published var maxPriceCents: Int?
    @Published var selectedBrands: Set<String> = []

    @Published private(set) var filterOptions: FilterOptions?

    private let pageSize = 24
    private var offset = 0
    private var hasMore = true
    private var searchTask: Task<Void, Never>?
    private var suggestionTask: Task<Void, Never>?

    var isInitialLoading: Bool { isLoading && products.isEmpty }

    var activeFilterCount: Int {
        var count = 0
        if minPriceCents != nil || maxPriceCents != nil { count += 1 }
        if !selectedBrands.isEmpty { count += 1 }
        if !onlyInStock { count += 1 }
        return count
    }

    private var effectiveSort: String {
        sort == .relevance && searchText.isEmpty ? "new" : sort.rawValue
    }

    // MARK: - Loading

    func bootstrap() async {
        if categories.isEmpty { await loadCategories() }
        if promotions.isEmpty { await loadPromotions() }
        if filterOptions == nil { filterOptions = try? await APIClient.shared.filters() }
        if products.isEmpty && errorMessage == nil { await reload() }
    }

    func loadCategories() async {
        categories = (try? await APIClient.shared.categories())?.items ?? []
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

        let query = ProductQuery(
            category: selectedCategory,
            search: searchText,
            sort: effectiveSort,
            includeOutOfStock: !onlyInStock,
            onlyInStock: onlyInStock,
            minPriceCents: minPriceCents,
            maxPriceCents: maxPriceCents,
            brands: Array(selectedBrands),
            offset: replace ? 0 : offset,
            limit: pageSize
        )

        do {
            let page = try await APIClient.shared.products(query)
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

    func loadMoreIfNeeded() async {
        guard hasMore, !isLoading, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        await loadPage(replace: false)
    }

    // MARK: - Actions

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

    func applyFilters(min: Int?, max: Int?, brands: Set<String>, onlyInStock: Bool) {
        minPriceCents = min
        maxPriceCents = max
        selectedBrands = brands
        self.onlyInStock = onlyInStock
        Task { await reload() }
    }

    func showOutOfStock(_ show: Bool) {
        let newValue = !show
        guard onlyInStock != newValue else { return }
        onlyInStock = newValue
        Task { await reload() }
    }

    func resetFilters() {
        selectedCategory = nil
        searchText = ""
        minPriceCents = nil
        maxPriceCents = nil
        selectedBrands = []
        onlyInStock = true
        sort = .relevance
        suggestions = []
        Task { await reload() }
    }

    // MARK: - Search

    func searchChanged() {
        searchTask?.cancel()
        suggestionTask?.cancel()

        suggestionTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await self?.loadSuggestions()
        }

        searchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await self?.reload()
        }
    }

    func loadSuggestions() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2 else {
            suggestions = []
            return
        }
        suggestions = (try? await APIClient.shared.suggest(query))?.items ?? []
    }

    func clearSuggestions() {
        suggestions = []
    }

    func applySuggestion(_ suggestion: Suggestion) {
        switch suggestion.type {
        case "brand":
            selectedBrands = [suggestion.title]
            searchText = ""
            suggestions = []
        case "category":
            selectedCategory = suggestion.title
            searchText = ""
            suggestions = []
        default:
            searchText = suggestion.title
            suggestions = []
        }
        Task { await reload() }
    }
}

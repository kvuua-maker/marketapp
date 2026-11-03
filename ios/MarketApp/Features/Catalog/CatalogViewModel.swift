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
    private var shellTask: Task<Void, Never>?

    /// In-flight page request + token so a newer request always wins.
    private var activeLoad: Task<ProductPage, Error>?
    private var loadToken = 0

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

    // MARK: - Bootstrap (single flight)

    /// Categories + promotions are needed by the iPad sidebar even when the
    /// catalog itself is not on screen.
    func loadShell() async {
        if let existing = shellTask {
            await existing.value
            return
        }
        if !categories.isEmpty && !promotions.isEmpty { return }

        let task = Task { [weak self] in
            guard let self else { return }
            if self.categories.isEmpty { await self.loadCategories() }
            if self.promotions.isEmpty { await self.loadPromotions() }
        }
        shellTask = task
        await task.value
        shellTask = nil
    }

    func loadCatalogIfNeeded() async {
        if filterOptions == nil {
            filterOptions = try? await APIClient.shared.filters()
        }
        if products.isEmpty && errorMessage == nil {
            await reload()
        }
    }

    func loadCategories() async {
        categories = (try? await APIClient.shared.categories())?.items ?? []
    }

    func loadPromotions() async {
        promotions = (try? await APIClient.shared.promotions(limit: 8))?.items ?? []
    }

    // MARK: - Loading (cancel → restart)

    func reload() async {
        offset = 0
        hasMore = true
        await loadPage(replace: true)
    }

    func loadPage(replace: Bool = false) async {
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

        // A new request always supersedes the previous one instead of being dropped.
        loadToken += 1
        let token = loadToken
        activeLoad?.cancel()
        let task = Task { try await APIClient.shared.products(query) }
        activeLoad = task
        isLoading = true

        do {
            let page = try await task.value
            guard token == loadToken else { return }
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
        } catch is CancellationError {
            return
        } catch {
            guard token == loadToken else { return }
            errorMessage = error.localizedDescription
        }

        if token == loadToken { isLoading = false }
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

    /// Clears everything except the category (which is owned by AppRouter).
    func resetFilters() {
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
        default:
            searchText = suggestion.title
        }
        suggestions = []
        Task { await reload() }
    }
}

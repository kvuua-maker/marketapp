import SwiftUI
import UIKit

struct CatalogView: View {
    @EnvironmentObject private var catalog: CatalogViewModel
    @EnvironmentObject private var cart: CartStore

    @State private var contentWidth: CGFloat = 0
    @State private var showFilters = false
    @FocusState private var searchFocused: Bool

    private var columnCount: Int {
        switch contentWidth {
        case 1000...: return 5
        case 760..<1000: return 4
        case 560..<760: return 3
        default: return 2
        }
    }

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: Theme.gridSpacing), count: columnCount)
    }

    private var imageHeight: CGFloat {
        columnCount >= 4 ? 165 : 175
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            if searchFocused && !catalog.suggestions.isEmpty {
                SuggestionList(suggestions: catalog.suggestions) { suggestion in
                    searchFocused = false
                    catalog.applySuggestion(suggestion)
                }
                .padding(.top, 6)
            }

            ScrollView {
                VStack(spacing: 10) {
                    CategoryChips(
                        categories: catalog.categories,
                        selected: catalog.selectedCategory
                    ) { catalog.selectCategory($0) }
                    .padding(.top, 10)

                    PromoBanner(items: catalog.promotions)

                    if catalog.activeFilterCount > 0 {
                        activeFiltersBar
                    }

                    grid
                    footer
                }
                .padding(.bottom, 24)
                .background(
                    GeometryReader { proxy in
                        Color.clear.preference(key: CatalogWidthKey.self, value: proxy.size.width)
                    }
                )
            }
            .refreshable { await catalog.reload() }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("MarketApp")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(UIDevice.current.userInterfaceIdiom == .pad ? .visible : .hidden, for: .navigationBar)
        .onPreferenceChange(CatalogWidthKey.self) { width in
            if width > 0 { contentWidth = width }
        }
        .onChange(of: catalog.searchText) { _, _ in catalog.searchChanged() }
        .onChange(of: searchFocused) { _, focused in
            if !focused { catalog.clearSuggestions() }
        }
        .sheet(isPresented: $showFilters) {
            FiltersSheet(options: catalog.filterOptions)
        }
        .task { await catalog.bootstrap() }
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 10) {
            if UIDevice.current.userInterfaceIdiom != .pad {
                HStack {
                    Text("MarketApp")
                        .font(.title3.bold())
                        .foregroundStyle(Theme.accent)

                    Spacer()

                    NavigationLink {
                    CartView()
                } label: {
                    Image(systemName: "cart")
                        .font(.title3)
                        .overlay(alignment: .topTrailing) {
                            if cart.count > 0 {
                                Text("\(cart.count)")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 1)
                                    .background(.red, in: Capsule())
                                        .offset(x: 10, y: -8)
                                }
                            }
                    }
                    .buttonStyle(.plain)
                }
            }

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)

                TextField("Пошук товарів", text: $catalog.searchText)
                    .focused($searchFocused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .onSubmit { searchFocused = false }

                if !catalog.searchText.isEmpty {
                    Button {
                        catalog.searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }

                Menu {
                    Picker("Сортування", selection: Binding(
                        get: { catalog.sort },
                        set: { catalog.applySort($0) }
                    )) {
                        ForEach(SortOption.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                        .foregroundStyle(.secondary)
                }

                Button {
                    searchFocused = false
                    showFilters = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                        .foregroundStyle(catalog.activeFilterCount > 0 ? Theme.accent : .secondary)
                        .overlay(alignment: .topTrailing) {
                            if catalog.activeFilterCount > 0 {
                                Circle()
                                    .fill(.red)
                                    .frame(width: 7, height: 7)
                                    .offset(x: 4, y: -2)
                            }
                        }
                }
                .buttonStyle(.plain)
            }
            .padding(10)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .padding(.horizontal, Theme.screenPadding)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .background(.bar)
    }

    private var activeFiltersBar: some View {
        HStack {
            Text("Активні фільтри: \(catalog.activeFilterCount)")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Button("Скинути") {
                catalog.resetFilters()
            }
            .font(.caption.weight(.semibold))
        }
        .padding(.horizontal, Theme.screenPadding)
    }

    // MARK: - Grid

    private var grid: some View {
        LazyVGrid(columns: columns, spacing: Theme.gridSpacing) {
            if catalog.isInitialLoading {
                ForEach(0..<8, id: \.self) { _ in
                    SkeletonTile(imageHeight: imageHeight)
                }
            } else {
                ForEach(catalog.products) { product in
                    ProductTile(product: product, imageHeight: imageHeight)
                }
            }
        }
        .padding(.horizontal, Theme.screenPadding)
    }

    @ViewBuilder
    private var footer: some View {
        if catalog.isLoadingMore {
            ProgressView().padding(.vertical, 16)
        } else if !catalog.products.isEmpty {
            Color.clear
                .frame(height: 2)
                .onAppear {
                    Task { await catalog.loadMoreIfNeeded() }
                }
        } else if !catalog.isLoading, catalog.errorMessage == nil {
            EmptyStateView(
                title: "Нічого не знайдено",
                systemImage: "magnifyingglass",
                message: "Спробуйте змінити запит або скинути фільтри.",
                actionTitle: "Скинути фільтри",
                action: { catalog.resetFilters() }
            )
        }
    }
}

private struct CatalogWidthKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

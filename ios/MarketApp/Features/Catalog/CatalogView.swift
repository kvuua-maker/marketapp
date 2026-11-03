import SwiftUI

private struct ContentWidthKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

struct CatalogView: View {
    @EnvironmentObject private var catalog: CatalogViewModel
    @State private var contentWidth: CGFloat = 0

    /// iPad gets a desktop-grade grid: 4–5 columns across the full screen.
    /// iPhone stays at 2 columns.
    private var columnCount: Int {
        switch contentWidth {
        case 1000...: return 5
        case 800..<1000: return 4
        case 600..<800: return 3
        default: return 2
        }
    }

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 16), count: columnCount)
    }

    private var imageHeight: CGFloat {
        switch columnCount {
        case 5: return 165
        case 4: return 180
        case 3: return 190
        default: return 150
        }
    }

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(catalog.products) { product in
                    NavigationLink(value: product) {
                        ProductCard(product: product, imageHeight: imageHeight)
                    }
                    .buttonStyle(.plain)
                    .task { await catalog.loadMore(after: product) }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(
                GeometryReader { proxy in
                    Color.clear.preference(key: ContentWidthKey.self, value: proxy.size.width)
                }
            )

            if catalog.isLoadingMore {
                ProgressView()
                    .padding(.bottom, 24)
            }
        }
        .background(Color(.systemGroupedBackground))
        .onPreferenceChange(ContentWidthKey.self) { width in
            if width > 0 { contentWidth = width }
        }
        .navigationTitle(catalog.selectedCategory ?? "Каталог")
        .navigationBarTitleDisplayMode(.automatic)
        .searchable(text: $catalog.searchText, prompt: "Пошук товарів")
        .onChange(of: catalog.searchText) { _, _ in
            catalog.searchChanged()
        }
        .refreshable {
            await catalog.reload()
        }
        .overlay { emptyState }
        .task { await catalog.bootstrap() }
    }

    @ViewBuilder
    private var emptyState: some View {
        if catalog.isLoading && catalog.products.isEmpty {
            ProgressView("Завантаження…")
        } else if let error = catalog.errorMessage, catalog.products.isEmpty {
            VStack(spacing: 12) {
                ContentUnavailableView(
                    "Немає звʼязку із сервером",
                    systemImage: "wifi.exclamationmark",
                    description: Text(error)
                )
                Button("Спробувати ще") {
                    Task { await catalog.reload() }
                }
                .buttonStyle(.borderedProminent)
            }
        } else if catalog.products.isEmpty {
            ContentUnavailableView(
                "Нічого не знайдено",
                systemImage: "magnifyingglass",
                description: Text("Спробуйте інший запит або категорію")
            )
        }
    }
}

import SwiftUI

struct CatalogView: View {
    @EnvironmentObject private var catalog: CatalogViewModel
    @State private var contentWidth: CGFloat = 0

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
        case 5: return 150
        case 4: return 165
        case 3: return 180
        default: return 150
        }
    }

    var body: some View {
        ScrollView {
            if catalog.searchText.isEmpty && catalog.selectedCategory == nil {
                PromotionsBanner(items: catalog.promotions)
            }

            LazyVGrid(columns: columns, spacing: 16) {
                if catalog.isInitialLoading {
                    ForEach(0..<8, id: \.self) { _ in
                        SkeletonCard(imageHeight: imageHeight)
                    }
                } else {
                    ForEach(catalog.products) { product in
                        ProductCard(product: product, imageHeight: imageHeight)
                            .task { await catalog.loadMore(after: product) }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(
                GeometryReader { proxy in
                    Color.clear.preference(key: CatalogWidthKey.self, value: proxy.size.width)
                }
            )

            if catalog.isLoadingMore {
                ProgressView().padding(.bottom, 24)
            }
        }
        .background(Color(.systemGroupedBackground))
        .onPreferenceChange(CatalogWidthKey.self) { width in
            if width > 0 { contentWidth = width }
        }
        .navigationTitle(catalog.selectedCategory ?? "Каталог")
        .navigationBarTitleDisplayMode(.automatic)
        .searchable(text: $catalog.searchText, prompt: "Пошук: назва, бренд, опис")
        .onChange(of: catalog.searchText) { _, _ in catalog.searchChanged() }
        .refreshable { await catalog.reload() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker(
                        "Сортування",
                        selection: Binding(
                            get: { catalog.sort },
                            set: { catalog.applySort($0) }
                        )
                    ) {
                        ForEach(SortOption.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }

                    Toggle(
                        "Показати все (з відсутніми)",
                        isOn: Binding(
                            get: { catalog.includeOutOfStock },
                            set: { _ in catalog.toggleOutOfStock() }
                        )
                    )
                } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                }
            }
        }
        .overlay { overlayState }
        .task { await catalog.bootstrap() }
    }

    @ViewBuilder
    private var overlayState: some View {
        if let error = catalog.errorMessage, catalog.products.isEmpty {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Label("Немає звʼязку із сервером", systemImage: "wifi.exclamationmark")
                        .font(.headline)

                    Text(error)
                        .font(.system(.footnote, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

                    Text("Build \(Bundle.main.buildNumber) · \(AppConfig.baseURL.absoluteString)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    Button("Спробувати ще") {
                        Task { await catalog.reload() }
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(20)
                .frame(maxWidth: 560, alignment: .leading)
            }
        } else if !catalog.isLoading && catalog.products.isEmpty {
            ContentUnavailableView(
                "Нічого не знайдено",
                systemImage: "magnifyingglass",
                description: Text("Спробуйте інший запит або увімкніть «Показати все»")
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

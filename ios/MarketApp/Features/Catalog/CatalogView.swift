import SwiftUI

struct CatalogView: View {
    @EnvironmentObject private var catalog: CatalogViewModel

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: 14)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 14) {
                ForEach(catalog.products) { product in
                    NavigationLink(value: product) {
                        ProductCard(product: product)
                    }
                    .buttonStyle(.plain)
                    .task { await catalog.loadMore(after: product) }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)

            if catalog.isLoadingMore {
                ProgressView()
                    .padding(.bottom, 24)
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(catalog.selectedCategory ?? "Каталог")
        .navigationBarTitleDisplayMode(.inline)
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

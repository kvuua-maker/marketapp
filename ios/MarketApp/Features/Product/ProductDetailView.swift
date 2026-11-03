import SwiftUI

struct ProductDetailView: View {
    let product: Product

    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var favorites: FavoritesStore

    @State private var detail: ProductDetail?
    @State private var similar: [Product] = []
    @State private var pageIndex = 0
    @State private var showGallery = false
    @State private var showReviewSheet = false
    @State private var descriptionExpanded = false

    private var images: [String] {
        let list = (detail?.images ?? product.images).filter { !$0.isEmpty }
        return list.isEmpty ? [product.imageUrl] : list
    }

    private var displayTitle: String { detail?.title ?? product.title }
    private var stock: Int { detail?.stock ?? product.stock }
    private var priceCents: Int { detail?.priceCents ?? product.priceCents }
    private var oldPriceCents: Int? { detail?.oldPriceCents ?? product.oldPriceCents }
    private var rating: Double { detail?.rating ?? product.rating }
    private var ratingCount: Int { detail?.ratingCount ?? product.ratingCount }
    private var description: String { detail?.description ?? product.shortDescription }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                gallery

                VStack(alignment: .leading, spacing: 10) {
                    Text(displayTitle)
                        .font(.title3.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)

                    HStack(spacing: 6) {
                        if ratingCount > 0 {
                            ForEach(0..<5, id: \.self) { index in
                                Image(systemName: Double(index) < rating.rounded() ? "star.fill" : "star")
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                            }
                            Text(String(format: "%.1f", rating))
                                .font(.caption.weight(.semibold))
                            Text("(\(ratingCount))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("Немає відгуків")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }

                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(Money.uah(cents: priceCents))
                            .font(.title2.bold())
                        if let old = oldPriceCents, old > priceCents {
                            Text(Money.uah(cents: old))
                                .font(.subheadline)
                                .strikethrough()
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        availability
                    }
                }

                if !description.isEmpty {
                    descriptionBlock
                }

                specsBlock
                deliveryNote

                if !similar.isEmpty {
                    similarRail
                }

                ReviewsSection(productId: product.id, showSheet: $showReviewSheet)
            }
            .padding(Theme.screenPadding)
        }
        .background(Color(.systemBackground))
        .safeAreaInset(edge: .bottom) { bottomBar }
        .navigationTitle("Товар")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            Analytics.track("product_view", productId: product.id)

            if let cached = ProductDetailCache.shared.value(for: product.id) {
                detail = cached
            } else if let loaded = try? await APIClient.shared.productDetail(id: product.id) {
                detail = loaded
                ProductDetailCache.shared.insert(loaded)
            }

            similar = (try? await APIClient.shared.similar(id: product.id))?.items ?? []
        }
        .fullScreenCover(isPresented: $showGallery) {
            ImageGalleryView(images: images, startIndex: pageIndex)
        }
        .sheet(isPresented: $showReviewSheet) {
            ReviewComposer(productId: product.id, productTitle: displayTitle)
        }
    }

    // MARK: - Gallery

    private var gallery: some View {
        VStack(spacing: 8) {
            TabView(selection: $pageIndex) {
                ForEach(images.indices, id: \.self) { index in
                    CachedAsyncImage(url: APIClient.imageURL(images[index], width: 900), contentMode: .fit)
                        .frame(maxWidth: .infinity)
                        .tag(index)
                        .onTapGesture { showGallery = true }
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .frame(height: 330)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(alignment: .bottom) {
                if images.count > 1 {
                    HStack(spacing: 6) {
                        ForEach(images.indices, id: \.self) { index in
                            Circle()
                                .fill(index == pageIndex ? Theme.accent : Color.secondary.opacity(0.35))
                                .frame(width: 7, height: 7)
                        }
                    }
                    .padding(.bottom, 10)
                }
            }

            if images.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(images.indices.prefix(8)), id: \.self) { index in
                            CachedAsyncImage(url: APIClient.imageURL(images[index], width: 200))
                                .frame(width: 56, height: 56)
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .strokeBorder(index == pageIndex ? Theme.accent : Color.clear, lineWidth: 2)
                                )
                                .onTapGesture { pageIndex = index }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Blocks

    private var availability: some View {
        Group {
            if stock > 0 {
                Label("В наявності", systemImage: "checkmark.circle.fill")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.green)
            } else {
                Label("Немає в наявності", systemImage: "xmark.circle")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var descriptionBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(description)
                .font(.callout)
                .lineLimit(descriptionExpanded ? nil : 5)
                .fixedSize(horizontal: false, vertical: descriptionExpanded)

            Button(descriptionExpanded ? "Згорнути" : "Показати більше") {
                withAnimation(.easeInOut(duration: 0.2)) {
                    descriptionExpanded.toggle()
                }
            }
            .font(.footnote.weight(.semibold))
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface()
    }

    private var specsBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Характеристики")
                .font(.headline)

            specRow("Бренд", detail?.vendor ?? product.vendor)
            specRow("Категорія", detail?.category ?? product.category)
            specRow("Наявність", stock > 0 ? "\(stock) шт." : "немає")
            specRow("Постачальник", product.supplierId.uppercased())
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface()
    }

    @ViewBuilder
    private func specRow(_ title: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            HStack(alignment: .top) {
                Text(title)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 12)
                Text(value)
                    .font(.footnote)
                    .multilineTextAlignment(.trailing)
            }
        }
    }

    private var deliveryNote: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "shippingbox")
                .foregroundStyle(Theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text("Доставка Новою Поштою")
                    .font(.footnote.weight(.semibold))
                Text("Оплата при отриманні у відділенні. Без онлайн-оплати.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface()
    }

    private var similarRail: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Схожі товари")
                .font(.headline)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(similar) { item in
                        NavigationLink(value: item) {
                            VStack(alignment: .leading, spacing: 6) {
                                CachedAsyncImage(url: APIClient.imageURL(item.imageUrl, width: 240))
                                    .frame(width: 120, height: 120)
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                Text(item.title)
                                    .font(.caption)
                                    .lineLimit(2)
                                    .frame(width: 120, alignment: .leading)
                                Text(Money.uah(cents: item.priceCents))
                                    .font(.caption.weight(.bold))
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var bottomBar: some View {
        HStack(spacing: 10) {
            Button {
                favorites.toggle(product.id)
            } label: {
                Image(systemName: favorites.contains(product.id) ? "heart.fill" : "heart")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(favorites.contains(product.id) ? .red : .primary)
                    .frame(width: 48, height: 48)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)

            PrimaryActionButton(
                title: "Купити",
                systemImage: "cart.badge.plus",
                isDisabled: stock <= 0
            ) {
                cart.add(product)
                Analytics.track("add_to_cart", productId: product.id)
            }
        }
        .padding(.horizontal, Theme.screenPadding)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }
}

import SwiftUI

struct ProductDetailView: View {
    let product: Product

    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var favorites: FavoritesStore

    @State private var detail: ProductDetail?
    @State private var similar: [Product] = []
    @State private var selectedImage: String?
    @State private var didAdd = false
    @State private var showReviewSheet = false

    private var activeImage: String {
        selectedImage ?? detail?.imageUrl ?? product.imageUrl
    }

    private var displayTitle: String { detail?.title ?? product.title }
    private var displayStock: Int { detail?.stock ?? product.stock }
    private var priceCents: Int { detail?.priceCents ?? product.priceCents }
    private var oldPriceCents: Int? { detail?.oldPriceCents ?? product.oldPriceCents }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                gallery

                Text(displayTitle)
                    .font(.title3.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)

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

                if let detail, detail.ratingCount > 0 {
                    HStack(spacing: 4) {
                        ForEach(0..<5, id: \.self) { index in
                            Image(systemName: Double(index) < detail.rating.rounded() ? "star.fill" : "star")
                                .font(.caption)
                                .foregroundStyle(.orange)
                        }
                        Text(String(format: "%.1f", detail.rating))
                            .font(.caption.weight(.semibold))
                        Text("(\(detail.ratingCount) відгуків)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if let detail, !detail.description.isEmpty {
                    Text(detail.description)
                        .font(.callout)
                        .fixedSize(horizontal: false, vertical: true)
                } else if !product.shortDescription.isEmpty {
                    Text(product.shortDescription)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                deliveryNote

                if !similar.isEmpty {
                    similarRail
                }

                ReviewsSection(productId: product.id, showSheet: $showReviewSheet)
            }
            .padding(16)
        }
        .background(Color(.systemBackground))
        .safeAreaInset(edge: .bottom) { bottomBar }
        .navigationTitle("Товар")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            detail = try? await APIClient.shared.productDetail(id: product.id)
            similar = (try? await APIClient.shared.similar(id: product.id))?.items ?? []
        }
        .sheet(isPresented: $showReviewSheet) {
            ReviewComposer(productId: product.id, productTitle: displayTitle)
        }
    }

    private var gallery: some View {
        VStack(spacing: 10) {
            CachedAsyncImage(url: APIClient.imageURL(activeImage, width: 800), contentMode: .fit)
                .frame(maxWidth: .infinity)
                .frame(height: 320)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))

            if product.images.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(product.images.prefix(8), id: \.self) { image in
                            CachedAsyncImage(url: APIClient.imageURL(image, width: 200))
                                .frame(width: 56, height: 56)
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .strokeBorder(image == activeImage ? Color.indigo : Color.clear, lineWidth: 2)
                                )
                                .onTapGesture { selectedImage = image }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var availability: some View {
        if displayStock > 0 {
            Label("В наявності", systemImage: "checkmark.circle.fill")
                .font(.caption.weight(.medium))
                .foregroundStyle(.green)
        } else {
            Label("Немає в наявності", systemImage: "xmark.circle")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
        }
    }

    private var deliveryNote: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "shippingbox")
                .foregroundStyle(.indigo)
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
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
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
                    .frame(width: 44, height: 44)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)

            Button {
                cart.add(product)
                didAdd = true
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    didAdd = false
                }
            } label: {
                HStack {
                    Image(systemName: didAdd ? "checkmark" : "cart.badge.plus")
                    Text(didAdd ? "Додано в кошик" : "Купити")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(displayStock <= 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }
}

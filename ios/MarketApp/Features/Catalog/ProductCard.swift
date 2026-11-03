import SwiftUI

struct ProductCard: View {
    let product: Product
    var imageHeight: CGFloat = 150

    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var favorites: FavoritesStore
    @State private var added = false

    var body: some View {
        VStack(spacing: 0) {
            NavigationLink(value: product) {
                VStack(alignment: .leading, spacing: 8) {
                    ZStack(alignment: .topLeading) {
                        CachedAsyncImage(url: APIClient.imageURL(product.imageUrl))
                            .frame(height: imageHeight)
                            .frame(maxWidth: .infinity)
                            .clipped()
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                        HStack(spacing: 6) {
                            if product.discountPercent > 0 {
                                Text("-\(product.discountPercent)%")
                                    .font(.caption2.weight(.bold))
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 3)
                                    .background(.red, in: Capsule())
                                    .foregroundStyle(.white)
                            }
                            if !product.isAvailable {
                                Text("Немає")
                                    .font(.caption2.weight(.semibold))
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 3)
                                    .background(.ultraThinMaterial, in: Capsule())
                            }
                        }
                        .padding(8)
                    }

                    Text(product.title)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .frame(minHeight: 38, alignment: .topLeading)

                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(Money.uah(cents: product.priceCents))
                            .font(.headline)
                        if let old = product.oldPriceCents, old > product.priceCents {
                            Text(Money.uah(cents: old))
                                .font(.caption)
                                .strikethrough()
                                .foregroundStyle(.secondary)
                        }
                    }

                    HStack(spacing: 6) {
                        if product.ratingCount > 0 {
                            Image(systemName: "star.fill")
                                .font(.caption2)
                                .foregroundStyle(.orange)
                            Text(String(format: "%.1f", product.rating))
                                .font(.caption2)
                            Text("(\(product.ratingCount))")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        } else {
                            Text(product.vendor ?? product.category)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                }
                .padding(10)
            }
            .buttonStyle(.plain)

            HStack(spacing: 8) {
                Button {
                    cart.add(product)
                    added = true
                    Task { @MainActor in
                        try? await Task.sleep(nanoseconds: 1_200_000_000)
                        added = false
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: added ? "checkmark" : "cart.badge.plus")
                        Text(added ? "Додано" : "Купити")
                    }
                    .font(.footnote.weight(.semibold))
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(!product.isAvailable)
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 10)
        }
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.05))
        )
        .overlay(alignment: .topTrailing) {
            Button {
                favorites.toggle(product.id)
            } label: {
                Image(systemName: favorites.contains(product.id) ? "heart.fill" : "heart")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(favorites.contains(product.id) ? .red : .secondary)
                    .padding(7)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .buttonStyle(.plain)
            .padding(8)
        }
    }
}

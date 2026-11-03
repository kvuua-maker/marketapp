import SwiftUI

// MARK: - Product tile

struct ProductTile: View {
    let product: Product
    var imageHeight: CGFloat = 170

    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var favorites: FavoritesStore
    @State private var justAdded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            NavigationLink(value: product) {
                VStack(alignment: .leading, spacing: 8) {
                    ZStack(alignment: .topLeading) {
                        CachedAsyncImage(url: APIClient.imageURL(product.imageUrl, width: 500))
                            .frame(height: imageHeight)
                            .frame(maxWidth: .infinity)
                            .clipped()
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

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
                        .foregroundStyle(.primary)
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
                        Spacer(minLength: 0)
                    }

                    HStack(spacing: 4) {
                        if product.ratingCount > 0 {
                            Image(systemName: "star.fill")
                                .font(.caption2)
                                .foregroundStyle(.orange)
                            Text(String(format: "%.1f", product.rating))
                                .font(.caption2)
                            Text("(\(product.ratingCount))")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        } else if let vendor = product.vendor, !vendor.isEmpty {
                            Text(vendor)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                }
            }
            .buttonStyle(.plain)

            Button {
                cart.add(product)
                Analytics.track("add_to_cart", productId: product.id)
                justAdded = true
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 1_200_000_000)
                    justAdded = false
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: justAdded ? "checkmark" : "cart.badge.plus")
                    Text(justAdded ? "Додано" : "Купити")
                }
                .font(.footnote.weight(.semibold))
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(!product.isAvailable)
        }
        .padding(10)
        .cardSurface()
        .overlay(alignment: .topTrailing) {
            Button {
                favorites.toggle(product.id)
            } label: {
                Image(systemName: favorites.contains(product.id) ? "heart.fill" : "heart")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(favorites.contains(product.id) ? .red : .secondary)
                    .padding(7)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .buttonStyle(.plain)
            .padding(8)
        }
    }
}

// MARK: - Skeleton

struct SkeletonTile: View {
    var imageHeight: CGFloat = 170
    @State private var dim = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color(.tertiarySystemFill))
                .frame(height: imageHeight)
            RoundedRectangle(cornerRadius: 4).fill(Color(.tertiarySystemFill)).frame(height: 12)
            RoundedRectangle(cornerRadius: 4).fill(Color(.tertiarySystemFill)).frame(width: 90, height: 12)
            RoundedRectangle(cornerRadius: 6).fill(Color(.tertiarySystemFill)).frame(width: 70, height: 18)
        }
        .padding(10)
        .cardSurface()
        .opacity(dim ? 0.55 : 1)
        .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: dim)
        .onAppear { dim = true }
    }
}

// MARK: - Category chips

struct CategoryChips: View {
    let categories: [CategoryCount]
    let selected: String?
    let onSelect: (String?) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(title: "Усі", isSelected: selected == nil) { onSelect(nil) }
                ForEach(categories) { category in
                    chip(title: category.name, isSelected: selected == category.name) {
                        onSelect(category.name)
                    }
                }
            }
            .padding(.horizontal, Theme.screenPadding)
        }
    }

    private func chip(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(isSelected ? .semibold : .regular))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(
                    isSelected ? Theme.accent : Color(.secondarySystemBackground),
                    in: Capsule()
                )
                .foregroundStyle(isSelected ? .white : .primary)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Promo banner

struct PromoBanner: View {
    let items: [Product]

    var body: some View {
        if items.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label("Акції", systemImage: "tag.fill")
                        .font(.headline)
                    Spacer()
                }
                .padding(.horizontal, Theme.screenPadding)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(items) { product in
                            NavigationLink(value: product) {
                                VStack(alignment: .leading, spacing: 6) {
                                    CachedAsyncImage(url: APIClient.imageURL(product.imageUrl, width: 300))
                                        .frame(width: 150, height: 104)
                                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    Text(product.title)
                                        .font(.caption)
                                        .lineLimit(2)
                                        .frame(width: 150, alignment: .leading)
                                    HStack(spacing: 5) {
                                        Text(Money.uah(cents: product.priceCents))
                                            .font(.caption.weight(.bold))
                                        Text("-\(product.discountPercent)%")
                                            .font(.caption2.weight(.bold))
                                            .foregroundStyle(.white)
                                            .padding(.horizontal, 5)
                                            .padding(.vertical, 1)
                                            .background(.red, in: Capsule())
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, Theme.screenPadding)
                }
            }
            .padding(.vertical, 8)
        }
    }
}

// MARK: - Search suggestions

struct SuggestionList: View {
    let suggestions: [Suggestion]
    let onSelect: (Suggestion) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(suggestions) { suggestion in
                Button {
                    onSelect(suggestion)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: icon(for: suggestion.type))
                            .foregroundStyle(.secondary)
                            .frame(width: 20)
                        Text(suggestion.title)
                            .font(.subheadline)
                            .lineLimit(1)
                        Spacer()
                        if let price = suggestion.priceCents {
                            Text(Money.uah(cents: price))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 10)
                    .padding(.horizontal, 14)
                }
                .buttonStyle(.plain)

                Divider().padding(.leading, 44)
            }
        }
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal, Theme.screenPadding)
    }

    private func icon(for type: String) -> String {
        switch type {
        case "brand": return "tag"
        case "category": return "square.grid.2x2"
        default: return "magnifyingglass"
        }
    }
}

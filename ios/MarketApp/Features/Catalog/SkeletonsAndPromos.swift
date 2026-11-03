import SwiftUI

/// Grey placeholder shown while the first catalog page loads.
struct SkeletonCard: View {
    var imageHeight: CGFloat = 150
    @State private var shimmer = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(.tertiarySystemFill))
                .frame(height: imageHeight)

            RoundedRectangle(cornerRadius: 4)
                .fill(Color(.tertiarySystemFill))
                .frame(height: 12)

            RoundedRectangle(cornerRadius: 4)
                .fill(Color(.tertiarySystemFill))
                .frame(width: 90, height: 12)

            RoundedRectangle(cornerRadius: 6)
                .fill(Color(.tertiarySystemFill))
                .frame(width: 70, height: 18)
        }
        .padding(10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .opacity(shimmer ? 0.55 : 1)
        .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: shimmer)
        .onAppear { shimmer = true }
    }
}

/// Horizontal promo rail (hidden when the supplier has no discounted items).
struct PromotionsBanner: View {
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
                .padding(.horizontal, 16)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(items) { product in
                            NavigationLink(value: product) {
                                VStack(alignment: .leading, spacing: 6) {
                                    CachedAsyncImage(url: APIClient.imageURL(product.imageUrl, width: 240))
                                        .frame(width: 140, height: 100)
                                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                                    Text(product.title)
                                        .font(.caption)
                                        .lineLimit(2)
                                        .frame(width: 140, alignment: .leading)

                                    HStack(spacing: 4) {
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
                    .padding(.horizontal, 16)
                }
            }
            .padding(.vertical, 10)
        }
    }
}

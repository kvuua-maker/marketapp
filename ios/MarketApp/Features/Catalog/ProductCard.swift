import SwiftUI

struct ProductCard: View {
    let product: Product
    var imageHeight: CGFloat = 150

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            CachedAsyncImage(url: URL(string: product.imageUrl))
                .frame(height: imageHeight)
                .frame(maxWidth: .infinity)
                .clipped()
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(alignment: .topLeading) {
                    if !product.isAvailable {
                        Text("Немає")
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(.ultraThinMaterial, in: Capsule())
                            .padding(8)
                    }
                }

            Text(product.title)
                .font(.subheadline.weight(.medium))
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(minHeight: 38, alignment: .topLeading)

            Spacer(minLength: 0)

            HStack(alignment: .firstTextBaseline) {
                Text(Money.uah(cents: product.priceCents))
                    .font(.headline)

                Spacer(minLength: 4)

                if !product.vendor.isEmptyOrNil {
                    Text(product.vendor ?? "")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Text(product.category)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .padding(10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.05))
        )
    }
}

private extension Optional where Wrapped == String {
    var isEmptyOrNil: Bool {
        switch self {
        case .none: return true
        case .some(let value): return value.trimmingCharacters(in: .whitespaces).isEmpty
        }
    }
}

import SwiftUI

struct ProductDetailView: View {
    let product: Product

    @EnvironmentObject private var cart: CartStore
    @State private var selectedImage: String?
    @State private var didAdd = false

    private var activeImage: String {
        selectedImage ?? product.imageUrl
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                gallery

                Text(product.title)
                    .font(.title3.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)

                HStack(alignment: .firstTextBaseline) {
                    Text(Money.uah(cents: product.priceCents))
                        .font(.title2.bold())
                    Spacer()
                    availability
                }

                if !product.shortDescription.isEmpty {
                    Text(product.shortDescription)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Divider()

                Text(product.description)
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)

                deliveryNote
            }
            .padding(16)
        }
        .background(Color(.systemBackground))
        .safeAreaInset(edge: .bottom) { addToCartBar }
        .navigationTitle("Товар")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var gallery: some View {
        VStack(spacing: 10) {
            CachedAsyncImage(url: URL(string: activeImage), contentMode: .fit)
                .frame(maxWidth: .infinity)
                .frame(height: 320)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))

            if product.images.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(product.images.prefix(8), id: \.self) { image in
                            CachedAsyncImage(url: URL(string: image))
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
        if product.isAvailable {
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

    private var addToCartBar: some View {
        VStack(spacing: 8) {
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
                    Text(didAdd ? "Додано в кошик" : "Додати в кошик")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!product.isAvailable)

            Text("Оплата при отриманні · Нова Пошта")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.ultraThinMaterial)
    }
}

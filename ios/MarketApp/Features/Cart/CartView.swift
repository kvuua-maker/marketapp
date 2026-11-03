import SwiftUI

struct CartView: View {
    @EnvironmentObject private var cart: CartStore

    var body: some View {
        Group {
            if cart.isEmpty {
                ContentUnavailableView(
                    "Кошик порожній",
                    systemImage: "cart",
                    description: Text("Додайте товари з каталогу")
                )
            } else {
                content
            }
        }
        .navigationTitle("Кошик")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var content: some View {
        List {
            Section {
                ForEach(cart.lines) { line in
                    row(for: line)
                }
                .onDelete { indexSet in
                    let ids = indexSet.map { cart.lines[$0].id }
                    ids.forEach { cart.remove(id: $0) }
                }
            }

            Section {
                HStack {
                    Text("Разом")
                    Spacer()
                    Text(Money.uah(cents: cart.totalCents))
                        .font(.headline)
                }

                NavigationLink {
                    CheckoutView()
                } label: {
                    Label("Оформити замовлення", systemImage: "shippingbox")
                        .fontWeight(.semibold)
                }
            } footer: {
                Text("Оплата при отриманні у відділенні Нової Пошти. Онлайн-оплати немає.")
            }
        }
    }

    private func row(for line: CartStore.Line) -> some View {
        HStack(spacing: 12) {
            CachedAsyncImage(url: APIClient.imageURL(line.product.imageUrl, width: 160))
                .frame(width: 64, height: 64)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text(line.product.title)
                    .font(.subheadline)
                    .lineLimit(2)

                Text(Money.uah(cents: line.product.priceCents))
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            Stepper(
                value: Binding(
                    get: { line.qty },
                    set: { cart.setQty($0, for: line.id) }
                ),
                in: 1...10
            ) {
                Text("\(line.qty) шт.")
                    .font(.caption.weight(.medium))
                    .monospacedDigit()
            }
            .labelsHidden()
            .fixedSize()
        }
        .padding(.vertical, 4)
    }
}

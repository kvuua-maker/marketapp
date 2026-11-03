import SwiftUI

struct CartView: View {
    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var router: AppRouter

    var body: some View {
        Group {
            if cart.isEmpty {
                EmptyStateView(
                    title: "Кошик порожній",
                    systemImage: "cart",
                    message: "Додайте товари з каталогу — оплата при отриманні.",
                    actionTitle: "Перейти до каталогу",
                    action: { router.goToCatalog() }
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
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                cart.remove(id: line.id)
                            } label: {
                                Label("Видалити", systemImage: "trash")
                            }
                        }
                }
            }

            Section {
                HStack {
                    Text("Товарів")
                    Spacer()
                    Text("\(cart.count) шт.")
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Text("Доставка")
                    Spacer()
                    Text("за тарифом Нової Пошти")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Text("Разом")
                        .font(.headline)
                    Spacer()
                    Text(Money.uah(cents: cart.totalCents))
                        .font(.headline)
                }
            } footer: {
                Text("Оплата при отриманні у відділенні Нової Пошти. Онлайн-оплати немає.")
            }
        }
        .safeAreaInset(edge: .bottom) {
            NavigationLink {
                CheckoutView()
            } label: {
                Text("Оформити замовлення")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityLabel("Оформити замовлення")
            .padding(.horizontal, Theme.screenPadding)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial)
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

            Spacer(minLength: 6)

            VStack(spacing: 6) {
                HStack(spacing: 12) {
                    Button {
                        cart.setQty(line.qty - 1, for: line.id)
                    } label: {
                        Image(systemName: "minus.circle")
                            .font(.title3)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Зменшити кількість")

                    Text("\(line.qty)")
                        .font(.subheadline.weight(.semibold))
                        .monospacedDigit()
                        .frame(minWidth: 18)

                    Button {
                        cart.setQty(line.qty + 1, for: line.id)
                    } label: {
                        Image(systemName: "plus.circle")
                            .font(.title3)
                    }
                    .buttonStyle(.plain)
                    .disabled(line.qty >= CartStore.maxQty(for: line.product))
                    .accessibilityLabel("Збільшити кількість")
                }

                Button(role: .destructive) {
                    cart.remove(id: line.id)
                } label: {
                    Image(systemName: "trash")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.red)
                .accessibilityLabel("Видалити товар")
            }
        }
        .padding(.vertical, 4)
    }
}

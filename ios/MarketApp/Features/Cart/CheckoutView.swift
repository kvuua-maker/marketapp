import SwiftUI

struct CheckoutView: View {
    @EnvironmentObject private var cart: CartStore
    @Environment(\.dismiss) private var dismiss

    @State private var customer = Customer(fullName: "", phone: "", city: "", branch: "", comment: "")
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var result: OrderResponse?

    var body: some View {
        Group {
            if let result {
                successView(result)
            } else {
                form
            }
        }
        .navigationTitle("Оформлення")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            Section {
                TextField("Прізвище та імʼя", text: $customer.fullName)
                    .textContentType(.name)
                    .textInputAutocapitalization(.words)

                TextField("+380 XX XXX XX XX", text: $customer.phone)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
            } header: {
                Text("Отримувач")
            }

            Section {
                TextField("Місто", text: $customer.city)
                    .textContentType(.addressCity)
                    .textInputAutocapitalization(.words)

                TextField("Відділення Нової Пошти, напр. №12", text: $customer.branch)

                TextField("Коментар (необовʼязково)", text: $customer.comment, axis: .vertical)
                    .lineLimit(2...4)
            } header: {
                Text("Доставка")
            } footer: {
                Text("Доставка Новою Поштою. Оплата при отриманні.")
            }

            Section {
                ForEach(cart.lines) { line in
                    HStack {
                        Text("\(line.qty) × \(line.product.title)")
                            .font(.footnote)
                            .lineLimit(2)
                        Spacer()
                        Text(Money.uah(cents: line.totalCents))
                            .font(.footnote.weight(.semibold))
                    }
                }
                HStack {
                    Text("До сплати при отриманні")
                    Spacer()
                    Text(Money.uah(cents: cart.totalCents))
                        .font(.headline)
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }

            Section {
                Button {
                    submit()
                } label: {
                    HStack {
                        if isSubmitting {
                            ProgressView()
                                .tint(.white)
                        }
                        Text(isSubmitting ? "Надсилаємо…" : "Оформити замовлення (Оплата при отриманні)")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canSubmit || isSubmitting || cart.isEmpty)
            }
        }
    }

    private var canSubmit: Bool {
        let name = customer.fullName.trimmingCharacters(in: .whitespacesAndNewlines)
        let digits = customer.phone.filter(\.isNumber)
        return name.count >= 5
            && name.contains(" ")
            && digits.count >= 10
            && customer.city.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
            && customer.branch.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
    }

    private func submit() {
        guard canSubmit, !cart.isEmpty, !isSubmitting else { return }
        isSubmitting = true
        errorMessage = nil

        Task { @MainActor in
            do {
                let response = try await APIClient.shared.createOrder(
                    OrderRequest(customer: customer, items: cart.orderItems())
                )
                result = response
                cart.clear()
            } catch {
                errorMessage = error.localizedDescription
            }
            isSubmitting = false
        }
    }

    private func successView(_ response: OrderResponse) -> some View {
        ScrollView {
            VStack(spacing: 18) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(.green)
                    .padding(.top, 40)

                Text("Замовлення прийнято")
                    .font(.title2.bold())

                Text("Номер: \(response.orderId)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Text(Money.uah(cents: response.totalCents))
                    .font(.title3.bold())

                VStack(alignment: .leading, spacing: 8) {
                    Label("Оплата при отриманні у відділенні Нової Пошти", systemImage: "shippingbox")
                    Label("Ми звʼяжемося з вами для підтвердження", systemImage: "phone")
                }
                .font(.footnote)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.horizontal, 20)

                Button("Продовжити покупки") {
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding(.top, 8)
            }
            .padding(.bottom, 32)
        }
    }
}

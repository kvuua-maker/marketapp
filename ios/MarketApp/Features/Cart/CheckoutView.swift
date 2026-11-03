import SwiftUI
import UIKit

struct CheckoutView: View {
    @EnvironmentObject private var cart: CartStore
    @Environment(\.dismiss) private var dismiss

    @State private var customer = Customer()
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var result: OrderResponse?
    @State private var showValidation = false

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

    // MARK: - Validation

    private var nameError: String? {
        let value = customer.fullName.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return "Вкажіть прізвище та імʼя" }
        if !value.contains(" ") { return "Потрібні прізвище та імʼя через пробіл" }
        if value.count < 5 { return "Занадто коротко" }
        return nil
    }

    private var phoneError: String? {
        let digits = customer.phone.filter(\.isNumber)
        if digits.isEmpty { return "Вкажіть номер телефону" }
        if digits.count < 10 { return "Телефон має містити 10 цифр" }
        return nil
    }

    private var cityError: String? {
        customer.city.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 ? "Вкажіть місто" : nil
    }

    private var branchError: String? {
        customer.branch.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 ? "Вкажіть номер відділення" : nil
    }

    private var firstError: (field: String, message: String)? {
        if let nameError { return ("ПІБ", nameError) }
        if let phoneError { return ("Телефон", phoneError) }
        if let cityError { return ("Місто", cityError) }
        if let branchError { return ("Відділення", branchError) }
        return nil
    }

    private var canSubmit: Bool { firstError == nil && !cart.isEmpty }

    // MARK: - Form

    private var form: some View {
        Form {
            Section {
                field(title: "Прізвище та імʼя", text: $customer.fullName, hint: "Наприклад: Іван Петренко", error: nameError)
                field(
                    title: "Телефон",
                    text: $customer.phone,
                    hint: "+380 XX XXX XX XX",
                    error: phoneError,
                    keyboard: .phonePad
                )
            } header: {
                Text("Отримувач")
            }

            Section {
                field(title: "Місто", text: $customer.city, hint: "Київ", error: cityError)
                field(title: "Відділення Нової Пошти", text: $customer.branch, hint: "№12", error: branchError)
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
                    Text(Money.uah(cents: cart.totalCents)).font(.headline)
                }
            }

            if showValidation, let firstError {
                Section {
                    Label("\(firstError.field): \(firstError.message)", systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage).font(.footnote).foregroundStyle(.red)
                }
            }

            Section {
                Button {
                    submit()
                } label: {
                    HStack {
                        if isSubmitting { ProgressView().tint(.white) }
                        Text(isSubmitting ? "Надсилаємо…" : "Оформити замовлення (Оплата при отриманні)")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSubmitting || cart.isEmpty)
            }
        }
    }

    @ViewBuilder
    private func field(
        title: String,
        text: Binding<String>,
        hint: String,
        error: String?,
        keyboard: UIKeyboardType = .default
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField(title, text: text, prompt: Text(hint))
                .keyboardType(keyboard)
            if showValidation, let error {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(.red)
            }
        }
    }

    // MARK: - Actions

    private func submit() {
        guard !isSubmitting, !cart.isEmpty else { return }
        guard firstError == nil else {
            showValidation = true
            return
        }
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
                    if let ttn = response.ttn {
                        Label("ТТН: \(ttn)", systemImage: "number")
                    }
                }
                .font(.footnote)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.horizontal, 20)

                Button("Продовжити покупки") { dismiss() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding(.top, 8)
            }
            .padding(.bottom, 32)
        }
    }
}

import SwiftUI
import UIKit

struct CheckoutView: View {
    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var profile: ProfileStore
    @EnvironmentObject private var router: AppRouter
    @Environment(\.dismiss) private var dismiss

    @State private var customer = Customer()
    @State private var selectedCity = ""
    @State private var selectedWarehouse = ""
    @State private var note = ""
    @State private var showValidation = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var result: OrderResponse?
    @State private var showCityPicker = false
    @State private var showWarehousePicker = false
    @State private var scrollRequest: String?

    var body: some View {
        Group {
            if let result {
                thankYou(result)
            } else {
                form
            }
        }
        .navigationTitle("Оформлення")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if customer.phone.isEmpty, profile.isValidPhone {
                customer.phone = profile.phone
            }
            if let saved = profile.addresses.first {
                selectedCity = saved.city
                selectedWarehouse = saved.branch
            }
        }
        .sheet(isPresented: $showCityPicker) {
            CityPickerView { city in
                selectedCity = city
                selectedWarehouse = ""
            }
        }
        .sheet(isPresented: $showWarehousePicker) {
            WarehousePickerView(city: selectedCity) { warehouse in
                selectedWarehouse = warehouse
            }
        }
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
        if digits.count < 12 && digits.count < 10 { return "Телефон має містити 10 цифр" }
        return digits.count >= 10 ? nil : "Телефон має містити 10 цифр"
    }

    private var cityError: String? { selectedCity.isEmpty ? "Оберіть місто" : nil }

    private var warehouseError: String? {
        selectedWarehouse.trimmingCharacters(in: .whitespaces).isEmpty ? "Вкажіть відділення" : nil
    }

    private var firstError: (String, String)? {
        if let nameError { return ("ПІБ", nameError) }
        if let phoneError { return ("Телефон", phoneError) }
        if let cityError { return ("Місто", cityError) }
        if let warehouseError { return ("Відділення", warehouseError) }
        return nil
    }

    // MARK: - Form

    private var form: some View {
        ScrollViewReader { proxy in
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Прізвище та імʼя")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("Іван Петренко", text: $customer.fullName)
                            .textContentType(.name)
                            .textInputAutocapitalization(.words)
                            .textFieldStyle(.roundedBorder)
                        if showValidation, let nameError {
                            errorText(nameError)
                        }
                    }
                    .id("name")

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Телефон")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("+380 XX XXX XX XX", text: $customer.phone)
                            .keyboardType(.phonePad)
                            .textContentType(.telephoneNumber)
                            .textFieldStyle(.roundedBorder)
                            .onChange(of: customer.phone) { _, value in
                                let formatted = Self.formatPhone(value)
                                if formatted != value { customer.phone = formatted }
                            }
                        if showValidation, let phoneError {
                            errorText(phoneError)
                        }
                    }
                    .id("phone")
                } header: {
                    Text("Отримувач")
                }

                Section {
                    Button {
                        showCityPicker = true
                    } label: {
                        pickerRow(title: "Місто", value: selectedCity)
                    }
                    .buttonStyle(.plain)
                    .id("city")

                    if showValidation, let cityError {
                        errorText(cityError)
                    }

                    Button {
                        guard !selectedCity.isEmpty else {
                            showValidation = true
                            return
                        }
                        showWarehousePicker = true
                    } label: {
                        pickerRow(title: "Відділення Нової Пошти", value: selectedWarehouse)
                    }
                    .buttonStyle(.plain)
                    .id("warehouse")

                    if showValidation, let warehouseError {
                        errorText(warehouseError)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Коментар")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("Необовʼязково", text: $note, axis: .vertical)
                            .lineLimit(2...4)
                            .textFieldStyle(.roundedBorder)
                    }
                } header: {
                    Text("Доставка")
                } footer: {
                    Text("Доставка Новою Поштою. Оплата при отриманні.")
                }

                Section("Замовлення") {
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
                        Label("\(firstError.0): \(firstError.1)", systemImage: "exclamationmark.triangle.fill")
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
                    PrimaryActionButton(
                        title: "Підтвердити замовлення",
                        systemImage: "checkmark.seal",
                        isLoading: isSubmitting,
                        isDisabled: isSubmitting || cart.isEmpty
                    ) {
                        submit()
                    }
                }
            }
            .onChange(of: showValidation) { _, show in
                guard show, let target = firstErrorField else { return }
                withAnimation(.easeInOut(duration: 0.25)) {
                    proxy.scrollTo(target, anchor: .center)
                }
            }
            .onChange(of: scrollRequest) { _, target in
                guard let target else { return }
                withAnimation(.easeInOut(duration: 0.25)) {
                    proxy.scrollTo(target, anchor: .center)
                }
            }
        }
    }

    /// Which control the form should scroll to when validation fails.
    private var firstErrorField: String? {
        if nameError != nil { return "name" }
        if phoneError != nil { return "phone" }
        if cityError != nil { return "city" }
        if warehouseError != nil { return "warehouse" }
        return nil
    }

    private func pickerRow(title: String, value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(.primary)
            Spacer()
            Text(value.isEmpty ? "Оберіть" : value)
                .foregroundStyle(value.isEmpty ? .secondary : .primary)
                .lineLimit(1)
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func errorText(_ message: String) -> some View {
        Text(message)
            .font(.caption2)
            .foregroundStyle(.red)
    }

    // MARK: - Actions

    private func submit() {
        guard !isSubmitting, !cart.isEmpty else { return }
        guard firstError == nil else {
            showValidation = true
            return
        }

        customer.phone = Self.digitsOnlyPhone(customer.phone)
        customer.city = selectedCity
        customer.branch = Self.normalizedBranch(selectedWarehouse)
        customer.comment = note
        isSubmitting = true
        errorMessage = nil

        Task { @MainActor in
            do {
                let response = try await APIClient.shared.createOrder(
                    OrderRequest(customer: customer, items: cart.orderItems())
                )
                Analytics.track("order_created", orderId: response.orderId)
                profile.phone = customer.phone
                profile.addAddress(label: selectedCity, city: selectedCity, branch: selectedWarehouse)
                result = response
                cart.clear()
                // Tell the account immediately so other devices drop the items.
                await CartSync.pushNow(cart)
            } catch {
                errorMessage = error.localizedDescription
                if let apiError = error as? APIError, let field = apiError.field,
                   let target = Self.fieldId(for: field) {
                    showValidation = true
                    scrollRequest = target
                }
            }
            isSubmitting = false
        }
    }

    private func thankYou(_ response: OrderResponse) -> some View {
        ScrollView {
            VStack(spacing: 16) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(.green)
                    .padding(.top, 40)

                Text("Дякуємо за замовлення!")
                    .font(.title2.bold())

                Text("Номер: \(response.orderId)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Text(Money.uah(cents: response.totalCents))
                    .font(.title3.bold())

                VStack(alignment: .leading, spacing: 8) {
                    Label("Оплата при отриманні у відділенні Нової Пошти", systemImage: "shippingbox")
                    Label("Ми звʼяжемося для підтвердження", systemImage: "phone")
                    if let ttn = response.ttn {
                        Label("ТТН: \(ttn)", systemImage: "number")
                    }
                }
                .font(.footnote)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .cardSurface()
                .padding(.horizontal, 20)

                PrimaryActionButton(title: "Повернутися в каталог", systemImage: "square.grid.2x2") {
                    dismiss()
                    router.goToCatalog()
                }
                .padding(.horizontal, 20)
            }
            .padding(.bottom, 32)
        }
    }

    // MARK: - Helpers

    /// Maps server field names to the form ids used for scrolling.
    static func fieldId(for serverField: String) -> String? {
        switch serverField {
        case "fullName": return "name"
        case "phone": return "phone"
        case "city": return "city"
        case "branch": return "warehouse"
        default: return nil
        }
    }

    /// "+380 97 469 00 00" -> "+380974690000" (the server normalises again).
    static func digitsOnlyPhone(_ input: String) -> String {
        let digits = input.filter(\.isNumber)
        return digits.isEmpty ? "" : "+\(digits)"
    }

    /// "17" -> "Відділення №17", mirrors the server rule.
    static func normalizedBranch(_ input: String) -> String {
        let raw = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let digits = raw.filter(\.isNumber)
        if !digits.isEmpty, raw.range(of: #"^(?:відділення\s*)?№?\s*\d{1,4}$"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return "Відділення №\(digits)"
        }
        return raw
    }

    /// Formats any input into +380 XX XXX XX XX.
    static func formatPhone(_ input: String) -> String {
        var digits = input.filter(\.isNumber)
        if digits.hasPrefix("380") { digits = String(digits.dropFirst(3)) }
        if digits.hasPrefix("38") { digits = String(digits.dropFirst(2)) }
        if digits.hasPrefix("0") { digits = String(digits.dropFirst()) }
        digits = String(digits.prefix(9))

        var result = "+380"
        let groups = [2, 3, 2, 2]
        var index = digits.startIndex
        for size in groups {
            guard index < digits.endIndex else { break }
            let end = digits.index(index, offsetBy: size, limitedBy: digits.endIndex) ?? digits.endIndex
            result += " " + digits[index..<end]
            index = end
        }
        return result
    }
}

// MARK: - Nova Poshta pickers

struct CityPickerView: View {
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var cities: [CityOption] = []
    @State private var isConfigured = false
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Пошук міста", text: $query)
                        .onChange(of: query) { _, _ in
                            Task { await search() }
                        }
                }

                if !isConfigured {
                    Section {
                        Text("API Нової Пошти не налаштоване — показано базовий перелік міст.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section {
                    ForEach(cities) { city in
                        Button {
                            onSelect(city.name)
                            dismiss()
                        } label: {
                            Text(city.name).foregroundStyle(.primary)
                        }
                    }
                }
            }
            .navigationTitle("Місто")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрити") { dismiss() }
                }
            }
            .task { await search() }
        }
    }

    private func search() async {
        isLoading = true
        defer { isLoading = false }
        if let page = try? await APIClient.shared.cities(query) {
            cities = page.items
            isConfigured = page.configured
        }
    }
}

struct WarehousePickerView: View {
    let city: String
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var manual = ""
    @State private var warehouses: [WarehouseOption] = []
    @State private var isConfigured = false

    var body: some View {
        NavigationStack {
            List {
                if isConfigured {
                    Section {
                        TextField("Пошук відділення", text: $query)
                            .onChange(of: query) { _, _ in
                                Task { await search() }
                            }
                    }

                    Section {
                        ForEach(warehouses) { warehouse in
                            Button {
                                onSelect(warehouse.name)
                                dismiss()
                            } label: {
                                Text(warehouse.name)
                                    .font(.footnote)
                                    .foregroundStyle(.primary)
                            }
                        }
                    }
                } else {
                    Section {
                        Text("API Нової Пошти не налаштоване. Впишіть номер відділення вручну — ми перевіримо його при підтвердженні.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("Наприклад, Відділення №12", text: $manual)
                    }

                    Section {
                        Button("Зберегти") {
                            onSelect(CheckoutView.normalizedBranch(manual))
                            dismiss()
                        }
                        .disabled(manual.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
                    }
                }
            }
            .navigationTitle("Відділення · \(city)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрити") { dismiss() }
                }
            }
            .task { await search() }
        }
    }

    private func search() async {
        guard let page = try? await APIClient.shared.warehouses(city: city, query: query) else { return }
        warehouses = page.items
        isConfigured = page.configured
    }
}

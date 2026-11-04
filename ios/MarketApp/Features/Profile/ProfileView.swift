import SwiftUI
import AuthenticationServices

struct ProfileView: View {
    @EnvironmentObject private var profile: ProfileStore
    @EnvironmentObject private var favorites: FavoritesStore
    @EnvironmentObject private var cart: CartStore
    @ObservedObject private var auth = AuthStore.shared

    @State private var orders: [OrderSummary] = []
    @State private var favoriteProducts: [Product] = []
    @State private var isLoadingOrders = false
    @State private var errorMessage: String?
    @State private var notice: String?
    @State private var showAddressSheet = false
    @State private var ordersTask: Task<Void, Never>?
    @State private var cancelTarget: OrderSummary?

    var body: some View {
        Form {
            phoneSection
            ordersSection
            favoritesSection
            addressesSection
            authSection
            settingsSection
            legalSection
        }
        .navigationTitle("Профіль")
        .task { await refresh() }
        .onChange(of: profile.phone) { _, _ in
            // Debounce: typing a phone number must not fire a request per keystroke.
            ordersTask?.cancel()
            ordersTask = Task {
                try? await Task.sleep(nanoseconds: 350_000_000)
                guard !Task.isCancelled else { return }
                await loadOrders()
            }
        }
        .refreshable { await refresh() }
        .alert(
            "Скасувати замовлення?",
            isPresented: Binding(
                get: { cancelTarget != nil },
                set: { if !$0 { cancelTarget = nil } }
            ),
            presenting: cancelTarget
        ) { order in
            Button("Так, скасувати", role: .destructive) {
                Task { await cancel(order) }
            }
            Button("Ні", role: .cancel) { cancelTarget = nil }
        } message: { order in
            Text("Ви впевнені, що хочете скасувати замовлення \(order.id)? Кошти не списуються, оплата при отриманні.")
        }
        .sheet(isPresented: $showAddressSheet) {
            AddressEditor { label, city, branch in
                profile.addAddress(label: label, city: city, branch: branch)
            }
        }
    }

    // MARK: - Sections

    private var phoneSection: some View {
        Section {
            TextField("+380 XX XXX XX XX", text: $profile.phone)
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
        } header: {
            Text("Мій номер")
        } footer: {
            Text(profile.isValidPhone
                 ? "За цим номером ми знаходимо ваші замовлення."
                 : "Вкажіть номер телефону, щоб побачити історію замовлень.")
        }
    }

    @ViewBuilder
    private var ordersSection: some View {
        if profile.isValidPhone || SessionStore.token != nil {
            Section("Мої замовлення") {
                if isLoadingOrders {
                    HStack { ProgressView(); Text("Завантаження…").foregroundStyle(.secondary) }
                } else if orders.isEmpty {
                    Text("Замовлень поки немає").foregroundStyle(.secondary)
                } else {
                    ForEach(orders) { order in
                        orderRow(order)
                    }
                }

                if let errorMessage {
                    Text(errorMessage).font(.footnote).foregroundStyle(.red)
                }
                if let notice {
                    Text(notice).font(.footnote).foregroundStyle(.green)
                }
            }
        }
    }

    private var favoritesSection: some View {
        Section("Обране (\(favoriteProducts.count))") {
            if favoriteProducts.isEmpty {
                Text("Додавайте товари сердечком у каталозі").foregroundStyle(.secondary)
            } else {
                ForEach(favoriteProducts) { product in
                    NavigationLink(value: product) {
                        HStack(spacing: 10) {
                            CachedAsyncImage(url: APIClient.imageURL(product.imageUrl, width: 160))
                                .frame(width: 44, height: 44)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(product.title).font(.footnote).lineLimit(2)
                                Text(Money.uah(cents: product.priceCents))
                                    .font(.caption.weight(.semibold))
                            }
                        }
                    }
                }
            }
        }
    }

    private var addressesSection: some View {
        Section {
            ForEach(profile.addresses) { address in
                VStack(alignment: .leading, spacing: 2) {
                    Text(address.label).font(.subheadline.weight(.medium))
                    Text("\(address.city), \(address.branch)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .onDelete { indexSet in
                let ids = indexSet.map { profile.addresses[$0] }
                ids.forEach { profile.removeAddress($0) }
            }

            Button {
                showAddressSheet = true
            } label: {
                Label("Додати адресу", systemImage: "plus.circle")
            }
        } header: {
            Text("Збережені адреси")
        }
    }

    private var settingsSection: some View {
        Section("Налаштування") {
            Picker("Тема", selection: $profile.theme) {
                ForEach(ThemeMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }

            HStack {
                Text("Мова")
                Spacer()
                Text("Українська").foregroundStyle(.secondary)
            }

            HStack {
                Text("Версія")
                Spacer()
                Text("\(Bundle.main.appVersion) (\(Bundle.main.buildNumber))")
                    .foregroundStyle(.secondary)
            }

            HStack {
                Text("Сервер")
                Spacer()
                Text(AppConfig.baseURL.absoluteString)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }

    private var authSection: some View {
        Section {
            if auth.isSignedIn {
                Label(
                    auth.displayName.map { "Ви увійшли як \($0)" } ?? "Увійдено через Apple ID",
                    systemImage: "person.crop.circle.badge.checkmark"
                )
                .font(.subheadline)

                Button {
                    Task { await auth.syncNow(cart: cart, profile: profile) }
                } label: {
                    Label("Синхронізувати зараз", systemImage: "arrow.triangle.2.circlepath")
                }
                .disabled(auth.isWorking)

                Button(role: .destructive) {
                    auth.signOut()
                } label: {
                    Label("Вийти", systemImage: "rectangle.portrait.and.arrow.right")
                }
            } else {
                Text("Увійдіть, щоб синхронізувати кошик та історію між iPhone та iPad")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = [.fullName, .email]
                } onCompletion: { result in
                    Task { await auth.handleAuthorization(result, cart: cart, profile: profile) }
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 46)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityLabel("Увійти через Apple ID")
            }

            if auth.isWorking {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Синхронізація…").foregroundStyle(.secondary)
                }
            }

            if let error = auth.errorMessage {
                Text(error).font(.caption).foregroundStyle(.red)
            }

            if let info = auth.infoMessage {
                Text(info).font(.caption).foregroundStyle(.green)
            }
        } header: {
            Text("Синхронізація")
        } footer: {
            if !auth.isSignedIn {
                Text("Вхід необовʼязковий: замовлення оформлюються без реєстрації, а історія працює на цьому пристрої.")
            }
        }
    }

    private var legalSection: some View {
        Section("Документи") {
            Link(destination: Self.supportURL) {
                Label("Підтримка", systemImage: "questionmark.circle")
            }
            Link("Політика конфіденційності", destination: Self.privacyURL)
            Link("Умови використання", destination: Self.termsURL)
        }
    }

    static let supportURL = URL(string: "https://kvuua-maker.github.io/Vakansio/legal/support.html")!
    static let privacyURL = URL(string: "https://kvuua-maker.github.io/Vakansio/legal/privacy.html")!
    static let termsURL = URL(string: "https://kvuua-maker.github.io/Vakansio/legal/terms.html")!

    // MARK: - Rows

    @ViewBuilder
    private func orderRow(_ order: OrderSummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(order.id).font(.caption.weight(.semibold))
                Spacer()
                Text(Money.uah(cents: order.totalCents)).font(.caption.weight(.bold))
            }

            Text("\(formattedDate(order.createdAt)) · \(order.statusTitle)")
                .font(.caption2)
                .foregroundStyle(order.status == "cancelled" ? .red : .secondary)

            ForEach(order.items) { item in
                Text("\(item.qty) × \(item.title)")
                    .font(.caption2)
                    .lineLimit(1)
            }

            if let urlString = order.trackingUrl, let url = URL(string: urlString) {
                Link("ТТН \(order.ttn ?? "") — відстежити", destination: url)
                    .font(.caption2)
            }

            HStack(spacing: 8) {
                Button {
                    reorder(order)
                } label: {
                    Label("Повторити замовлення", systemImage: "arrow.clockwise")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                if order.canCancel {
                    Button(role: .destructive) {
                        cancelTarget = order
                    } label: {
                        Label("Скасувати замовлення", systemImage: "xmark.circle")
                            .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .tint(.red)
                }
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: - Data

    private func refresh() async {
        await loadOrders()
        await loadFavorites()
    }

    private func loadOrders() async {
        // Guests see orders for their phone; signed-in users see the whole
        // account, so the phone is not required.
        let signedIn = SessionStore.token != nil
        guard signedIn || profile.isValidPhone else {
            orders = []
            return
        }
        isLoadingOrders = true
        defer { isLoadingOrders = false }
        do {
            orders = try await APIClient.shared.orders(phone: profile.phone).items
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadFavorites() async {
        guard !favorites.ids.isEmpty else {
            favoriteProducts = []
            return
        }
        favoriteProducts = (try? await APIClient.shared.products(ids: Array(favorites.ids)).items) ?? []
    }

    private func reorder(_ order: OrderSummary) {
        Task { @MainActor in
            do {
                let list = try await APIClient.shared.products(ids: order.items.map(\.productId))
                guard !list.items.isEmpty else {
                    notice = "Товари з цього замовлення більше недоступні."
                    return
                }
                for product in list.items {
                    let qty = order.items.first(where: { $0.productId == product.id })?.qty ?? 1
                    for _ in 0..<max(1, qty) {
                        cart.add(product)
                    }
                }
                notice = "Додано в кошик: \(list.items.count)"
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func cancel(_ order: OrderSummary) async {
        cancelTarget = nil
        notice = nil
        errorMessage = nil
        do {
            _ = try await APIClient.shared.cancelOrder(id: order.id)
            notice = "Замовлення \(order.id) скасовано."
            await loadOrders()
        } catch {
            errorMessage = error.localizedDescription
            await loadOrders()
        }
    }

    private func formattedDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: iso) else { return iso }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

// MARK: - Address editor

struct AddressEditor: View {
    let onSave: (String, String, String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var label = ""
    @State private var city = ""
    @State private var branch = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Назва") {
                    TextField("Дім, робота…", text: $label)
                }
                Section("Адреса") {
                    TextField("Місто", text: $city)
                    TextField("Відділення Нової Пошти", text: $branch)
                }
            }
            .navigationTitle("Нова адреса")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Скасувати") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Зберегти") {
                        onSave(label, city, branch)
                        dismiss()
                    }
                    .disabled(city.trimmingCharacters(in: .whitespaces).isEmpty ||
                              branch.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}

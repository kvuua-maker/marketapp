import Foundation

/// Favourites are stored locally; the catalog itself stays server-side.
@MainActor
final class FavoritesStore: ObservableObject {
    @Published private(set) var ids: Set<String> = []

    private let key = "marketapp.favorites"
    private let defaults = UserDefaults.standard

    init() {
        if let stored = defaults.array(forKey: key) as? [String] {
            ids = Set(stored)
        }
    }

    func contains(_ id: String) -> Bool { ids.contains(id) }

    func toggle(_ id: String) {
        if ids.contains(id) { ids.remove(id) } else { ids.insert(id) }
        defaults.set(Array(ids), forKey: key)
    }

    var count: Int { ids.count }
}

/// Phone number is the account identity (no passwords, no sign-up).
/// Also owns the appearance setting and saved delivery addresses.
@MainActor
final class ProfileStore: ObservableObject {
    @Published var phone: String {
        didSet { UserDefaults.standard.set(phone, forKey: Keys.phone) }
    }

    @Published var theme: ThemeMode {
        didSet { UserDefaults.standard.set(theme.rawValue, forKey: Keys.theme) }
    }

    @Published var addresses: [SavedAddress] {
        didSet { persistAddresses() }
    }

    private enum Keys {
        static let phone = "marketapp.phone"
        static let theme = "marketapp.theme"
        static let addresses = "marketapp.addresses"
    }

    init() {
        let defaults = UserDefaults.standard
        phone = defaults.string(forKey: Keys.phone) ?? ""
        theme = ThemeMode(rawValue: defaults.string(forKey: Keys.theme) ?? "") ?? .system
        if let data = defaults.data(forKey: Keys.addresses),
           let decoded = try? JSONDecoder().decode([SavedAddress].self, from: data) {
            addresses = decoded
        } else {
            addresses = []
        }
    }

    var isValidPhone: Bool {
        phone.filter(\.isNumber).count >= 10
    }

    func addAddress(label: String, city: String, branch: String) {
        let cityName = city.trimmingCharacters(in: .whitespacesAndNewlines)
        let branchName = branch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cityName.isEmpty, !branchName.isEmpty else { return }

        // Never store the same Nova Poshta branch twice.
        if let index = addresses.firstIndex(where: {
            $0.city.caseInsensitiveCompare(cityName) == .orderedSame &&
            $0.branch.caseInsensitiveCompare(branchName) == .orderedSame
        }) {
            let newLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
            if !newLabel.isEmpty, addresses[index].label != newLabel {
                addresses[index].label = newLabel
                persistAddresses()
            }
            return
        }

        let address = SavedAddress(
            label: label.isEmpty ? cityName : label,
            city: cityName,
            branch: branchName
        )
        addresses.append(address)
        persistAddresses()
    }

    func removeAddress(_ address: SavedAddress) {
        addresses.removeAll { $0.id == address.id }
    }

    private func persistAddresses() {
        guard let data = try? JSONEncoder().encode(addresses) else { return }
        UserDefaults.standard.set(data, forKey: Keys.addresses)
    }
}

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

/// Phone number is the account identity in this app (no passwords, no sign-up).
@MainActor
final class ProfileStore: ObservableObject {
    @Published var phone: String {
        didSet { UserDefaults.standard.set(phone, forKey: key) }
    }

    private let key = "marketapp.phone"

    init() {
        phone = UserDefaults.standard.string(forKey: key) ?? ""
    }

    var isValidPhone: Bool {
        phone.filter(\.isNumber).count >= 10
    }
}

import Foundation
import AuthenticationServices

/// Optional Apple sign-in. Requires the `com.apple.developer.applesignin`
/// entitlement, which the App ID provides once the capability is enabled in
/// the developer portal; CI verifies it in the signed app on every build.
///
/// Session token persisted between launches (optional Apple sign-in).
enum SessionStore {
    private static let tokenKey = "marketapp.sessionToken"
    private static let nameKey = "marketapp.sessionName"

    static var token: String? { UserDefaults.standard.string(forKey: tokenKey) }
    static var name: String? { UserDefaults.standard.string(forKey: nameKey) }

    static func save(token: String, name: String?) {
        UserDefaults.standard.set(token, forKey: tokenKey)
        if let name, !name.isEmpty {
            UserDefaults.standard.set(name, forKey: nameKey)
        }
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: tokenKey)
        UserDefaults.standard.removeObject(forKey: nameKey)
    }
}

@MainActor
final class AuthStore: ObservableObject {
    static let shared = AuthStore()

    @Published private(set) var isSignedIn = SessionStore.token != nil
    @Published private(set) var displayName: String? = SessionStore.name
    @Published private(set) var isWorking = false
    @Published var errorMessage: String?
    @Published var infoMessage: String?

    // MARK: - Sign in with Apple

    func handleAuthorization(
        _ result: Result<ASAuthorization, Error>,
        cart: CartStore,
        profile: ProfileStore
    ) async {
        switch result {
        case .failure(let error):
            if let authError = error as? ASAuthorizationError {
                if authError.code == .canceled { return }
                if authError.code == .unknown {
                    // error 1000: the App ID has no Sign in with Apple capability yet.
                    errorMessage = "Вхід через Apple ID ще не активовано для цього застосунку. Увімкніть Sign in with Apple для App ID — після наступної збірки вхід запрацює."
                    return
                }
                errorMessage = "Не вдалося увійти через Apple ID (код \(authError.code.rawValue)). Спробуйте пізніше."
                return
            }
            errorMessage = "Не вдалося увійти через Apple ID: \(error.localizedDescription)"
        case .success(let authorization):
            guard
                let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                let tokenData = credential.identityToken,
                let identityToken = String(data: tokenData, encoding: .utf8)
            else {
                errorMessage = "Apple не повернув токен входу"
                return
            }

            let fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
                .compactMap { $0 }
                .joined(separator: " ")

            await signIn(
                identityToken: identityToken,
                fullName: fullName.isEmpty ? nil : fullName,
                cart: cart,
                profile: profile
            )
        }
    }

    private func signIn(
        identityToken: String,
        fullName: String?,
        cart: CartStore,
        profile: ProfileStore
    ) async {
        isWorking = true
        errorMessage = nil
        infoMessage = nil
        defer { isWorking = false }

        do {
            let response = try await APIClient.shared.signInWithApple(
                identityToken: identityToken,
                fullName: fullName
            )
            SessionStore.save(token: response.sessionToken, name: response.user.name)
            displayName = response.user.name
            isSignedIn = true

            await sync(cart: cart, profile: profile)
            infoMessage = "Кошик та історію замовлень синхронізовано між пристроями."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signOut() {
        Task { try? await APIClient.shared.signOut() }
        SessionStore.clear()
        isSignedIn = false
        displayName = nil
        infoMessage = nil
        errorMessage = nil
    }

    // MARK: - Sync

    func syncNow(cart: CartStore, profile: ProfileStore) async {
        guard isSignedIn else { return }
        isWorking = true
        errorMessage = nil
        infoMessage = nil
        defer { isWorking = false }
        await sync(cart: cart, profile: profile)
        infoMessage = "Синхронізацію виконано."
    }

    private func sync(cart: CartStore, profile: ProfileStore) async {
        // Profile: pull remote values when this device has none, then push back.
        if let remote = try? await APIClient.shared.remoteProfile() {
            if profile.phone.isEmpty, let phone = remote.phone, !phone.isEmpty {
                profile.phone = phone
            }
            if profile.addresses.isEmpty, let addresses = remote.addresses {
                for address in addresses {
                    profile.addAddress(label: address.label, city: address.city, branch: address.branch)
                }
            }
        }

        let savedProfile: RemoteSaveResult? = try? await APIClient.shared.saveRemoteProfile(
            phone: profile.phone,
            addresses: profile.addresses
        )
        _ = savedProfile

        // Cart: bidirectional merge (pull → merge → push).
        await CartSync.mergeRemoteIntoLocal(cart)
    }
}

import Foundation

struct AuthUser: Codable {
    let id: String
    let email: String?
    let name: String?
}

struct AuthResponse: Codable {
    let sessionToken: String
    let user: AuthUser
    let ordersClaimed: Int?
}

struct RemoteAddress: Codable {
    let label: String
    let city: String
    let branch: String
}

struct RemoteProfile: Codable {
    let phone: String?
    let addresses: [RemoteAddress]?
    let updatedAt: String?
}

struct RemoteCartItem: Codable {
    let productId: String
    let qty: Int
}

struct RemoteCart: Codable {
    let items: [RemoteCartItem]
    let updatedAt: String?
}

struct SignedOutResult: Codable {
    let signedOut: Bool?
}

struct RemoteSaveResult: Codable {
    let saved: Bool?
    let count: Int?
}

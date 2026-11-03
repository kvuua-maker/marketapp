import SwiftUI
import UIKit

/// Two-level image cache: NSCache in memory + URLCache on disk.
/// Keeps scrolling smooth with thousands of products.
final class ImageCache {
    static let shared = ImageCache()

    private let memory = NSCache<NSURL, UIImage>()
    private let session: URLSession

    private init() {
        memory.countLimit = 400
        memory.totalCostLimit = 120 * 1024 * 1024

        let configuration = URLSessionConfiguration.default
        configuration.urlCache = URLCache(
            memoryCapacity: 32 * 1024 * 1024,
            diskCapacity: 512 * 1024 * 1024,
            diskPath: "marketapp-images"
        )
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        configuration.timeoutIntervalForRequest = 25
        session = URLSession(configuration: configuration)
    }

    func cached(_ url: URL) -> UIImage? {
        memory.object(forKey: url as NSURL)
    }

    func image(for url: URL) async throws -> UIImage {
        if let cached = cached(url) { return cached }
        let (data, _) = try await session.data(from: url)
        guard let image = UIImage(data: data) else {
            throw APIError(message: "Пошкоджене зображення")
        }
        memory.setObject(image, forKey: url as NSURL, cost: data.count)
        return image
    }
}

/// AsyncImage replacement with memory + disk caching and a lightweight placeholder.
struct CachedAsyncImage: View {
    let url: URL?
    var contentMode: ContentMode = .fill

    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            } else {
                Rectangle()
                    .fill(Color(.secondarySystemBackground))
                    .overlay {
                        ProgressView().controlSize(.small)
                    }
            }
        }
        .animation(.easeInOut(duration: 0.18), value: image != nil)
        .task(id: url) { await load() }
    }

    @MainActor
    private func load() async {
        guard let url else { return }
        if let cached = ImageCache.shared.cached(url) {
            image = cached
            return
        }
        image = try? await ImageCache.shared.image(for: url)
    }
}

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
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, _) = try await session.data(for: request)
        guard let image = UIImage(data: data) else {
            throw APIError(message: "Пошкоджене зображення")
        }
        memory.setObject(image, forKey: url as NSURL, cost: data.count)
        return image
    }

    /// Drops both cache levels so the next attempt really re-downloads.
    func evict(_ url: URL) {
        memory.removeObject(forKey: url as NSURL)
        session.configuration.urlCache?.removeCachedResponse(for: URLRequest(url: url))
    }
}

/// AsyncImage replacement with memory + disk caching, one automatic retry and
/// a manual "Повторити" button when the supplier photo is unavailable.
struct CachedAsyncImage: View {
    let url: URL?
    var contentMode: ContentMode = .fill

    @State private var image: UIImage?
    @State private var failed = false
    @State private var attempt = 0

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            } else if failed {
                Rectangle()
                    .fill(Color(.secondarySystemBackground))
                    .overlay {
                        Button {
                            attempt += 1
                        } label: {
                            VStack(spacing: 4) {
                                Image(systemName: "arrow.clockwise")
                                    .font(.caption.weight(.semibold))
                                Text("Повторити")
                                    .font(.caption2)
                            }
                            .foregroundStyle(.secondary)
                            .padding(6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Повторити завантаження фото")
                    }
            } else {
                Rectangle()
                    .fill(Color(.secondarySystemBackground))
                    .overlay {
                        ProgressView().controlSize(.small)
                    }
            }
        }
        .animation(.easeInOut(duration: 0.18), value: image != nil)
        .task(id: "\(url?.absoluteString ?? "none")#\(attempt)") { await load() }
    }

    @MainActor
    private func load() async {
        guard let url else {
            failed = true
            return
        }
        failed = false

        if let cached = ImageCache.shared.cached(url) {
            image = cached
            return
        }

        do {
            image = try await ImageCache.shared.image(for: url)
        } catch {
            // One silent retry, then let the customer press "Повторити".
            if attempt < 1 {
                try? await Task.sleep(nanoseconds: 700_000_000)
                guard !Task.isCancelled else { return }
                attempt += 1
            } else {
                ImageCache.shared.evict(url)
                failed = true
            }
        }
    }
}

import SwiftUI

/// Full-screen photo viewer: swipe between images, pinch to zoom, double-tap to reset.
struct ImageGalleryView: View {
    let images: [String]
    @State private var index: Int
    @Environment(\.dismiss) private var dismiss

    init(images: [String], startIndex: Int = 0) {
        self.images = images
        _index = State(initialValue: max(0, min(startIndex, max(images.count - 1, 0))))
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()

            TabView(selection: $index) {
                ForEach(images.indices, id: \.self) { index in
                    ZoomableImage(url: APIClient.imageURL(images[index], width: 1200))
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .always))
            .ignoresSafeArea()

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(12)
                    .background(.black.opacity(0.55), in: Circle())
            }
            .padding(16)
        }
        .statusBarHidden()
    }
}

struct ZoomableImage: View {
    let url: URL?

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        CachedAsyncImage(url: url, contentMode: .fit)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .scaleEffect(scale)
            .offset(offset)
            .gesture(
                MagnificationGesture()
                    .onChanged { value in
                        scale = min(max(lastScale * value, 1), 4)
                    }
                    .onEnded { _ in
                        lastScale = scale
                        if scale <= 1.01 {
                            withAnimation(.easeOut(duration: 0.2)) {
                                scale = 1
                                offset = .zero
                                lastOffset = .zero
                            }
                        }
                    }
            )
            .simultaneousGesture(
                DragGesture()
                    .onChanged { value in
                        guard scale > 1 else { return }
                        offset = CGSize(
                            width: lastOffset.width + value.translation.width,
                            height: lastOffset.height + value.translation.height
                        )
                    }
                    .onEnded { _ in
                        guard scale > 1 else { return }
                        lastOffset = offset
                    }
            )
            .onTapGesture(count: 2) {
                withAnimation(.easeOut(duration: 0.2)) {
                    if scale > 1 {
                        scale = 1
                        lastScale = 1
                        offset = .zero
                        lastOffset = .zero
                    } else {
                        scale = 2.5
                        lastScale = 2.5
                    }
                }
            }
    }
}

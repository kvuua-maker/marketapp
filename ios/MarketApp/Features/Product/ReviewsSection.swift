import SwiftUI

struct ReviewsSection: View {
    let productId: String
    @Binding var showSheet: Bool

    @State private var page: ReviewPage?
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Відгуки")
                    .font(.headline)
                if let page, page.count > 0 {
                    Text("(\(page.count))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Залишити відгук") { showSheet = true }
                    .font(.footnote.weight(.semibold))
            }

            if let errorMessage {
                Text(errorMessage).font(.caption).foregroundStyle(.secondary)
            }

            if let page {
                if page.items.isEmpty {
                    Text("Ще немає відгуків. Будьте першим.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(page.items) { review in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 4) {
                                ForEach(0..<5, id: \.self) { index in
                                    Image(systemName: index < review.rating ? "star.fill" : "star")
                                        .font(.caption2)
                                        .foregroundStyle(.orange)
                                }
                                Text(review.author)
                                    .font(.caption.weight(.semibold))
                                Spacer()
                            }
                            Text(review.text)
                                .font(.footnote)
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }
            }
        }
        .task { await load() }
        .onChange(of: showSheet) { _, isPresented in
            if !isPresented { Task { await load() } }
        }
    }

    private func load() async {
        do {
            page = try await APIClient.shared.reviews(productId: productId)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct ReviewComposer: View {
    let productId: String
    let productTitle: String

    @Environment(\.dismiss) private var dismiss
    @State private var author = ""
    @State private var rating = 5
    @State private var text = ""
    @State private var isSending = false
    @State private var errorMessage: String?

    private var canSubmit: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).count >= 8 &&
        author.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Оцінка") {
                    HStack(spacing: 8) {
                        ForEach(1...5, id: \.self) { value in
                            Button {
                                rating = value
                            } label: {
                                Image(systemName: value <= rating ? "star.fill" : "star")
                                    .font(.title3)
                                    .foregroundStyle(.orange)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                Section("Ваше імʼя") {
                    TextField("Наприклад, Іван П.", text: $author)
                }

                Section("Відгук") {
                    TextField("Що сподобалось або не сподобалось", text: $text, axis: .vertical)
                        .lineLimit(4...8)
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
                            if isSending { ProgressView().tint(.white) }
                            Text(isSending ? "Надсилаємо…" : "Опублікувати")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canSubmit || isSending)
                }
            }
            .navigationTitle("Відгук")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрити") { dismiss() }
                }
            }
        }
    }

    private func submit() {
        isSending = true
        errorMessage = nil
        Task { @MainActor in
            do {
                _ = try await APIClient.shared.submitReview(
                    productId: productId,
                    author: author,
                    rating: rating,
                    text: text
                )
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            isSending = false
        }
    }
}

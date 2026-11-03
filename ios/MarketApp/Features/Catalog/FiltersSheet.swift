import SwiftUI

struct FiltersSheet: View {
    @EnvironmentObject private var catalog: CatalogViewModel
    @Environment(\.dismiss) private var dismiss

    let options: FilterOptions?

    @State private var minPrice: Double = 0
    @State private var maxPrice: Double = 0
    @State private var brands: Set<String> = []
    @State private var onlyInStock = true
    @State private var loaded = false

    private var lowerBound: Double { Double(options?.minPriceCents ?? 0) }
    private var upperBound: Double {
        max(Double(options?.maxPriceCents ?? 100_000_00), lowerBound + 100)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("від \(Money.uah(cents: Int(minPrice)))")
                            Spacer()
                            Text("до \(Money.uah(cents: Int(maxPrice)))")
                        }
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                        Slider(value: $minPrice, in: lowerBound...max(upperBound, lowerBound + 1), step: 100)
                            .onChange(of: minPrice) { _, value in
                                if value > maxPrice { maxPrice = value }
                            }
                        Slider(value: $maxPrice, in: lowerBound...max(upperBound, lowerBound + 1), step: 100)
                            .onChange(of: maxPrice) { _, value in
                                if value < minPrice { minPrice = value }
                            }
                    }
                } header: {
                    Text("Ціна")
                }

                Section {
                    Toggle("Тільки в наявності", isOn: $onlyInStock)
                }

                if let options, !options.brands.isEmpty {
                    Section("Бренди") {
                        ForEach(options.brands) { brand in
                            Button {
                                if brands.contains(brand.name) {
                                    brands.remove(brand.name)
                                } else {
                                    brands.insert(brand.name)
                                }
                            } label: {
                                HStack {
                                    Text(brand.name).foregroundStyle(.primary)
                                    Text("\(brand.count)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    Spacer()
                                    Image(systemName: brands.contains(brand.name) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(brands.contains(brand.name) ? Theme.accent : .secondary)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .navigationTitle("Фільтри")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Скасувати") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Застосувати") { apply() }
                        .fontWeight(.semibold)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    reset()
                } label: {
                    Text("Скинути фільтри")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }
        }
        .onAppear(perform: loadCurrentValues)
    }

    private func loadCurrentValues() {
        guard !loaded else { return }
        loaded = true
        minPrice = Double(catalog.minPriceCents ?? options?.minPriceCents ?? 0)
        maxPrice = Double(catalog.maxPriceCents ?? options?.maxPriceCents ?? 100_000_00)
        brands = catalog.selectedBrands
        onlyInStock = catalog.onlyInStock
    }

    private func apply() {
        let min = Int(minPrice) == Int(options?.minPriceCents ?? -1) ? nil : Int(minPrice)
        let max = Int(maxPrice) == Int(options?.maxPriceCents ?? -1) ? nil : Int(maxPrice)
        catalog.applyFilters(min: min, max: max, brands: brands, onlyInStock: onlyInStock)
        dismiss()
    }

    private func reset() {
        brands = []
        onlyInStock = true
        minPrice = Double(options?.minPriceCents ?? 0)
        maxPrice = Double(options?.maxPriceCents ?? 100_000_00)
        catalog.applyFilters(min: nil, max: nil, brands: [], onlyInStock: true)
        dismiss()
    }
}

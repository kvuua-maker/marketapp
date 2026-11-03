import Foundation

enum Money {
    private static let formatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.groupingSeparator = " "
        formatter.maximumFractionDigits = 0
        formatter.minimumFractionDigits = 0
        return formatter
    }()

    static func uah(cents: Int) -> String {
        let hryvnias = cents / 100
        let kopecks = cents % 100
        let whole = formatter.string(from: NSNumber(value: hryvnias)) ?? "\(hryvnias)"
        return kopecks == 0 ? "\(whole) ₴" : "\(whole),\(String(format: "%02d", kopecks)) ₴"
    }
}

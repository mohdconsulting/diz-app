import Foundation

/// Time slots for jobs. Every slot is one hour; a customer (or a provider proposing another time) picks one
/// or more consecutive hours on a single day.
enum Scheduling {
    static let slotSeconds: TimeInterval = 3600
    static let firstHour = 8          // first slot 08:00–09:00
    static let lastHour = 20          // last slot 20:00–21:00
    static let daysAhead = 14
    static let maxSlots = 12          // matches the database check (max 12 hours)
    static let leadSeconds: TimeInterval = 1800   // a slot must start at least 30 min from now

    static func ms(_ d: Date) -> Int64 { Int64((d.timeIntervalSince1970 * 1000).rounded()) }
    static func date(ms: Int64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }

    static func days(now: Date = Date(), calendar: Calendar = .current) -> [Date] {
        let start = calendar.startOfDay(for: now)
        return (0..<daysAhead).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }

    static func slots(on day: Date, now: Date = Date(), calendar: Calendar = .current) -> [Date] {
        let base = calendar.startOfDay(for: day)
        return (firstHour...lastHour).compactMap { h in
            guard let d = calendar.date(bySettingHour: h, minute: 0, second: 0, of: base) else { return nil }
            return d > now.addingTimeInterval(leadSeconds) ? d : nil
        }
    }

    // MARK: Formatting
    private static func formatter(_ template: String, _ lang: Lang) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: lang.rawValue)
        f.setLocalizedDateFormatFromTemplate(template)
        return f
    }

    static func dayText(_ d: Date, _ lang: Lang) -> String { formatter("EEEdMMM", lang).string(from: d) }
    static func shortDayText(_ d: Date, _ lang: Lang) -> String { formatter("EEEd", lang).string(from: d) }
    static func timeText(_ d: Date, _ lang: Lang) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: lang.rawValue)
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
    static func slotText(_ start: Date, _ lang: Lang) -> String {
        timeText(start, lang) + "–" + timeText(start.addingTimeInterval(slotSeconds), lang)
    }
    /// "Tue 14 Oct, 10:00–13:00"
    static func windowText(start: Date, end: Date, _ lang: Lang) -> String {
        dayText(start, lang) + ", " + timeText(start, lang) + "–" + timeText(end, lang)
    }
}

/// The hours a user has selected on one day. Tapping adjacent hours extends the window.
struct SlotSelection: Equatable {
    var start: Date?
    var end: Date?

    var isEmpty: Bool { start == nil || end == nil }
    var hours: Int {
        guard let s = start, let e = end else { return 0 }
        return Int(((e.timeIntervalSince(s)) / Scheduling.slotSeconds).rounded())
    }

    mutating func clear() { start = nil; end = nil }

    func contains(_ slot: Date) -> Bool {
        guard let s = start, let e = end else { return false }
        return slot >= s && slot < e
    }

    mutating func tap(_ slot: Date) {
        let slotEnd = slot.addingTimeInterval(Scheduling.slotSeconds)
        guard let s = start, let e = end else { start = slot; end = slotEnd; return }
        if contains(slot) {
            if hours == 1 { clear(); return }
            if slot == s { start = slotEnd }
            else if slotEnd == e { end = slot }
            else { start = slot; end = slotEnd }      // tapped in the middle: start over from that hour
            return
        }
        if slot == e && hours < Scheduling.maxSlots { end = slotEnd }
        else if slotEnd == s && hours < Scheduling.maxSlots { start = slot }
        else { start = slot; end = slotEnd }
    }
}

/// What the customer asked for when creating a request.
struct ScheduleChoice: Equatable {
    var asap = true
    var selection = SlotSelection()
}

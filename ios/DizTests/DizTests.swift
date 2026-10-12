import XCTest
@testable import Diz

final class DizTests: XCTestCase {
    func testPricingMatchesWeb() {
        XCTAssertEqual(Pricing.price(service: "junk", size: 1, cat: "furniture"), 25000)
        XCTAssertEqual(Pricing.price(service: "junk", size: 2, cat: "appliances"), 50000)
        XCTAssertEqual(Pricing.price(service: "towing", size: 3, cat: "transport"), 90000)
        XCTAssertEqual(Pricing.price(service: "unknown", size: nil, cat: nil), 200)
    }

    func testAuthEmail() {
        XCTAssertEqual(Config.authEmail(phone: "+964 770-123"), "diz.964770123@gmail.com")
        XCTAssertEqual(Config.authEmail(phone: "  "), "")
    }

    func testStringsAllLanguages() {
        let s = Strings.shared
        XCTAssertFalse(s.services.isEmpty)
        for l in Lang.allCases {
            XCTAssertNotEqual(s.text("logoutBtn", l), "logoutBtn")
            XCTAssertNotEqual(s.text("services.junk.label", l), "services.junk.label")
        }
        XCTAssertTrue(s.text("pay.payBtn", .en, ["amount": "5 IQD"]).contains("5 IQD"))
    }

    func testJobDecoding() throws {
        let json = """
        [{"id":"a1","service":"junk","cat":"furniture","size":1,"desc_text":"Sofa","addr":"X","price":25000,
          "status":"accepted","owner_phone":"1","accepted_by_phone":"2","problem_reported":true,
          "applicants":[{"phone":"2","name":"Ali","price":25000,"appliedAt":5}],"created_at":1700000000000}]
        """.data(using: .utf8)!
        let jobs = try JSONDecoder().decode([Job].self, from: json)
        XCTAssertEqual(jobs[0].desc, "Sofa")
        XCTAssertEqual(jobs[0].applicants.first?.name, "Ali")
        XCTAssertEqual(jobs[0].statusKey, "problem")
        XCTAssertEqual(jobs[0].createdAt, 1700000000000)
    }

    func testProviderCanTake() async {
        let u = try? JSONDecoder().decode(AppUser.self, from: #"{"id":"u","phone":"2","name":"A","role":"driver","profiles":["driver"]}"#.data(using: .utf8)!)
        XCTAssertEqual(u?.profiles, ["driver"])
    }
}

final class DigitTests: XCTestCase {
    func testArabicIndicDigits() {
        XCTAssertEqual("٠٧٧٠١٢٣".asciiDigits, "0770123")
        XCTAssertEqual("۱۲۳".asciiDigits, "123")
        XCTAssertEqual("٢٥٠٠٠".intValue, 25000)
        XCTAssertEqual("25 000".intValue, 25000)
        XCTAssertEqual(Config.authEmail(phone: "٠٧٧٠١٢٣"), "diz.0770123@gmail.com")
    }
}

final class SchedulingTests: XCTestCase {
    private let cal = Calendar.current
    private func at(_ h: Int) -> Date { cal.date(bySettingHour: h, minute: 0, second: 0, of: Date(timeIntervalSince1970: 1_800_000_000))! }

    func testSelectionExtendsAndShrinks() {
        var s = SlotSelection()
        s.tap(at(10)); XCTAssertEqual(s.hours, 1)
        s.tap(at(11)); XCTAssertEqual(s.hours, 2)          // extend after
        s.tap(at(9));  XCTAssertEqual(s.hours, 3)          // extend before
        XCTAssertEqual(s.start, at(9)); XCTAssertEqual(s.end, at(12))
        s.tap(at(9));  XCTAssertEqual(s.start, at(10))     // shrink from start
        s.tap(at(11)); XCTAssertEqual(s.end, at(11))       // shrink from end
        s.tap(at(10)); XCTAssertTrue(s.isEmpty)            // deselect the last hour
        s.tap(at(10)); s.tap(at(15)); XCTAssertEqual(s.hours, 1)   // not adjacent: start over
        XCTAssertEqual(s.start, at(15))
    }

    func testSlotsAreOneHourAndRespectNow() {
        let day = at(8)
        let now = at(8).addingTimeInterval(-86400)
        let all = Scheduling.slots(on: day, now: now)
        XCTAssertEqual(all.count, Scheduling.lastHour - Scheduling.firstHour + 1)
        XCTAssertEqual(Scheduling.slotSeconds, 3600)
        let later = Scheduling.slots(on: day, now: at(12))
        XCTAssertEqual(later.first, at(13))                 // 12:00 + 30 min lead rules out 12:00 itself
    }

    func testApplicantProposalAndAgreedWindow() throws {
        let json = """
        {"id":"j","service":"junk","price":1,"status":"accepted","accepted_by_phone":"2","schedule_type":"slot",
         "slot_start":1800000000000,"slot_end":1800003600000,
         "applicants":[{"phone":"2","name":"A","price":1,"proposedStart":1800007200000,"proposedEnd":1800010800000}],
         "created_at":1}
        """.data(using: .utf8)!
        let j = try JSONDecoder().decode(Job.self, from: json)
        XCTAssertEqual(Scheduling.ms(j.requestedWindow!.start), 1800000000000)
        XCTAssertEqual(Scheduling.ms(j.agreedWindow!.start), 1800007200000)
    }
}

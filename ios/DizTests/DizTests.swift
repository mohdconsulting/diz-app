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

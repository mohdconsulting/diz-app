import Foundation

struct Applicant: Codable, Hashable {
    var phone: String
    var name: String
    var price: Int
    var appliedAt: Int64?
}

/// A row of the table `jobs` (snake_case columns, see diz_supabase_schema.sql).
struct Job: Decodable, Identifiable, Hashable {
    var id: String
    var service: String
    var cat: String?
    var size: Int?
    var desc: String
    var addr: String
    var toAddr: String?
    var addrLat: Double?
    var addrLng: Double?
    var toLat: Double?
    var toLng: Double?
    var price: Int
    var status: String
    var ownerPhone: String?
    var acceptedByPhone: String?
    var applicants: [Applicant]
    var arrived: Bool
    var arrivedAt: Int64?
    var markedDoneByProvider: Bool
    var markedDoneAt: Int64?
    var paymentReleased: Bool
    var completedAt: Int64?
    var problemReported: Bool
    var problemText: String?
    var providerResponse: String?
    var autoReleased: Bool
    var resolution: String?
    var createdAt: Int64

    enum CodingKeys: String, CodingKey {
        case id, service, cat, size, addr, price, status, applicants, arrived, resolution
        case desc = "desc_text", toAddr = "to_addr", addrLat = "addr_lat", addrLng = "addr_lng", toLat = "to_lat", toLng = "to_lng"
        case ownerPhone = "owner_phone", acceptedByPhone = "accepted_by_phone", arrivedAt = "arrived_at"
        case markedDoneByProvider = "marked_done_by_provider", markedDoneAt = "marked_done_at"
        case paymentReleased = "payment_released", completedAt = "completed_at", problemReported = "problem_reported"
        case problemText = "problem_text", providerResponse = "provider_response", autoReleased = "auto_released"
        case createdAt = "created_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        service = try c.decode(String.self, forKey: .service)
        cat = try c.decodeIfPresent(String.self, forKey: .cat)
        size = try c.decodeIfPresent(Int.self, forKey: .size)
        desc = try c.decodeIfPresent(String.self, forKey: .desc) ?? ""
        addr = try c.decodeIfPresent(String.self, forKey: .addr) ?? ""
        toAddr = try c.decodeIfPresent(String.self, forKey: .toAddr)
        addrLat = try c.decodeIfPresent(Double.self, forKey: .addrLat)
        addrLng = try c.decodeIfPresent(Double.self, forKey: .addrLng)
        toLat = try c.decodeIfPresent(Double.self, forKey: .toLat)
        toLng = try c.decodeIfPresent(Double.self, forKey: .toLng)
        price = try c.decodeIfPresent(Int.self, forKey: .price) ?? 0
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "open"
        ownerPhone = try c.decodeIfPresent(String.self, forKey: .ownerPhone)
        acceptedByPhone = try c.decodeIfPresent(String.self, forKey: .acceptedByPhone)
        applicants = try c.decodeIfPresent([Applicant].self, forKey: .applicants) ?? []
        arrived = try c.decodeIfPresent(Bool.self, forKey: .arrived) ?? false
        arrivedAt = try c.decodeIfPresent(Int64.self, forKey: .arrivedAt)
        markedDoneByProvider = try c.decodeIfPresent(Bool.self, forKey: .markedDoneByProvider) ?? false
        markedDoneAt = try c.decodeIfPresent(Int64.self, forKey: .markedDoneAt)
        paymentReleased = try c.decodeIfPresent(Bool.self, forKey: .paymentReleased) ?? false
        completedAt = try c.decodeIfPresent(Int64.self, forKey: .completedAt)
        problemReported = try c.decodeIfPresent(Bool.self, forKey: .problemReported) ?? false
        problemText = try c.decodeIfPresent(String.self, forKey: .problemText)
        providerResponse = try c.decodeIfPresent(String.self, forKey: .providerResponse)
        autoReleased = try c.decodeIfPresent(Bool.self, forKey: .autoReleased) ?? false
        resolution = try c.decodeIfPresent(String.self, forKey: .resolution)
        createdAt = try c.decodeIfPresent(Int64.self, forKey: .createdAt) ?? 0
    }

    /// Same mapping as effectiveStatusKey() in src/jobs.ts.
    var statusKey: String {
        if status == "accepted" && problemReported { return "problem" }
        if status == "accepted" && (arrived || markedDoneByProvider) { return "arrived" }
        return status
    }
    var isFinal: Bool { status == "done" || status == "cancelled" }
    var hasPin: Bool { addrLat != nil && addrLng != nil }
}

struct AppUser: Decodable, Hashable {
    var id: String
    var phone: String
    var name: String
    var role: String            // customer | driver | admin
    var profiles: [String]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        phone = try c.decode(String.self, forKey: .phone)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        role = try c.decodeIfPresent(String.self, forKey: .role) ?? "customer"
        profiles = try c.decodeIfPresent([String].self, forKey: .profiles) ?? []
    }
    enum CodingKeys: String, CodingKey { case id, phone, name, role, profiles }
    var isDriver: Bool { role == "driver" }
}

struct ChatMessage: Decodable, Identifiable, Hashable {
    var id: Int
    var jobId: String
    var senderPhone: String
    var recipientPhone: String
    var body: String
    var createdAt: Int64
    var readAt: Int64?
    enum CodingKeys: String, CodingKey {
        case id, body
        case jobId = "job_id", senderPhone = "sender_phone", recipientPhone = "recipient_phone"
        case createdAt = "created_at", readAt = "read_at"
    }
}

struct Review: Decodable, Hashable {
    var jobId: String
    var providerPhone: String
    var rating: Int
    var comment: String?
    var hidden: Bool
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        jobId = try c.decode(String.self, forKey: .jobId)
        providerPhone = try c.decode(String.self, forKey: .providerPhone)
        rating = try c.decode(Int.self, forKey: .rating)
        comment = try c.decodeIfPresent(String.self, forKey: .comment)
        hidden = try c.decodeIfPresent(Bool.self, forKey: .hidden) ?? false
    }
    enum CodingKeys: String, CodingKey { case rating, comment, hidden; case jobId = "job_id", providerPhone = "provider_phone" }
}

struct Rating: Hashable { var avg: Double; var count: Int }

struct ProviderComment: Decodable, Hashable {
    var rating: Int
    var comment: String?
    var createdAt: Int64
    enum CodingKeys: String, CodingKey { case rating, comment; case createdAt = "created_at" }
}

struct ProviderLocation: Decodable, Hashable {
    var jobId: String
    var lat: Double
    var lng: Double
    var updatedAt: Int64
    enum CodingKeys: String, CodingKey { case lat, lng; case jobId = "job_id", updatedAt = "updated_at" }
}

struct PaymentRow: Decodable, Hashable {
    var id: String
    var jobId: String
    var status: String
    enum CodingKeys: String, CodingKey { case id, status; case jobId = "job_id" }
}

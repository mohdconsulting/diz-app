import Foundation

/// Texts that only exist in the iPhone app (the shared texts come from strings.json, generated from the web app).
enum Extra {
    static let table: [String: [Lang: String]] = [
        "account.deleteBtn": [.sv: "Radera mitt konto", .en: "Delete my account", .ar: "حذف حسابي"],
        "account.deleteTitle": [.sv: "Radera kontot?", .en: "Delete account?", .ar: "حذف الحساب؟"],
        "account.deleteMsg": [
            .sv: "Ditt konto, dina öppna förfrågningar och dina meddelanden raderas permanent. Avslutade uppdrag och betalningsposter sparas anonymiserat. Det går inte att ångra.",
            .en: "Your account, open requests and messages are deleted permanently. Completed jobs and payment records are kept anonymised. This cannot be undone.",
            .ar: "سيتم حذف حسابك وطلباتك المفتوحة ورسائلك نهائيًا. تُحفظ المهام المكتملة وسجلات الدفع بشكل مجهول. لا يمكن التراجع عن ذلك."],
        "account.deleteConfirm": [.sv: "Ja, radera", .en: "Yes, delete", .ar: "نعم، احذف"],
        "account.deleteActive": [
            .sv: "Du har ett pågående uppdrag. Avsluta det innan du raderar kontot.",
            .en: "You have an active job. Finish it before deleting your account.",
            .ar: "لديك مهمة جارية. أنهِها قبل حذف حسابك."],
        "account.deleteFailed": [.sv: "Kunde inte radera kontot. Försök igen.", .en: "Could not delete the account. Try again.", .ar: "تعذّر حذف الحساب. حاول مرة أخرى."],
        "account.deleted": [.sv: "Kontot är raderat.", .en: "Your account has been deleted.", .ar: "تم حذف الحساب."],
        "account.privacy": [.sv: "Integritetspolicy", .en: "Privacy policy", .ar: "سياسة الخصوصية"],
    ]
}

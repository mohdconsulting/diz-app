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
        "sched.title": [.sv: "När ska uppdraget utföras?", .en: "When should the job be done?", .ar: "متى يجب تنفيذ المهمة؟"],
        "sched.asap": [.sv: "Omgående", .en: "ASAP", .ar: "فورًا"],
        "sched.asapLong": [.sv: "Omgående – tidigast möjligt", .en: "As soon as possible", .ar: "فورًا – في أقرب وقت ممكن"],
        "sched.pick": [.sv: "Välj tid", .en: "Pick a time", .ar: "اختر وقتًا"],
        "sched.hint": [.sv: "Varje ruta är en timme. Tryck på intilliggande timmar för längre tid.", .en: "Each box is one hour. Tap neighbouring hours for a longer window.", .ar: "كل خانة ساعة واحدة. اضغط على الساعات المتجاورة لفترة أطول."],
        "sched.noSlots": [.sv: "Inga lediga tider den här dagen.", .en: "No time slots left on this day.", .ar: "لا توجد أوقات متاحة في هذا اليوم."],
        "sched.chooseTime": [.sv: "Välj dag och tid först", .en: "Choose a day and time first", .ar: "اختر اليوم والوقت أولاً"],
        "sched.requested": [.sv: "Önskad tid", .en: "Requested time", .ar: "الوقت المطلوب"],
        "sched.agreed": [.sv: "Överenskommen tid", .en: "Agreed time", .ar: "الوقت المتفق عليه"],
        "sched.proposed": [.sv: "Föreslår", .en: "Proposes", .ar: "يقترح"],
        "sched.fitsRequested": [.sv: "Passar önskad tid", .en: "Fits the requested time", .ar: "يناسب الوقت المطلوب"],
        "sched.hours": [.sv: "{n} tim", .en: "{n} h", .ar: "{n} ساعة"],
        "sched.proposeBtn": [.sv: "Föreslå annan tid", .en: "Propose another time", .ar: "اقترح وقتًا آخر"],
        "sched.proposeSend": [.sv: "Skicka förslag", .en: "Send proposal", .ar: "إرسال الاقتراح"],
        "sched.proposeNote": [.sv: "Kunden godkänner genom att välja dig.", .en: "The customer accepts by choosing you.", .ar: "يوافق العميل باختيارك."],
        "sched.proposeClose": [.sv: "Dölj", .en: "Hide", .ar: "إخفاء"],
        "sched.yourProposal": [.sv: "Ditt förslag", .en: "Your proposal", .ar: "اقتراحك"],
        "sched.priceLabel": [.sv: "Pris", .en: "Price", .ar: "السعر"],
        "call.micDenied": [.sv: "Mikrofonen är blockerad. Tillåt mikrofon för dizli i iPhonens Inställningar.", .en: "The microphone is blocked. Allow the microphone for dizli in iPhone Settings.", .ar: "الميكروفون محظور. اسمح لتطبيق ديزلي باستخدام الميكروفون من إعدادات الآيفون."],
        "call.speaker": [.sv: "Högtalare", .en: "Speaker", .ar: "مكبر الصوت"],
        "call.noMic": [.sv: "Hittar ingen mikrofon på enheten.", .en: "No microphone found on this device.", .ar: "لا يوجد ميكروفون في الجهاز."],
        "call.ipNote": [.sv: "Samtalet går direkt mellan era enheter och spelas inte in. Telefonnummer visas inte, men den andra enheten kan se din IP-adress. Samtal kan bara tas emot medan appen är öppen.", .en: "The call goes directly between your devices and is not recorded. Phone numbers are not shown, but the other device can see your IP address. Calls can only be received while the app is open.", .ar: "تتم المكالمة مباشرة بين جهازيكما ولا يتم تسجيلها. لا تظهر أرقام الهواتف، لكن الجهاز الآخر يمكنه رؤية عنوان IP الخاص بك. لا يمكن استقبال المكالمات إلا أثناء فتح التطبيق."],
        "account.privacy": [.sv: "Integritetspolicy", .en: "Privacy policy", .ar: "سياسة الخصوصية"],
    ]
}

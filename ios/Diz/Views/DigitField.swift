import SwiftUI
import UIKit

/// UIKit-backed text field for phone numbers and prices. SwiftUI's TextField lost input in some keyboard /
/// RTL combinations (typed digits not shown, field cleared). This wrapper edits the text itself in
/// shouldChangeCharactersIn, so every typed character is converted to ASCII right away (Arabic-Indic digits
/// included) and unwanted characters are dropped before they ever reach the field.
/// UITextField whose whole rectangle (including the padding) is tappable and edits text.
final class PaddedField: UITextField {
    var inset: CGFloat = 10
    override func textRect(forBounds b: CGRect) -> CGRect { b.insetBy(dx: inset, dy: 0) }
    override func editingRect(forBounds b: CGRect) -> CGRect { b.insetBy(dx: inset, dy: 0) }
    override func placeholderRect(forBounds b: CGRect) -> CGRect { b.insetBy(dx: inset, dy: 0) }
}

struct DigitField: UIViewRepresentable {
    var placeholder: String
    @Binding var text: String
    var allowPlusAndSpace = false
    var inset: CGFloat = 10

    func makeUIView(context: Context) -> UITextField {
        let f = PaddedField()
        f.inset = inset
        f.delegate = context.coordinator
        f.attributedPlaceholder = NSAttributedString(string: placeholder, attributes: [.foregroundColor: UIColor(Color.dizMuted)])
        f.keyboardType = .numbersAndPunctuation
        f.autocorrectionType = .no
        f.autocapitalizationType = .none
        f.textContentType = .none
        f.textAlignment = .left
        f.semanticContentAttribute = .forceLeftToRight   // digits always read left-to-right
        f.textColor = UIColor(Color.dizInk)
        f.overrideUserInterfaceStyle = .light
        f.tintColor = UIColor(Color.dizBrand)
        f.font = .preferredFont(forTextStyle: .body)
        f.adjustsFontForContentSizeCategory = true
        f.returnKeyType = .done
        f.setContentHuggingPriority(.defaultLow, for: .horizontal)
        // numbersAndPunctuation has no guaranteed return key, so offer a "done" bar.
        let bar = UIToolbar(frame: CGRect(x: 0, y: 0, width: 320, height: 44))
        bar.items = [UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil),
                     UIBarButtonItem(barButtonSystemItem: .done, target: f, action: #selector(UIResponder.resignFirstResponder))]
        f.inputAccessoryView = bar
        f.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        return f
    }

    func updateUIView(_ f: UITextField, context: Context) {
        context.coordinator.parent = self
        if f.text != text { f.text = text }
        f.attributedPlaceholder = NSAttributedString(string: placeholder, attributes: [.foregroundColor: UIColor(Color.dizMuted)])
    }

    /// Always as wide as the space offered (a bare UITextField would shrink to its placeholder and be hard to hit).
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextField, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 200, height: 44)
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: DigitField
        init(_ p: DigitField) { parent = p }

        func clean(_ s: String) -> String {
            let plus = parent.allowPlusAndSpace
            return String(s.asciiDigits.filter { $0.isASCII && ($0.isNumber || (plus && ($0 == "+" || $0 == " "))) })
        }

        func textField(_ tf: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
            let current = tf.text ?? ""
            guard let r = Range(range, in: current) else { return false }
            let new = clean(current.replacingCharacters(in: r, with: string))
            tf.text = new
            parent.text = new
            return false   // we applied the change ourselves
        }

        @objc func changed(_ tf: UITextField) {
            let new = clean(tf.text ?? "")
            if new != tf.text { tf.text = new }
            if parent.text != new { parent.text = new }
        }

        func textFieldShouldReturn(_ tf: UITextField) -> Bool { tf.resignFirstResponder(); return true }
    }
}

/// UIKit-backed text field for names and passwords (the same approach as DigitField). SwiftUI's TextField /
/// SecureField dropped typed input in the forced-RTL environment, so the sign-in and sign-up forms use this instead.
struct TextInputField: UIViewRepresentable {
    var placeholder: String
    @Binding var text: String
    var secure = false
    var capitalization: UITextAutocapitalizationType = .none
    var inset: CGFloat = 10

    func makeUIView(context: Context) -> UITextField {
        let f = PaddedField()
        f.inset = inset
        f.delegate = context.coordinator
        f.attributedPlaceholder = NSAttributedString(string: placeholder, attributes: [.foregroundColor: UIColor(Color.dizMuted)])
        f.isSecureTextEntry = secure
        f.keyboardType = .default
        f.autocorrectionType = .no
        f.spellCheckingType = .no
        f.autocapitalizationType = secure ? .none : capitalization
        f.textContentType = .none
        f.textColor = UIColor(Color.dizInk)
        f.overrideUserInterfaceStyle = .light
        f.tintColor = UIColor(Color.dizBrand)
        f.font = .preferredFont(forTextStyle: .body)
        f.adjustsFontForContentSizeCategory = true
        f.returnKeyType = .done
        f.clearButtonMode = .never
        f.setContentHuggingPriority(.defaultLow, for: .horizontal)
        f.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        return f
    }

    func updateUIView(_ f: UITextField, context: Context) {
        context.coordinator.parent = self
        if f.text != text { f.text = text }
        f.attributedPlaceholder = NSAttributedString(string: placeholder, attributes: [.foregroundColor: UIColor(Color.dizMuted)])
        let rtl = context.environment.layoutDirection == .rightToLeft
        f.semanticContentAttribute = rtl ? .forceRightToLeft : .forceLeftToRight
        f.textAlignment = rtl ? .right : .left
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextField, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 200, height: 44)
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: TextInputField
        init(_ p: TextInputField) { parent = p }
        @objc func changed(_ tf: UITextField) {
            let new = tf.text ?? ""
            if parent.text != new { parent.text = new }
        }
        func textFieldShouldReturn(_ tf: UITextField) -> Bool { tf.resignFirstResponder(); return true }
    }
}

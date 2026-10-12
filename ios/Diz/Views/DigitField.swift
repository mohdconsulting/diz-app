import SwiftUI
import UIKit

/// UIKit-backed text field for phone numbers and prices. SwiftUI's TextField lost input in some keyboard /
/// RTL combinations (typed digits not shown, field cleared). This wrapper edits the text itself in
/// shouldChangeCharactersIn, so every typed character is converted to ASCII right away (Arabic-Indic digits
/// included) and unwanted characters are dropped before they ever reach the field.
struct DigitField: UIViewRepresentable {
    var placeholder: String
    @Binding var text: String
    var allowPlusAndSpace = false

    func makeUIView(context: Context) -> UITextField {
        let f = UITextField()
        f.delegate = context.coordinator
        f.placeholder = placeholder
        f.keyboardType = .numbersAndPunctuation
        f.autocorrectionType = .no
        f.autocapitalizationType = .none
        f.textContentType = .none
        f.textAlignment = .left
        f.semanticContentAttribute = .forceLeftToRight   // digits always read left-to-right
        f.textColor = .label
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
        f.placeholder = placeholder
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

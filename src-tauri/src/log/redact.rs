//! Redaction is the single native text choke point (AD-5, DT-10).

pub fn redact(input: &str) -> String {
    input.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_pairing_codes_and_exact_six_digit_runs() {
        assert_eq!(redact("1234-567890 and 482913"), "****-****** and ******");
    }

    #[test]
    fn leaves_other_digit_runs_and_ports_untouched() {
        let input = "12345 1234567 :37099 01234-5678902";
        assert_eq!(redact(input), input);
    }

    #[test]
    fn redacts_json_secret_string_values() {
        assert_eq!(
            redact(r#"{"pairing_code":"482913","x":1}"#),
            r#"{"pairing_code":"[redacted]","x":1}"#
        );
        assert_eq!(
            redact(r#"{"token":"eyJhbGciOiJIUzI1NiJ9.payload.signature"}"#),
            r#"{"token":"[redacted]}"#
        );
        assert_eq!(
            redact(r#"{"auth_token" : "short"}"#),
            r#"{"auth_token" : "[redacted]}"#
        );
    }

    #[test]
    fn non_ascii_text_passes_through_unchanged() {
        let input = "café 東京 — no digits";
        assert_eq!(redact(input), input);
    }
}

//! Redaction is the single native text choke point (AD-5, DT-10). Hand-scanned
//! so the core adds no regex or logging dependency.

/// Mask ephemeral pairing codes, exact six-digit runs, and secret JSON values.
/// Everything else is copied byte-for-byte.
pub fn redact(input: &str) -> String {
    let codes = mask_pairing_codes(input);
    let digits = mask_six_digits(&codes);
    let json = mask_json_values(&digits);
    let urls = mask_url_userinfo(&json);
    mask_jwts(&urls)
}

fn ascii_digit(byte: u8) -> bool {
    byte.is_ascii_digit()
}

fn mask_pairing_codes(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut index = 0;
    while index < bytes.len() {
        let code = index + 11 <= bytes.len()
            && bytes[index + 4] == b'-'
            && bytes[index..index + 4].iter().copied().all(ascii_digit)
            && bytes[index + 5..index + 11]
                .iter()
                .copied()
                .all(ascii_digit)
            && (index == 0 || !ascii_digit(bytes[index - 1]))
            && (index + 11 == bytes.len() || !ascii_digit(bytes[index + 11]));
        if code {
            out.push_str("****-******");
            index += 11;
            continue;
        }
        let ch = input[index..].chars().next().unwrap_or('\0');
        out.push(ch);
        index += ch.len_utf8();
    }
    out
}

fn mask_six_digits(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut index = 0;
    while index < bytes.len() {
        if !ascii_digit(bytes[index]) {
            let ch = input[index..].chars().next().unwrap_or('\0');
            out.push(ch);
            index += ch.len_utf8();
            continue;
        }
        let start = index;
        while index < bytes.len() && ascii_digit(bytes[index]) {
            index += 1;
        }
        if index - start == 6 {
            out.push_str("******");
        } else {
            out.push_str(&input[start..index]);
        }
    }
    out
}

const SECRET_KEYS: [&str; 3] = ["pairing_code", "token", "auth_token"];

fn skip_space(bytes: &[u8], mut index: usize) -> usize {
    while index < bytes.len() && matches!(bytes[index], b' ' | b'\t' | b'\r' | b'\n') {
        index += 1;
    }
    index
}

fn string_end(bytes: &[u8], mut index: usize) -> Option<usize> {
    // `index` points at the opening quote.
    index += 1;
    let mut escaped = false;
    while index < bytes.len() {
        match bytes[index] {
            b'\\' => {
                escaped = !escaped;
            }
            b'"' if !escaped => return Some(index),
            _ => {
                escaped = false;
            }
        }
        index += 1;
    }
    None
}

fn mask_json_values(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut cursor = 0;
    let mut index = 0;
    while index < bytes.len() {
        let mut replacement = None;
        if bytes[index] == b'"' {
            for key in SECRET_KEYS {
                let pattern = format!("\"{key}\"");
                if !input[index..].starts_with(&pattern) {
                    continue;
                }
                let mut next = skip_space(bytes, index + pattern.len());
                if bytes.get(next) != Some(&b':') {
                    continue;
                }
                next = skip_space(bytes, next + 1);
                if bytes.get(next) != Some(&b'"') {
                    continue;
                }
                let Some(end) = string_end(bytes, next) else {
                    continue;
                };
                replacement = Some((next, end + 1));
                break;
            }
        }
        if let Some((start, end)) = replacement {
            out.push_str(&input[cursor..start]);
            out.push_str("\"[redacted]\"");
            cursor = end;
            index = end;
            continue;
        }
        let ch = input[index..].chars().next().unwrap_or('\0');
        index += ch.len_utf8();
    }
    out.push_str(&input[cursor..]);
    out
}

fn scheme_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.')
}

fn whitespace(byte: u8) -> bool {
    byte.is_ascii_whitespace()
}

/// Replace userinfo in `scheme://user[:pass]@host`, keeping the scheme, `@`
/// and host. The last `@` before `/`, whitespace or end wins.
fn mask_url_userinfo(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut cursor = 0;
    let mut index = 0;
    while index + 2 < bytes.len() {
        if bytes[index] != b':' || bytes[index + 1] != b'/' || bytes[index + 2] != b'/' {
            let ch = input[index..].chars().next().unwrap_or('\0');
            index += ch.len_utf8();
            continue;
        }
        let mut scheme_start = index;
        while scheme_start > 0 && scheme_byte(bytes[scheme_start - 1]) {
            scheme_start -= 1;
        }
        if scheme_start == index || !bytes[scheme_start].is_ascii_alphabetic() {
            let ch = input[index..].chars().next().unwrap_or('\0');
            index += ch.len_utf8();
            continue;
        }
        let userinfo_start = index + 3;
        let mut end = userinfo_start;
        while end < bytes.len() && bytes[end] != b'/' && !whitespace(bytes[end]) {
            end += 1;
        }
        let Some(at) = bytes[userinfo_start..end]
            .iter()
            .rposition(|byte| *byte == b'@')
            .map(|offset| userinfo_start + offset)
        else {
            index = end;
            continue;
        };
        out.push_str(&input[cursor..userinfo_start]);
        out.push_str("[redacted]@");
        cursor = at + 1;
        index = cursor;
    }
    out.push_str(&input[cursor..]);
    out
}

fn base64url(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')
}

/// Mask three-part JWT-shaped tokens with base64url boundaries on both sides.
fn mask_jwts(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut cursor = 0;
    let mut index = 0;
    while index + 3 < bytes.len() {
        let starts = bytes[index] == b'e'
            && bytes[index + 1] == b'y'
            && bytes[index + 2] == b'J'
            && (index == 0 || !base64url(bytes[index - 1]));
        if !starts {
            let ch = input[index..].chars().next().unwrap_or('\0');
            index += ch.len_utf8();
            continue;
        }
        let mut first_end = index + 3;
        while first_end < bytes.len() && base64url(bytes[first_end]) {
            first_end += 1;
        }
        if first_end == index + 3 || bytes.get(first_end) != Some(&b'.') {
            let ch = input[index..].chars().next().unwrap_or('\0');
            index += ch.len_utf8();
            continue;
        }
        let mut second_end = first_end + 1;
        while second_end < bytes.len() && base64url(bytes[second_end]) {
            second_end += 1;
        }
        if second_end == first_end + 1 || bytes.get(second_end) != Some(&b'.') {
            let ch = input[index..].chars().next().unwrap_or('\0');
            index += ch.len_utf8();
            continue;
        }
        let mut end = second_end + 1;
        while end < bytes.len() && base64url(bytes[end]) {
            end += 1;
        }
        out.push_str(&input[cursor..index]);
        out.push_str("[redacted-jwt]");
        cursor = end;
        index = end;
    }
    out.push_str(&input[cursor..]);
    out
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
            r#"{"token":"[redacted]"}"#
        );
        assert_eq!(
            redact(r#"{"auth_token" : "short"}"#),
            r#"{"auth_token" : "[redacted]"}"#
        );
    }

    #[test]
    fn non_ascii_text_passes_through_unchanged() {
        let input = "café 東京 — no digits";
        assert_eq!(redact(input), input);
    }

    #[test]
    fn redacts_url_userinfo_but_keeps_the_host() {
        let url = format!("http://{}:{}@proxy.corp:3128", "alice", "pw");
        assert_eq!(redact(&url), "http://[redacted]@proxy.corp:3128");
        assert_eq!(
            redact("wss://relay.example.com/x"),
            "wss://relay.example.com/x"
        );
        assert_eq!(redact("user@example.com"), "user@example.com");
    }

    #[test]
    fn redacts_jwt_shaped_tokens_without_touching_the_edges() {
        let token = "eyJa.eyJb.sig";
        assert_eq!(
            redact(&format!("before {token} after")),
            "before [redacted-jwt] after"
        );
        assert_eq!(redact("eyJ"), "eyJ");
        let adjacent = format!("x{token}x");
        assert_eq!(redact(&adjacent), adjacent);
    }
}

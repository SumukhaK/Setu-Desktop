//! The ADB host protocol framing and `host:track-devices-l` parsing.

use crate::adb::track::AdbDevice;

/// Frame a host service request: four lowercase hex digits, then the bytes.
pub fn encode_request(service: &str) -> Vec<u8> {
    format!("{:04x}{service}", service.len()).into_bytes()
}

/// Accumulates bytes and yields complete framed payloads.
#[derive(Default)]
pub struct FrameReader {
    buffer: Vec<u8>,
}

impl FrameReader {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn feed(&mut self, bytes: &[u8]) -> Result<Vec<String>, String> {
        self.buffer.extend_from_slice(bytes);
        let mut payloads = Vec::new();

        loop {
            if self.buffer.len() < 4 {
                break;
            }
            let length = parse_length(&self.buffer[..4])?;
            if self.buffer.len() < 4 + length {
                break;
            }
            let payload: Vec<u8> = self.buffer[4..4 + length].to_vec();
            self.buffer.drain(..4 + length);
            let payload = String::from_utf8(payload)
                .map_err(|_| "ADB payload is not valid UTF-8".to_owned())?;
            payloads.push(payload);
        }

        Ok(payloads)
    }
}

fn parse_length(bytes: &[u8]) -> Result<usize, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "ADB length is not hex".to_owned())?;
    if !text.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("invalid ADB frame length: {text}"));
    }
    usize::from_str_radix(text, 16).map_err(|_| format!("invalid ADB frame length: {text}"))
}

/// Parse a `track-devices-l` payload into loopback devices, sorted by serial.
pub fn parse_device_list(payload: &str) -> Vec<AdbDevice> {
    let mut devices: Vec<AdbDevice> = payload
        .lines()
        .filter_map(|line| {
            let mut tokens = line.split_ascii_whitespace();
            let serial = tokens.next()?;
            let state = tokens.next()?;
            if !is_loopback_serial(serial) {
                return None;
            }
            Some(AdbDevice {
                serial: serial.to_owned(),
                state: state.to_owned(),
            })
        })
        .collect();
    devices.sort_by(|left, right| left.serial.cmp(&right.serial));
    devices
}

/// True only for `127.0.0.1:<port>`, `[::1]:<port>` and `localhost:<port>`.
pub fn is_loopback_serial(serial: &str) -> bool {
    let (host, port) = if let Some(rest) = serial.strip_prefix('[') {
        match rest.split_once("]:") {
            Some((host, port)) => (host, port),
            None => return false,
        }
    } else {
        match serial.rsplit_once(':') {
            Some((host, port)) => (host, port),
            None => return false,
        }
    };

    if port.is_empty() || !port.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }

    match host {
        "localhost" | "::1" => true,
        _ => match host.parse::<std::net::IpAddr>() {
            Ok(ip) => ip.is_loopback(),
            Err(_) => false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{encode_request, is_loopback_serial, parse_device_list, FrameReader};
    use crate::adb::track::AdbDevice;

    fn device(serial: &str, state: &str) -> AdbDevice {
        AdbDevice {
            serial: serial.to_owned(),
            state: state.to_owned(),
        }
    }

    #[test]
    fn encodes_the_length_then_the_service() {
        assert_eq!(
            encode_request("host:track-devices-l"),
            b"0014host:track-devices-l"
        );
    }

    #[test]
    fn frame_reader_handles_a_split_length() {
        let mut reader = FrameReader::new();
        assert_eq!(reader.feed(b"00"), Ok(Vec::new()));
        assert_eq!(reader.feed(b"05hel"), Ok(Vec::new()));
        assert_eq!(reader.feed(b"lo"), Ok(vec!["hello".to_owned()]));
    }

    #[test]
    fn frame_reader_handles_a_split_payload() {
        let mut reader = FrameReader::new();
        assert_eq!(reader.feed(b"0005he"), Ok(Vec::new()));
        assert_eq!(reader.feed(b"llo"), Ok(vec!["hello".to_owned()]));
    }

    #[test]
    fn frame_reader_handles_two_frames_in_one_chunk() {
        let mut reader = FrameReader::new();
        assert_eq!(
            reader.feed(b"0003one0003two"),
            Ok(vec!["one".to_owned(), "two".to_owned()])
        );
    }

    #[test]
    fn frame_reader_accepts_an_empty_payload() {
        let mut reader = FrameReader::new();
        assert_eq!(reader.feed(b"0000"), Ok(vec![String::new()]));
    }

    #[test]
    fn frame_reader_rejects_a_non_hex_length() {
        let mut reader = FrameReader::new();
        assert!(reader.feed(b"00zz").is_err());
    }

    #[test]
    fn parses_the_long_device_list_format() {
        assert_eq!(
            parse_device_list(
                "127.0.0.1:41377  device product:x model:Pixel_7 device:panther transport_id:3"
            ),
            vec![device("127.0.0.1:41377", "device")]
        );
    }

    #[test]
    fn parses_tab_separated_loopback_serials() {
        assert_eq!(
            parse_device_list(
                "127.0.0.1:41377\tdevice\n[::1]:5555\tunauthorized\nlocalhost:5555\toffline"
            ),
            vec![
                device("127.0.0.1:41377", "device"),
                device("[::1]:5555", "unauthorized"),
                device("localhost:5555", "offline"),
            ]
        );
    }

    #[test]
    fn keeps_the_no_permissions_state() {
        assert_eq!(
            parse_device_list(
                "127.0.0.1:41377\tno permissions (user in plugdev group); see [http://developer.android.com/tools/device.html]"
            ),
            vec![device("127.0.0.1:41377", "no")]
        );
    }

    #[test]
    fn skips_blank_and_short_lines() {
        assert_eq!(
            parse_device_list("\n  \n127.0.0.1:41377\n127.0.0.1:41378\tdevice\n"),
            vec![device("127.0.0.1:41378", "device")]
        );
    }

    #[test]
    fn drops_usb_and_emulator_serials() {
        assert_eq!(
            parse_device_list("R58M123ABC device\nemulator-5554 device\n127.0.0.1:41377 device"),
            vec![device("127.0.0.1:41377", "device")]
        );
    }

    #[test]
    fn sorts_devices_by_serial() {
        assert_eq!(
            parse_device_list(
                "127.0.0.1:413770 device\nlocalhost:5555 device\n127.0.0.1:4137 device"
            ),
            vec![
                device("127.0.0.1:4137", "device"),
                device("127.0.0.1:413770", "device"),
                device("localhost:5555", "device"),
            ]
        );
    }

    #[test]
    fn only_loopback_serials_are_kept() {
        assert!(is_loopback_serial("127.0.0.1:41377"));
        assert!(is_loopback_serial("[::1]:5555"));
        assert!(is_loopback_serial("localhost:5555"));

        assert!(!is_loopback_serial("R58M123ABC"));
        assert!(!is_loopback_serial("emulator-5554"));
        assert!(!is_loopback_serial("10.0.0.2:5555"));
        assert!(!is_loopback_serial("127.0.0.1"));
        assert!(!is_loopback_serial("localhost"));
        assert!(!is_loopback_serial("localhost:notaport"));
        assert!(!is_loopback_serial("127.0.0.1:41x"));
        assert!(!is_loopback_serial("127.0.0.1:41377 "));
    }
}

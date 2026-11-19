//! Framing edge cases for DT-01 (newline framing, 1 MiB cap).

use serde_json::{json, Value};
use setu_desktop::rpc::{encode, LineDecoder, SetuError, MAX_LINE_BYTES};

/// A line split over three chunks assembles into exactly one line.
#[test]
fn line_split_across_three_chunks_yields_one_line() {
    let mut decoder = LineDecoder::new();
    assert!(decoder.feed(b"first-part-").unwrap().is_empty());
    assert!(decoder.feed(b"second-part").unwrap().is_empty());
    let lines = decoder.feed(b"\n").unwrap();
    assert_eq!(lines, vec![b"first-part-second-part".to_vec()]);
}

/// Several complete lines in one chunk each come out, in order.
#[test]
fn two_lines_in_one_chunk_yield_two_lines() {
    let mut decoder = LineDecoder::new();
    let lines = decoder.feed(b"one\ntwo\n").unwrap();
    assert_eq!(lines, vec![b"one".to_vec(), b"two".to_vec()]);
}

/// Empty lines carry no message and are skipped.
#[test]
fn empty_lines_are_skipped() {
    let mut decoder = LineDecoder::new();
    let lines = decoder.feed(b"\n\ndata\n\n").unwrap();
    assert_eq!(lines, vec![b"data".to_vec()]);
}

/// A line of exactly 1 MiB bytes (excluding the newline) is within the cap.
#[test]
fn line_of_exactly_one_mib_is_accepted() {
    let mut decoder = LineDecoder::new();
    let mut chunk = vec![b'a'; MAX_LINE_BYTES];
    chunk.push(b'\n');
    let lines = decoder.feed(&chunk).unwrap();
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].len(), MAX_LINE_BYTES);
}

/// A complete line one byte over the cap is rejected.
#[test]
fn complete_line_one_byte_over_one_mib_is_frame_too_large() {
    let mut decoder = LineDecoder::new();
    let mut chunk = vec![b'a'; MAX_LINE_BYTES + 1];
    chunk.push(b'\n');
    assert!(matches!(
        decoder.feed(&chunk),
        Err(SetuError::FrameTooLarge)
    ));
}

/// A line that grows past the cap before its newline arrives is rejected.
#[test]
fn growing_partial_line_past_one_mib_is_frame_too_large() {
    let mut decoder = LineDecoder::new();
    assert!(decoder
        .feed(&vec![b'a'; MAX_LINE_BYTES])
        .unwrap()
        .is_empty());
    assert!(matches!(decoder.feed(b"a"), Err(SetuError::FrameTooLarge)));
}

/// Encoding appends exactly one newline to compact JSON.
#[test]
fn encode_writes_compact_json_and_one_newline() {
    assert_eq!(encode(&json!({ "a": 1 })).unwrap(), b"{\"a\":1}\n");
}

/// An encoding of exactly 1 MiB (excluding the newline) is within the cap.
#[test]
fn encode_at_exactly_one_mib_is_accepted() {
    let value = Value::String("a".repeat(MAX_LINE_BYTES - 2));
    let bytes = encode(&value).unwrap();
    assert_eq!(bytes.len(), MAX_LINE_BYTES + 1);
    assert_eq!(*bytes.last().unwrap(), b'\n');
}

/// An encoding one byte over the cap is rejected and produces no frame.
#[test]
fn encode_one_byte_over_one_mib_is_frame_too_large() {
    let value = Value::String("a".repeat(MAX_LINE_BYTES - 1));
    assert!(matches!(encode(&value), Err(SetuError::FrameTooLarge)));
}

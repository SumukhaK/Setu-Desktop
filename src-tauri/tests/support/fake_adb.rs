//! Test-only stand-in for the `adb` executable (TDD_TICKETS §4).
//!
//! Reads `FAKE_ADB_STDOUT`, `FAKE_ADB_STDERR`, `FAKE_ADB_EXIT` and
//! `FAKE_ADB_SLEEP_MS`. When `FAKE_ADB_ARGS_FILE` is set, appends its argv
//! (one argument per line) to that file.

use std::io::Write;

fn main() {
    if let Some(path) = std::env::var_os("FAKE_ADB_ARGS_FILE") {
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let args: Vec<String> = std::env::args().skip(1).collect();
            let _ = writeln!(file, "{}", args.join("\n"));
        }
    }

    if let Ok(text) = std::env::var("FAKE_ADB_STDOUT") {
        let mut stdout = std::io::stdout();
        let _ = stdout.write_all(text.as_bytes());
        let _ = stdout.flush();
    }
    if let Ok(text) = std::env::var("FAKE_ADB_STDERR") {
        let mut stderr = std::io::stderr();
        let _ = stderr.write_all(text.as_bytes());
        let _ = stderr.flush();
    }

    if let Ok(millis) = std::env::var("FAKE_ADB_SLEEP_MS") {
        if let Ok(millis) = millis.parse::<u64>() {
            std::thread::sleep(std::time::Duration::from_millis(millis));
        }
    }

    let code = std::env::var("FAKE_ADB_EXIT")
        .ok()
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(0);
    std::process::exit(code);
}

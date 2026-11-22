//! DT-05 `adb connect` integration tests against the `fake-adb` binary.

use std::ffi::OsStr;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use setu_desktop::adb::{adb_connect, AdbConnectOutcome};

// The FAKE_ADB_* knobs are process-global environment variables. Every test
// holds this lock so parallel tests never see each other's values.
static ENV_LOCK: Mutex<()> = Mutex::new(());

struct EnvGuard {
    _lock: MutexGuard<'static, ()>,
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        for key in [
            "FAKE_ADB_STDOUT",
            "FAKE_ADB_STDERR",
            "FAKE_ADB_EXIT",
            "FAKE_ADB_SLEEP_MS",
            "FAKE_ADB_ARGS_FILE",
        ] {
            std::env::remove_var(key);
        }
    }
}

fn env_guard() -> EnvGuard {
    EnvGuard {
        _lock: ENV_LOCK.lock().unwrap_or_else(PoisonError::into_inner),
    }
}

fn fake_adb() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_fake-adb"))
}

fn set_output(stdout: &str, stderr: &str, exit: i32, sleep_ms: u64) {
    std::env::set_var("FAKE_ADB_STDOUT", stdout);
    std::env::set_var("FAKE_ADB_STDERR", stderr);
    std::env::set_var("FAKE_ADB_EXIT", exit.to_string());
    std::env::set_var("FAKE_ADB_SLEEP_MS", sleep_ms.to_string());
}

fn recorded_args(path: &OsStr) -> Vec<String> {
    std::fs::read_to_string(path)
        .expect("fake adb wrote its argv")
        .lines()
        .map(str::to_owned)
        .collect()
}

#[tokio::test]
async fn connected_output_and_exact_argv() {
    let _guard = env_guard();
    let dir = tempfile::tempdir().expect("temp dir");
    let args = dir.path().join("args.txt");
    set_output("connected to 127.0.0.1:41377\n", "", 0, 0);
    std::env::set_var("FAKE_ADB_ARGS_FILE", &args);

    let outcome = adb_connect(&fake_adb(), "127.0.0.1:41377", Duration::from_secs(5)).await;

    assert_eq!(outcome, AdbConnectOutcome::Connected);
    assert_eq!(
        recorded_args(args.as_os_str()),
        vec!["connect".to_owned(), "127.0.0.1:41377".to_owned()]
    );
}

#[tokio::test]
async fn already_connected_counts_as_connected() {
    let _guard = env_guard();
    set_output("already connected to 127.0.0.1:41377\n", "", 0, 0);

    let outcome = adb_connect(&fake_adb(), "127.0.0.1:41377", Duration::from_secs(5)).await;

    assert_eq!(outcome, AdbConnectOutcome::Connected);
}

#[tokio::test]
async fn failure_output_with_exit_zero_is_failed_and_truncated() {
    let _guard = env_guard();
    let detail = format!("failed to connect to 127.0.0.1:41377: {}", "x".repeat(400));
    set_output(&format!("{detail}\n"), "", 0, 0);

    let outcome = adb_connect(&fake_adb(), "127.0.0.1:41377", Duration::from_secs(5)).await;

    match outcome {
        AdbConnectOutcome::Failed { detail } => {
            assert!(detail.starts_with("failed to connect to 127.0.0.1:41377:"));
            assert_eq!(detail.chars().count(), 200);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn sleep_past_the_timeout_is_timed_out() {
    let _guard = env_guard();
    set_output("", "", 0, 2000);

    let started = Instant::now();
    let outcome = adb_connect(&fake_adb(), "127.0.0.1:41377", Duration::from_millis(300)).await;

    assert_eq!(outcome, AdbConnectOutcome::TimedOut);
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[tokio::test]
async fn a_missing_executable_is_missing() {
    let _guard = env_guard();
    let dir = tempfile::tempdir().expect("temp dir");
    let missing = dir.path().join("no-such-adb");

    let outcome = adb_connect(&missing, "127.0.0.1:41377", Duration::from_secs(5)).await;

    assert_eq!(outcome, AdbConnectOutcome::Missing);
}

#[tokio::test]
async fn non_loopback_addresses_never_spawn_adb() {
    let _guard = env_guard();
    let dir = tempfile::tempdir().expect("temp dir");
    let args = dir.path().join("args.txt");
    set_output("connected to 10.0.0.2:5555\n", "", 0, 0);
    std::env::set_var("FAKE_ADB_ARGS_FILE", &args);

    for addr in ["10.0.0.2:5555", "pixel-7"] {
        let outcome = adb_connect(&fake_adb(), addr, Duration::from_secs(5)).await;
        assert_eq!(outcome, AdbConnectOutcome::NotLoopback);
    }

    assert!(!args.exists(), "adb must not run for a non-loopback address");
}

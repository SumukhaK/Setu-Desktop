//! DT-02 supervisor integration tests (P18 spawn/attach/stale/crash, P17
//! stop and survive-drop) against the `fake-setu-daemon` test binary.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use setu_desktop::daemon::{
    attach_record_path, read_attach_record, write_attach_record, AttachRecord, DaemonConfig,
    DaemonState, Supervisor, SupervisorOptions, Workspace,
};
use setu_desktop::rpc::RpcClient;
use tokio::net::TcpStream;
use tokio::sync::watch;
use tokio::time::timeout;

const TEST_TIMEOUT: Duration = Duration::from_secs(5);

// The FAKE_DAEMON_* knobs are process-global environment variables, and the
// fakes read them at spawn. Every fake-spawning test holds this lock so
// parallel tests never see each other's values; the guard clears the vars.
static ENV_LOCK: Mutex<()> = Mutex::new(());

struct FakeEnv(#[allow(dead_code)] MutexGuard<'static, ()>);

impl Drop for FakeEnv {
    fn drop(&mut self) {
        std::env::remove_var("FAKE_DAEMON_EXIT_AFTER_MS");
        std::env::remove_var("FAKE_DAEMON_NO_READY");
        std::env::remove_var("FAKE_DAEMON_ARGS_FILE");
    }
}

fn lock_fake_env() -> FakeEnv {
    FakeEnv(ENV_LOCK.lock().unwrap_or_else(PoisonError::into_inner))
}

fn set_env(key: &str, value: &std::ffi::OsStr) {
    std::env::set_var(key, value);
}

fn fake_daemon_path() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_fake-setu-daemon"))
}

fn config() -> DaemonConfig {
    DaemonConfig {
        daemon_path: fake_daemon_path(),
        relay: "127.0.0.1:7000".into(),
        label: None,
        adb_path: None,
        relay_pin: None,
        proxy: None,
        corporate: None,
    }
}

fn fast_options() -> SupervisorOptions {
    SupervisorOptions {
        ready_timeout: Duration::from_millis(500),
        backoff_base: Duration::from_millis(20),
        backoff_max: Duration::from_millis(60),
    }
}

async fn wait_state(
    rx: &mut watch::Receiver<DaemonState>,
    predicate: impl Fn(&DaemonState) -> bool,
) -> DaemonState {
    timeout(TEST_TIMEOUT, rx.wait_for(predicate))
        .await
        .expect("state change in time")
        .expect("watch channel alive");
    rx.borrow_and_update().clone()
}

async fn wait_ready(rx: &mut watch::Receiver<DaemonState>) -> (RpcClient, u64, u32, bool) {
    let state = wait_state(rx, |s| matches!(s, DaemonState::Ready { .. })).await;
    match state {
        DaemonState::Ready {
            client,
            generation,
            pid,
            attached,
        } => (client, generation, pid, attached),
        _ => panic!("expected a Ready state"),
    }
}

fn first_argv_line(path: &Path) -> Vec<String> {
    let text = std::fs::read_to_string(path).expect("args file exists");
    let line = text.lines().next().expect("at least one argv line");
    serde_json::from_str(line).expect("argv line is JSON")
}

fn args_flag_value(argv: &[String], flag: &str, value: &str) -> bool {
    argv.windows(2)
        .any(|pair| pair[0] == flag && pair[1] == value)
}

fn argv_line_count(path: &Path) -> usize {
    std::fs::read_to_string(path)
        .expect("args file exists")
        .lines()
        .count()
}

/// Best-effort count of live `fake-setu-daemon` processes.
fn count_alive_fakes() -> usize {
    #[cfg(windows)]
    {
        let output = std::process::Command::new("tasklist")
            .args([
                "/FI",
                "IMAGENAME eq fake-setu-daemon.exe",
                "/FO",
                "CSV",
                "/NH",
            ])
            .output();
        match output {
            Ok(output) => String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter(|line| line.starts_with("\"fake-setu-daemon.exe\""))
                .count(),
            Err(_) => usize::MAX,
        }
    }
    #[cfg(not(windows))]
    {
        let output = std::process::Command::new("pgrep")
            .args(["-f", "fake-setu-daemon"])
            .output();
        match output {
            Ok(output) => {
                let text = String::from_utf8_lossy(&output.stdout);
                text.lines().filter(|line| !line.trim().is_empty()).count()
            }
            Err(_) => usize::MAX,
        }
    }
}

/// Acceptance P18: a fresh workspace spawns the daemon, authenticates,
/// records it, and hands out a working client.
#[tokio::test]
async fn a_fresh_workspace_spawns_the_daemon_and_reaches_ready() {
    let _env = lock_fake_env();
    let tmp = tempfile::tempdir().unwrap();
    let app_data = tmp.path().to_path_buf();
    let state_dir = Workspace::Solo.state_dir(&app_data);
    let args_file = tmp.path().join("args.jsonl");
    set_env("FAKE_DAEMON_ARGS_FILE", args_file.as_os_str());

    let supervisor = Supervisor::start(Workspace::Solo, app_data.clone(), config(), fast_options());
    let mut rx = supervisor.subscribe();
    let (client, generation, pid, attached) = wait_ready(&mut rx).await;
    assert_eq!(generation, 1);
    assert!(!attached);

    let version = timeout(TEST_TIMEOUT, client.version())
        .await
        .expect("version in time")
        .unwrap();
    assert_eq!(version.version, "1.1.0");

    let record = read_attach_record(&state_dir).expect("attach record written");
    assert_eq!(record.pid, pid);
    assert_eq!(record.version, "1.1.0");
    let record_text = std::fs::read_to_string(attach_record_path(&state_dir)).unwrap();
    assert!(
        !record_text.contains("token"),
        "record must not contain the token"
    );

    let argv = first_argv_line(&args_file);
    assert!(
        args_flag_value(&argv, "--listen", "127.0.0.1:0"),
        "argv: {argv:?}"
    );
    assert!(
        args_flag_value(&argv, "--state", state_dir.to_string_lossy().as_ref()),
        "argv: {argv:?}"
    );

    supervisor.stop().await;
}

/// Acceptance P18: a second supervisor for the same workspace attaches to
/// the running daemon (same pid) and no second process starts.
#[tokio::test]
async fn a_second_supervisor_attaches_to_the_running_daemon() {
    let _env = lock_fake_env();
    let tmp = tempfile::tempdir().unwrap();
    let app_data = tmp.path().to_path_buf();
    let args_file = tmp.path().join("args.jsonl");
    set_env("FAKE_DAEMON_ARGS_FILE", args_file.as_os_str());

    let a = Supervisor::start(Workspace::Solo, app_data.clone(), config(), fast_options());
    let mut rxa = a.subscribe();
    let (_, _, pid_a, attached_a) = wait_ready(&mut rxa).await;
    assert!(!attached_a);

    let b = Supervisor::start(Workspace::Solo, app_data.clone(), config(), fast_options());
    let mut rxb = b.subscribe();
    let (_, generation_b, pid_b, attached_b) = wait_ready(&mut rxb).await;
    assert!(attached_b);
    assert_eq!(generation_b, 1);
    assert_eq!(pid_b, pid_a);

    assert_eq!(
        argv_line_count(&args_file),
        1,
        "no second process was started"
    );

    a.stop().await;
    b.stop().await;
}

/// Acceptance P18: a record pointing at a closed port cannot be attached
/// to, so the supervisor spawns a fresh daemon.
#[tokio::test]
async fn a_stale_attach_record_leads_to_a_fresh_spawn() {
    let _env = lock_fake_env();
    let tmp = tempfile::tempdir().unwrap();
    let app_data = tmp.path().to_path_buf();
    let state_dir = Workspace::Solo.state_dir(&app_data);
    std::fs::create_dir_all(&state_dir).unwrap();

    let closed = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let stale_addr = closed.local_addr().unwrap();
    drop(closed);
    write_attach_record(
        &state_dir,
        &AttachRecord {
            listen: stale_addr,
            pid: 4242,
            version: "1.1.0".into(),
        },
    )
    .unwrap();

    let supervisor = Supervisor::start(Workspace::Solo, app_data.clone(), config(), fast_options());
    let mut rx = supervisor.subscribe();
    let (client, _, pid, attached) = wait_ready(&mut rx).await;
    assert!(!attached);
    assert_ne!(pid, 4242);

    timeout(TEST_TIMEOUT, client.version())
        .await
        .expect("version in time")
        .unwrap();
    let record = read_attach_record(&state_dir).expect("record rewritten");
    assert_eq!(record.pid, pid);

    supervisor.stop().await;
}

/// Acceptance P18: a crashed daemon is restarted with backoff; the new
/// Ready has generation 2 and a different pid.
#[tokio::test]
async fn a_crashed_daemon_is_restarted_with_a_new_generation_and_pid() {
    let _env = lock_fake_env();
    let tmp = tempfile::tempdir().unwrap();
    let app_data = tmp.path().to_path_buf();
    set_env("FAKE_DAEMON_EXIT_AFTER_MS", std::ffi::OsStr::new("300"));
    let options = SupervisorOptions {
        ready_timeout: Duration::from_millis(500),
        backoff_base: Duration::from_millis(50),
        backoff_max: Duration::from_millis(200),
    };

    let supervisor = Supervisor::start(Workspace::Solo, app_data.clone(), config(), options);
    let mut rx = supervisor.subscribe();
    let (_, generation, pid_first, _) = wait_ready(&mut rx).await;
    assert_eq!(generation, 1);

    let restarting = wait_state(&mut rx, |s| matches!(s, DaemonState::Restarting { .. })).await;
    match restarting {
        DaemonState::Restarting { attempt, retry_in } => {
            assert_eq!(attempt, 1);
            assert_eq!(retry_in, Duration::from_millis(50));
        }
        _ => panic!("expected a Restarting state"),
    }

    let (client, generation, pid_second, _) = wait_ready(&mut rx).await;
    assert_eq!(generation, 2);
    assert_ne!(
        pid_second, pid_first,
        "the restarted daemon must be a new process"
    );
    timeout(TEST_TIMEOUT, client.version())
        .await
        .expect("version in time")
        .unwrap();

    supervisor.stop().await;
}

/// Acceptance P18: a daemon that never prints `daemon_ready` ends in
/// `Failed` after five killed attempts, and no fake survives.
#[tokio::test]
async fn a_daemon_without_a_ready_line_ends_failed_after_five_attempts() {
    let _env = lock_fake_env();
    let tmp = tempfile::tempdir().unwrap();
    let app_data = tmp.path().to_path_buf();
    let args_file = tmp.path().join("args.jsonl");
    set_env("FAKE_DAEMON_NO_READY", std::ffi::OsStr::new("1"));
    set_env("FAKE_DAEMON_ARGS_FILE", args_file.as_os_str());
    let options = SupervisorOptions {
        ready_timeout: Duration::from_millis(300),
        backoff_base: Duration::from_millis(10),
        backoff_max: Duration::from_millis(20),
    };

    let supervisor = Supervisor::start(Workspace::Solo, app_data.clone(), config(), options);
    let mut rx = supervisor.subscribe();
    let failed = wait_state(&mut rx, |s| matches!(s, DaemonState::Failed { .. })).await;
    let DaemonState::Failed { reason } = failed else {
        panic!("expected Failed")
    };
    assert!(reason.contains("daemon_ready"), "reason: {reason}");

    assert_eq!(
        argv_line_count(&args_file),
        5,
        "exactly five spawn attempts"
    );

    // Every child was killed on its ready timeout. Let the OS settle, then
    // require no fake process to survive (all supervisor tests are
    // serialized behind the env lock and stop their own daemons).
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        count_alive_fakes(),
        0,
        "a fake-setu-daemon process survived"
    );
}

/// Acceptance P17: stop() kills the spawned daemon, removes the record and
/// publishes Stopped.
#[tokio::test]
async fn stop_kills_the_spawned_daemon_and_clears_the_record() {
    let _env = lock_fake_env();
    let tmp = tempfile::tempdir().unwrap();
    let app_data = tmp.path().to_path_buf();
    let state_dir = Workspace::Solo.state_dir(&app_data);

    let supervisor = Supervisor::start(Workspace::Solo, app_data.clone(), config(), fast_options());
    let mut rx = supervisor.subscribe();
    let (_, _, pid, _) = wait_ready(&mut rx).await;
    let record = read_attach_record(&state_dir).expect("record written");
    assert_eq!(record.pid, pid);
    let listen = record.listen;

    supervisor.stop().await;

    assert!(matches!(&*rx.borrow_and_update(), DaemonState::Stopped));
    assert!(read_attach_record(&state_dir).is_none(), "record removed");
    let probe = timeout(TEST_TIMEOUT, TcpStream::connect(listen))
        .await
        .unwrap();
    assert!(
        probe.is_err(),
        "the daemon still accepts connections after stop"
    );
}

/// Acceptance P17: dropping a Ready supervisor without stop() leaves the
/// daemon running; a new supervisor then attaches to it.
#[tokio::test]
async fn dropping_the_supervisor_without_stop_keeps_the_daemon_reachable() {
    let _env = lock_fake_env();
    let tmp = tempfile::tempdir().unwrap();
    let app_data = tmp.path().to_path_buf();

    let supervisor = Supervisor::start(Workspace::Solo, app_data.clone(), config(), fast_options());
    let mut rx = supervisor.subscribe();
    let (client, _, _, _) = wait_ready(&mut rx).await;
    let cleanup = supervisor.clone();
    drop(supervisor);
    drop(rx);

    let version = timeout(TEST_TIMEOUT, client.version())
        .await
        .expect("version in time")
        .unwrap();
    assert_eq!(version.version, "1.1.0");

    let b = Supervisor::start(Workspace::Solo, app_data.clone(), config(), fast_options());
    let mut rxb = b.subscribe();
    let (_, _, _, attached) = wait_ready(&mut rxb).await;
    assert!(attached);

    cleanup.stop().await;
    b.stop().await;
}

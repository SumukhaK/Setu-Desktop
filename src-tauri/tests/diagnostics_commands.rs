//! DT-11 diagnostics command tests against FakeDaemon (P16, AD-5, AD-9).

use std::time::Duration;

use serde_json::{json, Value};
use setu_desktop::commands::diagnostics::{run_doctor, DoctorCheck, DoctorOutcome};
use setu_desktop::rpc::RpcClient;
use tokio::time::timeout;

mod support;
use support::fake_daemon::FakeDaemon;

const TEST_TIMEOUT: Duration = Duration::from_secs(3);

async fn connect_fake() -> (FakeDaemon, RpcClient) {
    let fake = FakeDaemon::start().await;
    let (client, _notifications) = timeout(TEST_TIMEOUT, RpcClient::connect(fake.addr()))
        .await
        .expect("connect finishes")
        .expect("connect succeeds");
    (fake, client)
}

fn check(name: &str, status: &str, detail: &str, hint: Option<&str>) -> Value {
    let mut value = json!({ "name": name, "status": status, "detail": detail });
    if let Some(hint) = hint {
        value["hint"] = json!(hint);
    }
    value
}

#[tokio::test]
async fn a_real_shaped_report_keeps_order_and_normalizes_empty_hints() {
    let (fake, client) = connect_fake().await;
    fake.reply_with(
        "doctor",
        json!({
            "version": "1.1.0",
            "platform": "linux/amd64",
            "ok": false,
            "checks": [
                check("adb", "ok", "found", Some("unused")),
                check("relay", "skip", "not configured", None),
                check("audit_log", "warn", "anchor unavailable", Some("")),
            ]
        }),
    );

    let outcome = timeout(TEST_TIMEOUT, run_doctor(Some(client), TEST_TIMEOUT))
        .await
        .expect("doctor finishes");
    assert_eq!(
        outcome,
        DoctorOutcome::Report {
            version: "1.1.0".into(),
            platform: "linux/amd64".into(),
            ok: false,
            checks: vec![
                DoctorCheck {
                    name: "adb".into(),
                    status: "ok".into(),
                    detail: "found".into(),
                    hint: Some("unused".into()),
                },
                DoctorCheck {
                    name: "relay".into(),
                    status: "skip".into(),
                    detail: "not configured".into(),
                    hint: None,
                },
                DoctorCheck {
                    name: "audit_log".into(),
                    status: "warn".into(),
                    detail: "anchor unavailable".into(),
                    hint: None,
                },
            ],
        }
    );
    let received = fake.received();
    assert_eq!(received[0]["method"], "doctor");
    assert!(received[0].get("params").is_none());
}

#[tokio::test]
async fn every_report_string_is_redacted_before_crossing_the_bridge() {
    let (fake, client) = connect_fake().await;
    let proxy = format!("http://{}:{}@proxy.corp:3128", "alice", "pw");
    let token = "eyJa.eyJb.sig";
    let token_ref: &str = token;
    let detail = format!("proxy {proxy}; code 1234-567890; token {token}");
    fake.reply_with(
        "doctor",
        json!({
            "version": token,
            "platform": proxy,
            "ok": false,
            "checks": [check("future_check", "maybe", &detail, Some(token_ref))]
        }),
    );

    let outcome = timeout(TEST_TIMEOUT, run_doctor(Some(client), TEST_TIMEOUT))
        .await
        .expect("doctor finishes");
    let text = format!("{outcome:?}");
    assert!(!text.contains("alice"));
    assert!(!text.contains("pw"));
    assert!(!text.contains("1234-567890"));
    assert!(!text.contains(token));
    assert!(text.contains("[redacted]"));
    assert!(text.contains("[redacted-jwt]"));
    match outcome {
        DoctorOutcome::Report {
            version,
            platform,
            checks,
            ..
        } => {
            assert_eq!(version, "[redacted-jwt]");
            assert_eq!(platform, "http://[redacted]@proxy.corp:3128");
            assert_eq!(checks[0].name, "future_check");
            assert_eq!(checks[0].status, "maybe");
            assert_eq!(
                checks[0].detail,
                "proxy http://[redacted]@proxy.corp:3128; code ****-******; token [redacted-jwt]"
            );
            assert_eq!(checks[0].hint.as_deref(), Some("[redacted-jwt]"));
        }
        other => panic!("expected a report, got {other:?}"),
    }
}

#[tokio::test]
async fn unknown_checks_missing_fields_and_non_objects_are_lenient() {
    let (fake, client) = connect_fake().await;
    fake.reply_with(
        "doctor",
        json!({
            "ok": true,
            "checks": [check("future_check", "maybe", "x", None)]
        }),
    );
    let outcome = timeout(TEST_TIMEOUT, run_doctor(Some(client), TEST_TIMEOUT))
        .await
        .expect("doctor finishes");
    assert_eq!(
        outcome,
        DoctorOutcome::Report {
            version: "".into(),
            platform: "".into(),
            ok: true,
            checks: vec![DoctorCheck {
                name: "future_check".into(),
                status: "maybe".into(),
                detail: "x".into(),
                hint: None,
            }],
        }
    );

    let (fake, client) = connect_fake().await;
    fake.reply_with("doctor", json!({}));
    assert_eq!(
        timeout(TEST_TIMEOUT, run_doctor(Some(client), TEST_TIMEOUT))
            .await
            .expect("doctor finishes"),
        DoctorOutcome::Report {
            version: "".into(),
            platform: "".into(),
            ok: false,
            checks: vec![],
        }
    );

    let (fake, client) = connect_fake().await;
    fake.reply_with("doctor", json!([]));
    assert_eq!(
        timeout(TEST_TIMEOUT, run_doctor(Some(client), TEST_TIMEOUT))
            .await
            .expect("doctor finishes"),
        DoctorOutcome::Failed { code: None }
    );
}

#[tokio::test]
async fn stray_notifications_do_not_change_the_report() {
    let (fake, client) = connect_fake().await;
    fake.reply_delayed("doctor", json!({ "ok": true }), Duration::from_millis(20));
    fake.notify(
        "event",
        json!({ "type": "listening", "session": "s1", "fields": {} }),
    )
    .await;
    fake.send_raw(
        b"{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"session_up\",\"session\":\"s1\",\"fields\":{}}}\n",
    )
    .await;

    let outcome = timeout(TEST_TIMEOUT, run_doctor(Some(client), TEST_TIMEOUT))
        .await
        .expect("doctor finishes");
    assert_eq!(
        outcome,
        DoctorOutcome::Report {
            version: "".into(),
            platform: "".into(),
            ok: true,
            checks: vec![],
        }
    );
    fake.wait_for_requests(1).await;
    fake.close().await;
}

#[tokio::test]
async fn errors_not_ready_and_timeout_map_to_outcomes() {
    let (fake, client) = connect_fake().await;
    fake.reply_with_error(
        "doctor",
        json!({ "code": -32603, "message": "internal error" }),
    );
    assert_eq!(
        timeout(TEST_TIMEOUT, run_doctor(Some(client), TEST_TIMEOUT))
            .await
            .expect("doctor finishes"),
        DoctorOutcome::Failed { code: Some(-32603) }
    );
    assert_eq!(
        timeout(TEST_TIMEOUT, run_doctor(None, TEST_TIMEOUT))
            .await
            .expect("not-ready finishes"),
        DoctorOutcome::NotReady
    );

    let (fake, client) = connect_fake().await;
    fake.reply_delayed("doctor", json!({}), Duration::from_secs(1));
    assert_eq!(
        timeout(
            TEST_TIMEOUT,
            run_doctor(Some(client), Duration::from_millis(200))
        )
        .await
        .expect("timeout finishes"),
        DoctorOutcome::TimedOut
    );
}

//! Tauri app shell: one window, one Solo supervisor, one status stream.
//!
//! The shell is excluded from the lib's unit-test build. The tests cover the
//! pure status mapping, and linking a GUI binary into the test harness pulls
//! in WebView2 and Common Controls, which need the application manifest that
//! Cargo does not give test binaries on Windows.

pub mod status;

#[cfg(not(test))]
mod shell {
    use std::path::PathBuf;
    use std::sync::{Mutex, MutexGuard, PoisonError};
    use std::time::Duration;

    use tauri::{Emitter, Manager};
    use tokio::sync::watch;

    use crate::adb::{self, AdbConnectOutcome, AdbSnapshot, AdbWatcher};
    use crate::app::status::{resolve_daemon_path, resolve_relay, status_of, AppStatus};
    use crate::commands::{cancel_pending, connect_with_code, ConnectOutcome, PendingConnect};
    use crate::daemon::{DaemonConfig, DaemonState, Supervisor, SupervisorOptions, Workspace};
    use crate::events::{start as start_event_hub, EventHub};

    struct AppState {
        status: Mutex<AppStatus>,
        supervisor: Option<Supervisor>,
        hub: Option<EventHub>,
        pending: PendingConnect,
        _adb: AdbWatcher,
        adb_status: watch::Receiver<AdbSnapshot>,
    }

    fn lock_status(state: &AppState) -> MutexGuard<'_, AppStatus> {
        state.status.lock().unwrap_or_else(PoisonError::into_inner)
    }

    #[tauri::command]
    fn daemon_status(state: tauri::State<'_, AppState>) -> AppStatus {
        lock_status(&state).clone()
    }

    #[tauri::command]
    fn session_resync(state: tauri::State<'_, AppState>) {
        if let Some(hub) = &state.hub {
            hub.resync();
        }
    }

    #[tauri::command]
    async fn session_connect_code(
        code: String,
        state: tauri::State<'_, AppState>,
    ) -> Result<ConnectOutcome, String> {
        let client = state.supervisor.as_ref().and_then(|supervisor| {
            match &*supervisor.subscribe().borrow() {
                DaemonState::Ready { client, .. } => Some(client.clone()),
                _ => None,
            }
        });
        Ok(connect_with_code(client, &code, &state.pending).await)
    }

    #[tauri::command]
    fn session_cancel_connect(state: tauri::State<'_, AppState>) -> bool {
        cancel_pending(&state.pending)
    }

    #[tauri::command]
    fn adb_status(state: tauri::State<'_, AppState>) -> AdbSnapshot {
        state.adb_status.borrow().clone()
    }

    #[tauri::command]
    async fn adb_connect(adb_addr: String) -> Result<AdbConnectOutcome, String> {
        let adb = adb::resolve_adb_path(std::env::var_os("SETU_ADB_PATH"));
        Ok(adb::adb_connect(&adb, &adb_addr, Duration::from_secs(10)).await)
    }

    /// Start the window and, when a relay is configured, the Solo supervisor.
    ///
    /// Dropping the app never stops the daemon (P17); DT-09 adds tray and quit.
    pub fn run() {
        let result = tauri::Builder::default()
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }))
            .invoke_handler(tauri::generate_handler![
                daemon_status,
                session_resync,
                session_connect_code,
                session_cancel_connect,
                adb_status,
                adb_connect
            ])
            .setup(|app| {
                let relay = resolve_relay(
                    std::env::var("SETU_RELAY_URL").ok(),
                    option_env!("SETU_RELAY_URL"),
                );
                let initial = match relay {
                    Some(_) => AppStatus::Starting,
                    None => AppStatus::NotConfigured,
                };

                let app_data = app.path().app_data_dir()?;
                let state_dir = Workspace::Solo.state_dir(&app_data);
                let supervisor = match relay {
                    Some(relay) => {
                        let exe_dir = std::env::current_exe()
                            .ok()
                            .and_then(|exe| exe.parent().map(PathBuf::from))
                            .unwrap_or_else(|| PathBuf::from("."));
                        let config = DaemonConfig {
                            daemon_path: resolve_daemon_path(
                                std::env::var_os("SETU_DAEMON_PATH"),
                                &exe_dir,
                            ),
                            relay,
                            label: computer_name(),
                            adb_path: None,
                            relay_pin: None,
                            proxy: None,
                            corporate: None,
                        };
                        Some(tauri::async_runtime::block_on(async move {
                            Supervisor::start(
                                Workspace::Solo,
                                app_data,
                                config,
                                SupervisorOptions::default(),
                            )
                        }))
                    }
                    None => None,
                };

                let states = supervisor.as_ref().map(Supervisor::subscribe);
                let hub_pair = states.as_ref().map(|receiver| {
                    let receiver = receiver.clone();
                    tauri::async_runtime::block_on(
                        async move { start_event_hub(receiver, state_dir) },
                    )
                });

                // The ADB watcher is independent of the relay: it always runs,
                // and it never starts an ADB server.
                let server = adb::resolve_adb_server(std::env::var("ANDROID_ADB_SERVER_PORT").ok());
                let (watcher, adb_status) =
                    tauri::async_runtime::block_on(async move { adb::start(server) });

                app.manage(AppState {
                    status: Mutex::new(initial),
                    supervisor,
                    hub: hub_pair.as_ref().map(|(hub, _)| hub.clone()),
                    pending: PendingConnect::default(),
                    _adb: watcher,
                    adb_status: adb_status.clone(),
                });

                {
                    let handle = app.handle().clone();
                    let mut adb_status = adb_status;
                    tauri::async_runtime::spawn(async move {
                        loop {
                            let snapshot = adb_status.borrow_and_update().clone();
                            let _ = handle.emit("adb-status", &snapshot);
                            if adb_status.changed().await.is_err() {
                                break;
                            }
                        }
                    });
                }

                if let Some((_, mut messages)) = hub_pair {
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        while let Some(message) = messages.recv().await {
                            let _ = handle.emit("session-hub", &message);
                        }
                    });
                }

                if let Some(mut states) = states {
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let mut version: Option<String> = None;
                        let mut last_generation: Option<u64> = None;

                        loop {
                            // The supervisor may already be Ready when this
                            // task starts; emit the current value before
                            // waiting, so a late UI never sticks on Starting.
                            let state = states.borrow_and_update().clone();
                            version = match &state {
                                DaemonState::Ready {
                                    client, generation, ..
                                } => {
                                    if last_generation == Some(*generation) {
                                        version
                                    } else {
                                        last_generation = Some(*generation);
                                        client.version().await.ok().map(|info| info.version)
                                    }
                                }
                                _ => {
                                    last_generation = None;
                                    None
                                }
                            };

                            let next = status_of(&state, version.clone());
                            if let Some(managed) = handle.try_state::<AppState>() {
                                *lock_status(&managed) = next.clone();
                            }
                            let _ = handle.emit("daemon-status", &next);

                            if states.changed().await.is_err() {
                                break;
                            }
                        }
                    });
                }

                Ok(())
            })
            .run(tauri::generate_context!());

        if let Err(error) = result {
            eprintln!("setu-desktop failed to start: {error}");
        }
    }

    fn computer_name() -> Option<String> {
        std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .ok()
            .map(|name| name.trim().to_owned())
            .filter(|name| !name.is_empty())
    }
}

#[cfg(not(test))]
pub use shell::run;

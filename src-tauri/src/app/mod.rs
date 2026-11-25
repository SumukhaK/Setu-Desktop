//! Tauri app shell: one window, one Solo supervisor, one status stream.
//!
//! The shell is excluded from the lib's unit-test build. The tests cover the
//! pure status mapping, and linking a GUI binary into the test harness pulls
//! in WebView2 and Common Controls, which need the application manifest that
//! Cargo does not give test binaries on Windows.

pub mod status;

#[cfg(not(test))]
mod tray;

#[cfg(not(test))]
mod shell {
    use std::path::PathBuf;
    use std::sync::{Mutex, MutexGuard, PoisonError};
    use std::time::Duration;

    use tauri::{Emitter, Manager, WindowEvent};
    use tokio::sync::watch;

    use crate::adb::{self, AdbConnectOutcome, AdbSnapshot, AdbWatcher};
    use crate::app::status::{resolve_daemon_path, resolve_relay, status_of, AppStatus};
    use crate::app::tray::{setup_tray, show_main};
    use crate::commands::devices::{
        forget_device, list_devices, set_nickname, ForgetOutcome, ListOutcome, NicknameOutcome,
    };
    use crate::commands::quit::{end_all_sessions, QuitLatch};
    use crate::commands::session::{connect_with_device, stop_session, StopOutcome};
    use crate::commands::{
        cancel_pending, connect_with_code, pair_adb, run_doctor, ConnectOutcome, DoctorOutcome,
        PairAdbOutcome, PendingConnect,
    };
    use crate::daemon::{DaemonConfig, DaemonState, Supervisor, SupervisorOptions, Workspace};
    use crate::events::{start as start_event_hub, EventHub};
    use crate::store::nicknames::NicknameStore;

    pub(crate) struct AppState {
        status: Mutex<AppStatus>,
        supervisor: Option<Supervisor>,
        pub(crate) hub: Option<EventHub>,
        pending: PendingConnect,
        nicknames: NicknameStore,
        quit_latch: QuitLatch,
        _adb: AdbWatcher,
        adb_status: watch::Receiver<AdbSnapshot>,
    }

    fn lock_status(state: &AppState) -> MutexGuard<'_, AppStatus> {
        state.status.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn ready_client(state: &AppState) -> Option<crate::rpc::RpcClient> {
        state
            .supervisor
            .as_ref()
            .and_then(|supervisor| match &*supervisor.subscribe().borrow() {
                DaemonState::Ready { client, .. } => Some(client.clone()),
                _ => None,
            })
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
    async fn session_connect_device(
        device_id: String,
        state: tauri::State<'_, AppState>,
    ) -> Result<ConnectOutcome, String> {
        Ok(connect_with_device(ready_client(&state), &device_id, &state.pending).await)
    }

    #[tauri::command]
    async fn session_pair_adb(
        device_id: String,
        pairing_code: String,
        pairing_port: Option<u16>,
        state: tauri::State<'_, AppState>,
    ) -> Result<PairAdbOutcome, String> {
        Ok(pair_adb(
            ready_client(&state),
            &device_id,
            &pairing_code,
            pairing_port,
            &state.pending,
        )
        .await)
    }

    #[tauri::command]
    async fn devices_list(state: tauri::State<'_, AppState>) -> Result<ListOutcome, String> {
        Ok(list_devices(ready_client(&state), &state.nicknames).await)
    }

    #[tauri::command]
    async fn devices_forget(
        device_id: String,
        state: tauri::State<'_, AppState>,
    ) -> Result<ForgetOutcome, String> {
        Ok(forget_device(ready_client(&state), &device_id, &state.nicknames).await)
    }

    #[tauri::command]
    fn device_set_nickname(
        device_id: String,
        nickname: String,
        state: tauri::State<'_, AppState>,
    ) -> Result<NicknameOutcome, String> {
        Ok(set_nickname(&state.nicknames, &device_id, &nickname))
    }

    #[tauri::command]
    async fn session_stop(
        session_id: String,
        state: tauri::State<'_, AppState>,
    ) -> Result<StopOutcome, String> {
        let client = state.supervisor.as_ref().and_then(|supervisor| {
            match &*supervisor.subscribe().borrow() {
                DaemonState::Ready { client, .. } => Some(client.clone()),
                _ => None,
            }
        });
        Ok(stop_session(client, &session_id).await)
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

    #[tauri::command]
    async fn diagnostics_run(state: tauri::State<'_, AppState>) -> Result<DoctorOutcome, String> {
        Ok(run_doctor(ready_client(&state), Duration::from_secs(30)).await)
    }

    #[tauri::command]
    fn window_hide(app: tauri::AppHandle) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }

    #[tauri::command]
    async fn app_quit(
        app: tauri::AppHandle,
        state: tauri::State<'_, AppState>,
    ) -> Result<(), String> {
        if !state.quit_latch.try_begin() {
            return Ok(());
        }
        let _ = tokio::time::timeout(
            Duration::from_secs(5),
            end_all_sessions(ready_client(&state)),
        )
        .await;
        if let Some(supervisor) = &state.supervisor {
            supervisor.stop().await;
        }
        app.exit(0);
        Ok(())
    }

    /// Start the window and, when a relay is configured, the Solo supervisor.
    ///
    /// Closing the window hides it to the tray; the daemon and its sessions
    /// keep running until Quit (P17).
    pub fn run() {
        let result = tauri::Builder::default()
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                show_main(app);
            }))
            .on_window_event(|window, event| {
                if window.label() == "main" {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            })
            .invoke_handler(tauri::generate_handler![
                daemon_status,
                session_resync,
                session_connect_code,
                session_cancel_connect,
                session_connect_device,
                session_pair_adb,
                session_stop,
                devices_list,
                devices_forget,
                device_set_nickname,
                adb_status,
                adb_connect,
                diagnostics_run,
                window_hide,
                app_quit
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
                let nicknames = NicknameStore::new(&state_dir);
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
                    let hub_state_dir = state_dir.clone();
                    tauri::async_runtime::block_on(async move {
                        start_event_hub(receiver, hub_state_dir)
                    })
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
                    nicknames,
                    quit_latch: QuitLatch::default(),
                    _adb: watcher,
                    adb_status: adb_status.clone(),
                });

                setup_tray(app.handle())?;

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
            eprintln!(
                "setu-desktop failed to start: {}",
                crate::log::redact(&error.to_string())
            );
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

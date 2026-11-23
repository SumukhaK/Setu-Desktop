//! System tray: one icon, **Show Setu** and **Quit Setu** (AD-1).

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

use super::shell::AppState;

/// Restore the main window and refresh the hub so the UI gets a fresh
/// `session.list` snapshot (P17). Also used by the single-instance handler.
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Some(state) = app.try_state::<AppState>() {
        if let Some(hub) = &state.hub {
            hub.resync();
        }
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Setu", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Setu", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::new().menu(&menu).tooltip("Setu");
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let tray = builder
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => {
                show_main(app);
                let _ = app.emit("quit-requested", ());
            }
            _ => {}
        })
        .build(app)?;
    // Keep it alive for the process lifetime.
    app.manage(tray);
    Ok(())
}

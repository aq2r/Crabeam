use crabeam_host_core::{CrabeamServer, SessionSnapshot};
use serde::Serialize;
use tauri::{async_runtime::Mutex, Manager, State};

#[derive(Default)]
struct AppState {
    inner: Mutex<Option<HostRuntime>>,
}

struct HostRuntime {
    server: CrabeamServer,
    port: u16,
    ticket: String,
}

#[derive(Serialize, Clone)]
struct HostInfo {
    port: u16,
    ticket: String,
}

#[tauri::command]
async fn start_hosting(state: State<'_, AppState>) -> Result<HostInfo, String> {
    let mut guard = state.inner.lock().await;

    if let Some(runtime) = guard.as_ref() {
        return Ok(HostInfo {
            port: runtime.port,
            ticket: runtime.ticket.clone(),
        });
    }

    let server = CrabeamServer::new()
        .await
        .map_err(|e| format!("failed to create server: {e:#}"))?;

    let port = server
        .run_server()
        .await
        .map_err(|e| format!("failed to run server: {e:#}"))?;

    let ticket = server
        .start_host()
        .await
        .map_err(|e| format!("failed to start host: {e:#}"))?
        .to_string();

    let info = HostInfo {
        port,
        ticket: ticket.clone(),
    };

    *guard = Some(HostRuntime {
        server,
        port,
        ticket,
    });

    Ok(info)
}

#[tauri::command]
async fn get_session_snapshot(state: State<'_, AppState>) -> Result<SessionSnapshot, String> {
    let guard = state.inner.lock().await;
    let runtime = guard
        .as_ref()
        .ok_or_else(|| "host is not started".to_string())?;

    Ok(runtime.server.session_snapshot().await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            inner: Mutex::new(None),
        })
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_hosting,
            get_session_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

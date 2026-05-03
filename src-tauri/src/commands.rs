// src-tauri/src/commands.rs
// Tauri command surface that exposes the OverlayAPI contract from
// src/shared/types.ts to the frontend. Each #[tauri::command] wraps
// storage / window helpers and returns plain serde-serialisable values
// to the renderer. Global hotkeys live in window.rs and emit "hotkey"
// events directly.

use crate::storage::{self, UserPaths};
use crate::types::{BuildsData, Settings, UserDataPaths, ViewMode};
use crate::window as winmod;
use serde_json::Value;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

fn err_string<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

#[tauri::command]
pub async fn builds_get(paths: State<'_, UserPaths>) -> Result<BuildsData, String> {
    storage::read_builds(paths.inner())
        .await
        .map_err(err_string)
}

#[tauri::command]
pub async fn builds_save(
    paths: State<'_, UserPaths>,
    builds: BuildsData,
) -> Result<BuildsData, String> {
    storage::save_builds(paths.inner(), builds)
        .await
        .map_err(err_string)
}

#[tauri::command]
pub async fn settings_get(paths: State<'_, UserPaths>) -> Result<Settings, String> {
    storage::read_settings(paths.inner())
        .await
        .map_err(err_string)
}

#[tauri::command]
pub async fn settings_save(
    paths: State<'_, UserPaths>,
    settings: Value,
) -> Result<Settings, String> {
    storage::save_settings(paths.inner(), settings)
        .await
        .map_err(err_string)
}

#[tauri::command]
pub async fn data_backup(paths: State<'_, UserPaths>) -> Result<String, String> {
    storage::backup_builds(paths.inner())
        .await
        .map_err(err_string)
}

#[tauri::command]
pub async fn data_user_paths(paths: State<'_, UserPaths>) -> Result<UserDataPaths, String> {
    Ok(paths.inner().to_dto())
}

#[tauri::command]
pub fn data_open_folder(paths: State<'_, UserPaths>) -> Result<(), String> {
    let dir = paths.inner().user_data.clone();
    open_native_path(&dir).map_err(err_string)
}

fn open_native_path(path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(path)
            .spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn()?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(path).spawn()?;
    }
    Ok(())
}

#[tauri::command]
pub fn window_close(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn window_toggle(window: WebviewWindow) {
    winmod::toggle_visible(&window);
}

#[tauri::command]
pub fn window_set_opacity(window: WebviewWindow, value: f64) {
    winmod::set_opacity(&window, value);
}

#[tauri::command]
pub fn window_set_click_through(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    winmod::set_click_through(&window, enabled).map_err(err_string)
}

#[tauri::command]
pub fn window_toggle_devtools(window: WebviewWindow) {
    winmod::toggle_devtools(&window);
}

/// Switch the single window between Manager and Overlay modes. Reads the
/// per-mode dimensions from settings.json so the user's resize survives
/// the toggle. Persists `lastView` so the next launch boots into the
/// chosen mode.
#[tauri::command]
pub async fn window_set_mode(
    window: WebviewWindow,
    paths: State<'_, UserPaths>,
    mode: ViewMode,
) -> Result<Settings, String> {
    let mut settings = storage::read_settings(paths.inner())
        .await
        .map_err(err_string)?;
    let sizes = winmod::ManagerSizes {
        manager: settings.manager_window_size,
        overlay: settings.overlay_window_size,
    };
    winmod::set_mode(&window, mode, sizes);
    let _ = winmod::set_click_through(
        &window,
        mode == ViewMode::Overlay && settings.overlay_click_through,
    );
    settings.last_view = mode;
    let payload = serde_json::json!({ "lastView": mode });
    storage::save_settings(paths.inner(), payload)
        .await
        .map_err(err_string)
}

#[tauri::command]
pub fn external_open(app: AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("only http(s) URLs are allowed".to_string());
    }
    app.opener().open_url(url, None::<&str>).map_err(err_string)
}

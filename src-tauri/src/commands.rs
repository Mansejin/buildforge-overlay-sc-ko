// src-tauri/src/commands.rs
// Tauri command surface that exposes the OverlayAPI contract from
// src/shared/types.ts to the frontend. Each #[tauri::command] wraps
// storage / window helpers and returns plain serde-serialisable values
// to the renderer. Global hotkeys live in window.rs and emit "hotkey"
// events directly.

use crate::storage::{self, UserPaths};
use crate::types::{
    AppUpdateCheckResult, AppUpdateInfo, BuildsData, RepositionModeResult, Settings, UserDataPaths,
    ViewMode, WindowSnapPreset,
};
use crate::window as winmod;
use serde_json::Value;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

fn err_string<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

async fn check_update(app: &AppHandle) -> Result<Option<tauri_plugin_updater::Update>, String> {
    app.updater()
        .map_err(err_string)?
        .check()
        .await
        .map_err(err_string)
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
pub async fn window_snap(
    window: WebviewWindow,
    paths: State<'_, UserPaths>,
    preset: WindowSnapPreset,
) -> Result<Settings, String> {
    winmod::snap_to_preset(&window, preset, 12).map_err(err_string)?;
    let settings = storage::read_settings(paths.inner())
        .await
        .map_err(err_string)?;
    winmod::save_bounds_for_mode(paths.inner(), settings.last_view, &window).await;
    storage::read_settings(paths.inner())
        .await
        .map_err(err_string)
}

#[tauri::command]
pub async fn window_toggle_reposition(
    window: WebviewWindow,
    paths: State<'_, UserPaths>,
) -> Result<RepositionModeResult, String> {
    let settings = storage::read_settings(paths.inner())
        .await
        .map_err(err_string)?;
    if settings.last_view != ViewMode::Overlay {
        return Err("먼저 오버레이 모드로 바꾸세요.".to_string());
    }
    winmod::toggle_reposition_mode(&window, settings.overlay_click_through).map_err(err_string)
}

#[tauri::command]
pub fn window_toggle_devtools(window: WebviewWindow) {
    winmod::toggle_devtools(&window);
}

#[tauri::command]
pub async fn app_update_check(app: AppHandle) -> Result<AppUpdateCheckResult, String> {
    let update = check_update(&app).await?;
    Ok(match update {
        Some(update) => AppUpdateCheckResult {
            available: true,
            update: Some(AppUpdateInfo {
                version: update.version.clone(),
                current_version: update.current_version.clone(),
                date: update.date.map(|date| date.to_string()),
                body: update.body.clone(),
            }),
        },
        None => AppUpdateCheckResult {
            available: false,
            update: None,
        },
    })
}

#[tauri::command]
pub async fn app_update_install(app: AppHandle) -> Result<bool, String> {
    let Some(update) = check_update(&app).await? else {
        return Ok(false);
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(err_string)?;
    app.restart()
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
    let settings = storage::read_settings(paths.inner())
        .await
        .map_err(err_string)?;
    // Persist the current mode's latest bounds before flipping modes so each
    // mode resumes where the user last left it.
    winmod::save_bounds_for_mode(paths.inner(), settings.last_view, &window).await;
    let sizes = winmod::ManagerSizes {
        manager: settings.manager_window_size,
        overlay: settings.overlay_window_size,
        manager_position: settings.manager_window_position,
        overlay_position: settings.overlay_window_position,
    };
    winmod::set_mode(&window, mode, sizes);
    let _ = winmod::set_click_through(
        &window,
        mode == ViewMode::Overlay && settings.overlay_click_through,
    );
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

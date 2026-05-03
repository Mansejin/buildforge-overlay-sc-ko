// src-tauri/src/window.rs
// Owns the main BrowserWindow lifecycle: applies the always-on-top topmost
// flag, exposes per-platform opacity setting (Win32 layered window / NSWindow
// alphaValue / GtkWidget opacity), wires the F12 / Ctrl+Shift+I devtools
// toggle, and registers all Ctrl+Alt-* global shortcuts that the overlay
// relies on. Mirrors src/main/window.ts.

use crate::storage::{self, UserPaths};
use crate::types::{
    HotkeyAction, RepositionModeResult, ViewMode, WindowPosition, WindowSize, WindowSnapPreset,
};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewWindow};

/// Shared "should this window stay always-on-top?" flag. The focus-loss
/// keeper consults this; `set_mode` flips it when the user toggles between
/// Manager (false) and Overlay (true). Without this, focus changes in
/// Manager mode kept yanking the window back on top of every other app.
static OVERLAY_AOT_DESIRED: AtomicBool = AtomicBool::new(true);
static OVERLAY_REPOSITION_ACTIVE: AtomicBool = AtomicBool::new(false);
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};

// objc 0.2's msg_send! / sel! macros aren't fully path-qualified internally;
// they look up sel! and sel_impl! in the call site's scope. Importing them
// here means the #[cfg(target_os = "macos")] block below can call msg_send!
// without "cannot find macro `sel` in this scope" on the macOS runner.
#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};

// gtk's set_opacity comes through WidgetExt; gtk-rs splits methods across
// extension traits, so the trait must be in scope at the call site.
#[cfg(target_os = "linux")]
use gtk::prelude::WidgetExt;

pub const MAIN_WINDOW_LABEL: &str = "main";

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
}

/// Apply per-platform window opacity. Tauri 2 doesn't ship a cross-platform
/// `set_opacity`, so we go to the OS handle.
#[allow(unused_variables)]
pub fn set_opacity(window: &WebviewWindow, value: f64) {
    let clamped = value.clamp(0.4, 1.0);

    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE,
            LWA_ALPHA, WS_EX_LAYERED,
        };
        if let Ok(hwnd) = window.hwnd() {
            let alpha_byte = (clamped * 255.0) as u8;
            unsafe {
                let raw = hwnd.0 as isize;
                let hwnd_native: windows_sys::Win32::Foundation::HWND = raw as _;
                let ex = GetWindowLongPtrW(hwnd_native, GWL_EXSTYLE);
                SetWindowLongPtrW(hwnd_native, GWL_EXSTYLE, ex | WS_EX_LAYERED as isize);
                let _ = SetLayeredWindowAttributes(hwnd_native, 0, alpha_byte, LWA_ALPHA);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(ns_window_ptr) = window.ns_window() {
            unsafe {
                let ns_window = ns_window_ptr as *mut objc::runtime::Object;
                let _: () = msg_send![ns_window, setAlphaValue: clamped];
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(gtk_window) = window.gtk_window() {
            gtk_window.set_opacity(clamped);
        }
    }
}

pub fn set_click_through(window: &WebviewWindow, enabled: bool) -> tauri::Result<()> {
    if enabled {
        OVERLAY_REPOSITION_ACTIVE.store(false, Ordering::Relaxed);
    }
    window.set_ignore_cursor_events(enabled)
}

/// Apply the per-mode window chrome. Manager mode gets normal decorations,
/// resizable, and the user's saved manager size. Overlay mode is frameless,
/// always-on-top, fixed-size, and uses the saved overlay size. Both keep the
/// existing visibility / opacity state.
pub fn set_mode(window: &WebviewWindow, mode: ViewMode, sizes: ManagerSizes) {
    let (size, position) = match mode {
        ViewMode::Manager => (sizes.manager, sizes.manager_position),
        ViewMode::Overlay => (sizes.overlay, sizes.overlay_position),
    };
    let _ = window.set_size(LogicalSize::new(size.width as f64, size.height as f64));
    if let Some(position) = position {
        let _ = window.set_position(LogicalPosition::new(position.x as f64, position.y as f64));
    }
    match mode {
        ViewMode::Manager => {
            OVERLAY_AOT_DESIRED.store(false, Ordering::Relaxed);
            OVERLAY_REPOSITION_ACTIVE.store(false, Ordering::Relaxed);
            let _ = window.set_decorations(true);
            let _ = window.set_resizable(true);
            let _ = window.set_always_on_top(false);
            let _ = window.set_skip_taskbar(false);
            if position.is_none() {
                // On first launch with no saved position yet, center Manager
                // so the full UI appears predictably.
                let _ = window.center();
            }
        }
        ViewMode::Overlay => {
            OVERLAY_AOT_DESIRED.store(true, Ordering::Relaxed);
            let _ = window.set_decorations(false);
            // Allow user to resize the overlay; before v2.3 the overlay was
            // size-locked which made the Liquipedia steps cramp at narrow
            // widths and gave users no escape from a too-small window.
            let _ = window.set_resizable(true);
            let _ = window.set_always_on_top(true);
            // Keep the overlay in the taskbar so users can find it; setting
            // skip_taskbar(true) here causes Windows to lose the window
            // entirely if minimised.
            let _ = window.set_skip_taskbar(false);
        }
    }
}

pub fn snap_to_preset(
    window: &WebviewWindow,
    preset: WindowSnapPreset,
    padding: i32,
) -> tauri::Result<()> {
    let monitor = match window.current_monitor()? {
        Some(monitor) => monitor,
        None => return Ok(()),
    };
    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let window_size = window.outer_size()?;
    let mon_x = monitor_pos.x;
    let mon_y = monitor_pos.y;
    let mon_w = monitor_size.width as i32;
    let mon_h = monitor_size.height as i32;
    let win_w = window_size.width as i32;
    let win_h = window_size.height as i32;
    let x = match preset {
        WindowSnapPreset::TopLeft | WindowSnapPreset::BottomLeft => mon_x + padding,
        WindowSnapPreset::TopRight | WindowSnapPreset::BottomRight => {
            mon_x + mon_w - win_w - padding
        }
        WindowSnapPreset::Center => mon_x + ((mon_w - win_w) / 2),
    };
    let y = match preset {
        WindowSnapPreset::TopLeft | WindowSnapPreset::TopRight => mon_y + padding,
        WindowSnapPreset::BottomLeft | WindowSnapPreset::BottomRight => {
            mon_y + mon_h - win_h - padding
        }
        WindowSnapPreset::Center => mon_y + ((mon_h - win_h) / 2),
    };
    window.set_position(LogicalPosition::new(x as f64, y as f64))
}

pub fn read_window_bounds(window: &WebviewWindow) -> Option<(WindowSize, WindowPosition)> {
    let size = window.outer_size().ok()?;
    let position = window.outer_position().ok()?;
    Some((
        WindowSize {
            width: size.width,
            height: size.height,
        },
        WindowPosition {
            x: position.x,
            y: position.y,
        },
    ))
}

pub async fn save_bounds_for_mode(paths: &UserPaths, mode: ViewMode, window: &WebviewWindow) {
    let Some((size, position)) = read_window_bounds(window) else {
        return;
    };
    let payload = match mode {
        ViewMode::Manager => json!({
            "managerWindowSize": size,
            "managerWindowPosition": position,
        }),
        ViewMode::Overlay => json!({
            "overlayWindowSize": size,
            "overlayWindowPosition": position,
        }),
    };
    if let Err(err) = storage::save_settings(paths, payload).await {
        log::warn!("save_bounds_for_mode failed: {err}");
    }
}

pub fn toggle_reposition_mode(
    window: &WebviewWindow,
    overlay_click_through_enabled: bool,
) -> tauri::Result<RepositionModeResult> {
    let next_active = !OVERLAY_REPOSITION_ACTIVE.load(Ordering::Relaxed);
    OVERLAY_REPOSITION_ACTIVE.store(next_active, Ordering::Relaxed);
    let click_through_enabled = if next_active {
        false
    } else {
        overlay_click_through_enabled
    };
    window.set_ignore_cursor_events(click_through_enabled)?;
    if next_active {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(RepositionModeResult {
        active: next_active,
        click_through_enabled,
    })
}

#[derive(Debug, Clone, Copy)]
pub struct ManagerSizes {
    pub manager: WindowSize,
    pub overlay: WindowSize,
    pub manager_position: Option<WindowPosition>,
    pub overlay_position: Option<WindowPosition>,
}

pub fn toggle_visible(window: &WebviewWindow) {
    let is_visible = window.is_visible().unwrap_or(true);
    if is_visible {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn toggle_devtools(window: &WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

/// Re-apply always-on-top after the window loses focus when the user has
/// us in Overlay mode. Works around a Tauri 2 / wry quirk on Windows where
/// clicking the taskbar can drop the overlay below it. Manager mode opts
/// out via OVERLAY_AOT_DESIRED so it behaves like a normal app window.
pub fn install_always_on_top_keeper(window: &WebviewWindow) {
    let cloned = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(focused) = event {
            if !focused && OVERLAY_AOT_DESIRED.load(Ordering::Relaxed) {
                let _ = cloned.set_always_on_top(true);
            }
        }
    });
}

pub fn install_bounds_persistor(window: &WebviewWindow, paths: UserPaths) {
    let cloned = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
            let paths_for_task = paths.clone();
            let window_for_task = cloned.clone();
            tauri::async_runtime::spawn(async move {
                let settings = match storage::read_settings(&paths_for_task).await {
                    Ok(settings) => settings,
                    Err(err) => {
                        log::warn!("install_bounds_persistor/read_settings failed: {err}");
                        return;
                    }
                };
                save_bounds_for_mode(&paths_for_task, settings.last_view, &window_for_task).await;
            });
        }
        _ => {}
    });
}

fn shortcut_to_action(shortcut: &Shortcut) -> Option<HotkeyAction> {
    let ctrl_alt = Modifiers::CONTROL | Modifiers::ALT;
    let ctrl_alt_shift = Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT;
    if shortcut.matches(ctrl_alt, Code::Digit1) {
        return Some(HotkeyAction::RaceTerran);
    }
    if shortcut.matches(ctrl_alt, Code::Digit2) {
        return Some(HotkeyAction::RaceProtoss);
    }
    if shortcut.matches(ctrl_alt, Code::Digit3) {
        return Some(HotkeyAction::RaceZerg);
    }
    if shortcut.matches(ctrl_alt, Code::KeyQ) {
        return Some(HotkeyAction::OppTerran);
    }
    if shortcut.matches(ctrl_alt, Code::KeyW) {
        return Some(HotkeyAction::OppZerg);
    }
    if shortcut.matches(ctrl_alt, Code::KeyE) {
        return Some(HotkeyAction::OppProtoss);
    }
    if shortcut.matches(ctrl_alt, Code::KeyR) {
        return Some(HotkeyAction::OppRandom);
    }
    if shortcut.matches(ctrl_alt_shift, Code::KeyB) {
        return Some(HotkeyAction::PrevBuild);
    }
    if shortcut.matches(ctrl_alt, Code::KeyB) {
        return Some(HotkeyAction::NextBuild);
    }
    if shortcut.matches(ctrl_alt, Code::PageDown) {
        return Some(HotkeyAction::NextPage);
    }
    if shortcut.matches(ctrl_alt, Code::PageUp) {
        return Some(HotkeyAction::PrevPage);
    }
    if shortcut.matches(ctrl_alt, Code::Digit0) {
        return Some(HotkeyAction::FirstPage);
    }
    if shortcut.matches(ctrl_alt, Code::KeyF) {
        return Some(HotkeyAction::ToggleFavorite);
    }
    if shortcut.matches(ctrl_alt, Code::KeyC) {
        return Some(HotkeyAction::ToggleCompact);
    }
    if shortcut.matches(ctrl_alt, Code::KeyH) {
        return Some(HotkeyAction::ToggleWindow);
    }
    if shortcut.matches(ctrl_alt, Code::KeyM) {
        return Some(HotkeyAction::ToggleMode);
    }
    if shortcut.matches(ctrl_alt, Code::KeyL) {
        return Some(HotkeyAction::ToggleClickThrough);
    }
    if shortcut.matches(ctrl_alt, Code::KeyK) {
        return Some(HotkeyAction::ToggleReposition);
    }
    None
}

fn all_shortcuts() -> Vec<Shortcut> {
    let ctrl_alt = Modifiers::CONTROL | Modifiers::ALT;
    let ctrl_alt_shift = Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT;
    vec![
        Shortcut::new(Some(ctrl_alt), Code::Digit1),
        Shortcut::new(Some(ctrl_alt), Code::Digit2),
        Shortcut::new(Some(ctrl_alt), Code::Digit3),
        Shortcut::new(Some(ctrl_alt), Code::KeyQ),
        Shortcut::new(Some(ctrl_alt), Code::KeyW),
        Shortcut::new(Some(ctrl_alt), Code::KeyE),
        Shortcut::new(Some(ctrl_alt), Code::KeyR),
        Shortcut::new(Some(ctrl_alt), Code::KeyB),
        Shortcut::new(Some(ctrl_alt_shift), Code::KeyB),
        Shortcut::new(Some(ctrl_alt), Code::PageDown),
        Shortcut::new(Some(ctrl_alt), Code::PageUp),
        Shortcut::new(Some(ctrl_alt), Code::Digit0),
        Shortcut::new(Some(ctrl_alt), Code::KeyF),
        Shortcut::new(Some(ctrl_alt), Code::KeyC),
        Shortcut::new(Some(ctrl_alt), Code::KeyH),
        Shortcut::new(Some(ctrl_alt), Code::KeyM),
        Shortcut::new(Some(ctrl_alt), Code::KeyL),
        Shortcut::new(Some(ctrl_alt), Code::KeyK),
    ]
}

pub fn register_shortcuts(app: &AppHandle) -> Result<(), tauri_plugin_global_shortcut::Error> {
    let app_handle = app.clone();
    let shortcuts = all_shortcuts();
    let manager = app.global_shortcut();
    manager.on_shortcuts(shortcuts, move |_app, shortcut, event: ShortcutEvent| {
        if event.state() != ShortcutState::Pressed {
            return;
        }
        if let Some(action) = shortcut_to_action(shortcut) {
            let _ = app_handle.emit("hotkey", action);
        }
    })?;
    Ok(())
}

pub fn unregister_shortcuts(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();
}
